import asyncio
import base64
import json
import logging
import time
from typing import Optional

from backend.app.interview.speech import stream_graph_speech

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from backend.app.database import get_db

from backend.app.interview.graph import (
    create_interview_graph,
    initialize_interview,
    step_interview,
)
from backend.app.models.db_models import (
    Candidate,
    FinalScorecard,
    InterviewTurn,
    JobSession,
    TurnEvaluation,
    utc_now,
)
from backend.app.services.deepgram_service import deepgram_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


@router.websocket("/interview/{session_token}")
async def interview_websocket_endpoint(
    websocket: WebSocket,
    session_token: str,
    db: Session = Depends(get_db),
):
    """
    Real-time multi-modal WebSocket handler conforming to CONTRACT.md Section 3.
    Manages live Deepgram audio streaming, hybrid turn detection, and LangGraph turn stepping.
    """
    await websocket.accept()

    silence_monitor_task: Optional[asyncio.Task] = None
    receiver_task: Optional[asyncio.Task] = None


    try:
        session = db.query(JobSession).filter(JobSession.token == session_token).first()
        if not session:
            await websocket.send_json({
                "type": "error",
                "code": "SESSION_NOT_FOUND",
                "message": f"Interview session token '{session_token}' not found.",
            })
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if session.status == "completed":
            await websocket.send_json({
                "type": "error",
                "code": "SESSION_COMPLETED",
                "message": "This interview session has already been completed.",
            })
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        session_id = session.id
        total_questions = session.question_count
        duration_minutes = session.duration_minutes

        agent_state = "idle"  # idle | listening | thinking | speaking | completed
        current_turn_index = 0
        current_topic_name = "General Competencies"
        session_start_time: Optional[float] = None
        last_speech_time: Optional[float] = None
        candidate_answer_buffer = []
        turn_audio_buffer = bytearray()
        is_muted = False
        is_processing_turn = False
        has_started = False

        graph = create_interview_graph()
        interview_state = None
        pending_playback_id = None
        pending_completion = None

        disconnected = asyncio.Event()

        async def run_graph(invoke, elapsed):
            speech_task = asyncio.create_task(stream_graph_speech(
                invoke, websocket, deepgram_service, total_questions, elapsed,
            ))
            disconnect_task = asyncio.create_task(disconnected.wait())
            try:
                done, _ = await asyncio.wait({speech_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED)
                if disconnect_task in done:
                    raise WebSocketDisconnect()
                return await speech_task
            finally:
                for task in (speech_task, disconnect_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(speech_task, disconnect_task, return_exceptions=True)

        async def finalize_candidate_turn():
            nonlocal agent_state, current_turn_index, current_topic_name
            nonlocal candidate_answer_buffer, turn_audio_buffer, last_speech_time, is_processing_turn
            nonlocal interview_state, pending_playback_id, pending_completion

            if agent_state != "listening" or is_processing_turn:
                return

            is_processing_turn = True
            agent_state = "thinking"
            last_speech_time = None

            elapsed = int(time.time() - (session_start_time or time.time()))

            # 1. Notify thinking state
            await websocket.send_json({
                "type": "status",
                "state": "thinking",
                "question_index": current_turn_index,
                "total_questions": total_questions,
                "time_elapsed_seconds": elapsed,
            })

            # 2. Extract candidate answer
            raw_answer = " ".join(candidate_answer_buffer).strip()
            if not raw_answer and turn_audio_buffer and len(turn_audio_buffer) > 1000:
                transcription = await deepgram_service.transcribe_audio(bytes(turn_audio_buffer))
                if transcription:
                    raw_answer = transcription.strip()
                    await websocket.send_json({
                        "type": "transcript",
                        "speaker": "candidate",
                        "text": raw_answer,
                        "is_final": True,
                    })

            if not raw_answer:
                # Do NOT submit phantom answers! Candidate has not spoken yet.
                logger.info("Candidate answer buffer is empty; returning to listening state.")
                agent_state = "listening"
                is_processing_turn = False
                last_speech_time = None
                await websocket.send_json({
                    "type": "status",
                    "state": "listening",
                    "question_index": current_turn_index,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": elapsed,
                })
                return

            answer_text = raw_answer
            candidate_answer_buffer = []
            turn_audio_buffer.clear()

            # 3. Step LangGraph interview state machine
            interview_state, pending_playback_id = await run_graph(
                lambda: step_interview(
                    graph=graph, state=interview_state,
                    candidate_answer=answer_text, time_elapsed_seconds=elapsed,
                ), elapsed,
            )
            agent_state = "speaking"

            # 4. Persist Candidate Interview Turn in DB (AC-029)
            cand_turn = InterviewTurn(
                session_id=session_id,
                turn_index=current_turn_index,
                speaker="candidate",
                topic=current_topic_name,
                text=answer_text,
                is_follow_up=interview_state.get("is_follow_up", False),
                timestamp=utc_now(),
            )
            db.add(cand_turn)
            db.flush()

            # 5. Persist Turn Evaluation in DB (AC-020)
            last_eval = interview_state.get("last_evaluation")
            if last_eval:
                scores = last_eval.get("scores", {})
                eval_db = TurnEvaluation(
                    turn_id=cand_turn.id,
                    relevance=scores.get("relevance", 7.0),
                    depth=scores.get("depth", 6.5),
                    correctness=scores.get("correctness", 7.0),
                    communication=scores.get("communication", 7.5),
                    feedback=last_eval.get("feedback", "Completed evaluation."),
                    created_at=utc_now(),
                )
                db.add(eval_db)
            db.commit()

            # 6. Check for Interview Completion (AC-019)
            phase = interview_state.get("phase")
            has_scorecard = interview_state.get("scorecard") is not None
            evaluations_count = len(interview_state.get("evaluations", []))
            time_cap_reached = elapsed >= (duration_minutes * 60)
            question_cap_reached = evaluations_count >= total_questions

            if phase == "completed" or has_scorecard or time_cap_reached or question_cap_reached:
                scorecard_data = interview_state.get("scorecard")
                if not scorecard_data:
                    evals = interview_state.get("evaluations", [])
                    if evals:
                        avg_rel = round(sum(e["scores"]["relevance"] for e in evals) / len(evals), 1)
                        avg_dep = round(sum(e["scores"]["depth"] for e in evals) / len(evals), 1)
                        avg_cor = round(sum(e["scores"]["correctness"] for e in evals) / len(evals), 1)
                        avg_com = round(sum(e["scores"]["communication"] for e in evals) / len(evals), 1)
                        overall_score = round((avg_rel + avg_dep + avg_cor + avg_com) / 4.0, 1)
                    else:
                        avg_rel = avg_dep = avg_cor = avg_com = overall_score = 6.0

                    rec = "Hire" if overall_score >= 7.0 else "Borderline" if overall_score >= 5.0 else "Do Not Hire"
                    scorecard_data = {
                        "overall_score": overall_score,
                        "dimension_scores": {
                            "relevance": avg_rel,
                            "depth": avg_dep,
                            "correctness": avg_cor,
                            "communication": avg_com,
                        },
                        "recommendation": rec,
                        "summary": f"Interview concluded after {evaluations_count} turns. Overall rating: {overall_score}/10.",
                        "strengths": ["Structured problem analysis", "Clear communication"],
                        "growth_areas": ["Could explore edge case trade-offs in deeper detail"],
                    }

                # Persist FinalScorecard to DB (AC-021)
                existing_sc = db.query(FinalScorecard).filter(FinalScorecard.session_id == session_id).first()
                if not existing_sc:
                    final_sc = FinalScorecard(
                        session_id=session_id,
                        overall_score=scorecard_data["overall_score"],
                        recommendation=scorecard_data["recommendation"],
                        dimension_relevance=scorecard_data["dimension_scores"]["relevance"],
                        dimension_depth=scorecard_data["dimension_scores"]["depth"],
                        dimension_correctness=scorecard_data["dimension_scores"]["correctness"],
                        dimension_communication=scorecard_data["dimension_scores"]["communication"],
                        summary=scorecard_data["summary"],
                        strengths=scorecard_data["strengths"],
                        growth_areas=scorecard_data["growth_areas"],
                        duration_seconds=elapsed,
                        created_at=utc_now(),
                    )
                    db.add(final_sc)

                job_sess = db.query(JobSession).filter(JobSession.id == session_id).first()
                if job_sess:
                    job_sess.status = "completed"
                    job_sess.completed_at = utc_now()
                db.commit()

                # Find closing remarks
                closing_msg = "Thank you for completing your interview! Your responses have been submitted to the recruitment team."
                for m in reversed(interview_state.get("messages", [])):
                    if m.get("type") == "closing":
                        closing_msg = m.get("content", closing_msg)
                        break

                # Completion is announced after the browser has drained closing audio.
                pending_completion = {
                    "type": "interview_complete", "session_id": session_id,
                    "closing_message": closing_msg,
                }
                is_processing_turn = False
                return

            # 7. Check if Conversational Steering is Needed (AC-017)
            if interview_state.get("needs_steering"):
                steering_msg = interview_state.get(
                    "steering_message",
                    f"Let's stay focused on the question at hand: '{interview_state.get('current_question')}'.",
                )

                st_turn = InterviewTurn(
                    session_id=session_id,
                    turn_index=current_turn_index,
                    speaker="interviewer",
                    topic=current_topic_name,
                    text=steering_msg,
                    is_follow_up=interview_state.get("is_follow_up", False),
                    timestamp=utc_now(),
                )
                db.add(st_turn)
                db.commit()

                is_processing_turn = False
                return

            # 8. Advance to Next Question (AC-015 / AC-016)
            next_q = interview_state.get("current_question", "")
            current_turn_index = interview_state.get("current_turn_index", current_turn_index + 1)
            is_follow_up = interview_state.get("is_follow_up", False)
            topic_idx = interview_state.get("current_topic_index", 0)
            topics = interview_state.get("topics", [])
            current_topic_name = topics[topic_idx]["name"] if topic_idx < len(topics) else "General"

            interviewer_turn = InterviewTurn(
                session_id=session_id,
                turn_index=current_turn_index,
                speaker="interviewer",
                topic=current_topic_name,
                text=next_q,
                is_follow_up=is_follow_up,
                timestamp=utc_now(),
            )
            db.add(interviewer_turn)
            db.commit()

            is_processing_turn = False

        last_silence_tick_time: float = 0.0

        async def silence_monitor_loop():
            """Monitors silence duration to trigger hybrid turn auto-conclusion (AC-012)."""
            nonlocal last_silence_tick_time, last_speech_time
            while True:
                try:
                    await asyncio.sleep(0.1)
                    if (
                        agent_state == "listening"
                        and last_speech_time is not None
                        and (candidate_answer_buffer or len(turn_audio_buffer) > 4000)
                        and not is_processing_turn
                    ):
                        silence_duration = time.time() - last_speech_time
                        if 1.0 <= silence_duration < 2.75:
                            now = time.time()
                            if now - last_silence_tick_time >= 0.5:
                                last_silence_tick_time = now
                                await websocket.send_json({
                                    "type": "silence_tick",
                                    "silence_seconds": round(silence_duration, 1),
                                    "threshold_seconds": 2.75,
                                })
                        elif silence_duration >= 2.75:
                            logger.info("Silence threshold of 2.75s reached; auto-concluding candidate turn.")
                            # Serialize automatic turns with playback acknowledgments
                            # on the same receive loop; DB persistence must finish first.
                            last_speech_time = None
                            await incoming.put({"type": "done_answering"})
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.debug("Silence monitor loop exception: %s", e)
                    break

        incoming = asyncio.Queue(maxsize=32)
        silence_monitor_task = asyncio.create_task(silence_monitor_loop())

        # Keep receiving heartbeats and disconnects while the graph/TTS pipeline runs.
        # Incoming answers during speech are discarded at arrival, never replayed later.
        async def receive_messages():
            try:
                while True:
                    raw_message = await websocket.receive_text()
                    try:
                        payload = json.loads(raw_message)
                    except (ValueError, TypeError):
                        await websocket.send_json({"type": "error", "code": "INVALID_JSON",
                                                   "message": "Malformed JSON payload received."})
                        continue
                    if not isinstance(payload, dict):
                        continue
                    kind = payload.get("type")
                    if kind == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif kind in {"audio_chunk", "transcript_update", "text_fallback", "done_answering"} and agent_state != "listening":
                        continue
                    else:
                        await incoming.put(payload)
            except WebSocketDisconnect:
                disconnected.set()
                await incoming.put(None)

        receiver_task = asyncio.create_task(receive_messages())
        while True:
            payload = await incoming.get()
            if payload is None:
                raise WebSocketDisconnect()
            msg_type = payload.get("type")

            # A. Ping / Pong
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Only the active utterance's drained-playback ack opens the microphone.
            if msg_type == "playback_complete":
                if pending_playback_id and payload.get("stream_id") == pending_playback_id:
                    pending_playback_id = None
                    if pending_completion:
                        await websocket.send_json(pending_completion)
                        pending_completion = None
                        agent_state = "completed"
                    else:
                        agent_state = "listening"
                    await websocket.send_json({
                        "type": "status", "state": agent_state,
                        "question_index": current_turn_index,
                        "total_questions": total_questions,
                        "time_elapsed_seconds": int(time.time() - (session_start_time or time.time())),
                    })
                continue

            # B. Mute Toggle (AC-014)
            if msg_type == "mute_toggle":
                is_muted = bool(payload.get("muted", False))
                logger.debug("Candidate microphone mute state updated: %s", is_muted)
                continue

            # C. Start Interview Session (AC-010)
            if msg_type == "start":
                cand_name = payload.get("candidate_name") or session.candidate_name or "Candidate"
                cand_email = payload.get("candidate_email") or session.candidate_email or ""

                session.candidate_name = cand_name
                session.candidate_email = cand_email
                session.status = "in_progress"

                existing_cand = db.query(Candidate).filter(Candidate.session_id == session.id).first()
                if not existing_cand:
                    new_cand = Candidate(session_id=session.id, name=cand_name, email=cand_email)
                    db.add(new_cand)
                else:
                    existing_cand.name = cand_name
                    existing_cand.email = cand_email

                db.commit()
                db.refresh(session)

                # GUARD: If already started in this connection, don't re-initialize or repeat greeting!
                if has_started and interview_state is not None:
                    elapsed = int(time.time() - (session_start_time or time.time()))
                    await websocket.send_json({
                        "type": "status",
                        "state": agent_state,
                        "question_index": current_turn_index,
                        "total_questions": total_questions,
                        "time_elapsed_seconds": elapsed,
                    })
                    await websocket.send_json({
                        "type": "question",
                        "turn_index": current_turn_index,
                        "topic": current_topic_name,
                        "text": interview_state.get("current_question", "Welcome back. Please proceed with your answer."),
                        "is_follow_up": interview_state.get("is_follow_up", False),
                    })
                    continue

                has_started = True
                session_start_time = time.time()

                existing_turns = db.query(InterviewTurn).filter(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index.asc()).all()
                if existing_turns:
                    # Session is resuming from a reconnect or page reload; do NOT repeat greeting!
                    last_turn = existing_turns[-1]
                    last_interviewer_turn = next((t for t in reversed(existing_turns) if t.speaker == "interviewer"), existing_turns[0])
                    current_turn_index = last_turn.turn_index
                    current_topic_name = last_turn.topic

                    interview_state = await asyncio.to_thread(initialize_interview,
                        session_id=session.id,
                        job_title=session.job_title,
                        jd_text=session.jd_text,
                        resume_text=session.resume_text,
                        candidate_name=cand_name,
                        candidate_email=cand_email,
                        config={
                            "question_count": session.question_count,
                            "difficulty": session.difficulty,
                            "duration_minutes": session.duration_minutes,
                        },
                        graph=graph,
                    )
                    interview_state["current_turn_index"] = current_turn_index
                    interview_state["current_question"] = last_interviewer_turn.text
                    interview_state["is_follow_up"] = last_interviewer_turn.is_follow_up

                    agent_state = "listening"
                    candidate_answer_buffer = []
                    turn_audio_buffer.clear()
                    last_speech_time = None
                    await websocket.send_json({
                        "type": "status",
                        "state": "listening",
                        "question_index": current_turn_index,
                        "total_questions": total_questions,
                        "time_elapsed_seconds": 0,
                    })
                    await websocket.send_json({
                        "type": "question",
                        "turn_index": current_turn_index,
                        "topic": current_topic_name,
                        "text": last_interviewer_turn.text,
                        "is_follow_up": last_interviewer_turn.is_follow_up,
                    })
                    continue

                # Initialize LangGraph state machine for brand new interview
                agent_state = "speaking"
                interview_state, pending_playback_id = await run_graph(
                    lambda: initialize_interview(
                    session_id=session.id,
                    job_title=session.job_title,
                    jd_text=session.jd_text,
                    resume_text=session.resume_text,
                    candidate_name=cand_name,
                    candidate_email=cand_email,
                    config={
                        "question_count": session.question_count,
                        "difficulty": session.difficulty,
                        "duration_minutes": session.duration_minutes,
                    },
                    graph=graph,
                    ), 0,
                )

                current_turn_index = 1
                topics = interview_state.get("topics", [])
                current_topic_name = topics[0]["name"] if topics else "General"

                messages = interview_state.get("messages", [])
                greeting_text = messages[0]["content"] if messages else f"Hello {cand_name}! Welcome to your technical screening for {session.job_title}."
                first_question_text = interview_state.get("current_question", "")
                spoken_text = f"{greeting_text} {first_question_text}".strip()

                # Persist interviewer Turn 1 in DB (AC-029)
                init_turn = InterviewTurn(
                    session_id=session.id,
                    turn_index=1,
                    speaker="interviewer",
                    topic=current_topic_name,
                    text=spoken_text,
                    is_follow_up=False,
                    timestamp=utc_now(),
                )
                db.add(init_turn)
                db.commit()

                agent_state = "speaking"
                candidate_answer_buffer = []
                turn_audio_buffer.clear()
                last_speech_time = None
                continue

            # D. Audio Chunk Streaming (AC-011)
            if msg_type == "audio_chunk":
                if is_muted or agent_state != "listening":
                    continue

                b64_audio = payload.get("data", "")
                if not b64_audio:
                    continue

                try:
                    raw_audio = base64.b64decode(b64_audio)
                except Exception:
                    continue

                turn_audio_buffer.extend(raw_audio)

                # Unit test mock transcription / explicit test marker hook
                if deepgram_service.is_mock_mode or b"TEST_TRANSCRIPT:" in raw_audio:
                    transcript_chunk = await deepgram_service.transcribe_audio(raw_audio)
                    if transcript_chunk:
                        candidate_answer_buffer.append(transcript_chunk)
                        last_speech_time = time.time()
                        await websocket.send_json({
                            "type": "transcript",
                            "speaker": "candidate",
                            "text": transcript_chunk,
                            "is_final": True,
                        })
                continue

            # D2. Real-time Transcript Updates from Client (Web Speech API / Live STT)
            if msg_type == "transcript_update":
                if is_muted or agent_state != "listening":
                    continue
                speech_text = str(payload.get("text", "")).strip()
                is_final = bool(payload.get("is_final", False))
                if speech_text:
                    last_speech_time = time.time()
                    if is_final:
                        if speech_text not in candidate_answer_buffer:
                            candidate_answer_buffer.append(speech_text)
                    await websocket.send_json({
                        "type": "transcript",
                        "speaker": "candidate",
                        "text": speech_text,
                        "is_final": is_final,
                    })
                continue

            # E. Text Fallback Input (AC-026)
            if msg_type == "text_fallback":
                if agent_state != "listening":
                    continue
                typed_text = str(payload.get("text", "")).strip()
                if typed_text:
                    candidate_answer_buffer = [typed_text]
                    await websocket.send_json({
                        "type": "transcript",
                        "speaker": "candidate",
                        "text": typed_text,
                        "is_final": True,
                    })
                    await finalize_candidate_turn()
                continue

            # F. Done Answering Manual Button (AC-013)
            if msg_type == "done_answering":
                if agent_state == "listening":
                    await finalize_candidate_turn()
                continue

    except asyncio.CancelledError:
        logger.debug("Interview connection task cancelled after disconnect")
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for session token: %s", session_token)
    except Exception as e:
        logger.exception("Unexpected error in interview websocket: %s", e)
        try:
            await websocket.send_json({
                "type": "error",
                "code": "INTERNAL_ERROR",
                "message": "The interview connection was interrupted. Please reconnect to continue.",
            })
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass
    finally:
        if receiver_task and not receiver_task.done():
            receiver_task.cancel()
        if silence_monitor_task and not silence_monitor_task.done():
            silence_monitor_task.cancel()


