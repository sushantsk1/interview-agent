import asyncio
import base64
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from backend.app.database import get_db

from backend.app.interview.graph import (
    create_interview_graph,
    initialize_interview,
    step_interview,
)
from backend.app.interview.nodes import merge_refined_topics, refine_topics_with_llm
from backend.app.models.db_models import (
    Candidate,
    FinalScorecard,
    InterviewTurn,
    JobSession,
    TurnEvaluation,
    utc_now,
)
from backend.app.services.deepgram_service import deepgram_service
from backend.app.services.deepgram_service import VoiceSynthesisError
from backend.app.observability import connection_id_var, log_event, new_id

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
    accepted_at = time.perf_counter()
    connection_id = new_id()
    connection_context = connection_id_var.set(connection_id)
    first_audio_logged = False

    silence_monitor_task: Optional[asyncio.Task] = None
    topic_refinement_task: Optional[asyncio.Task] = None

    async def send_event(payload: dict) -> None:
        event = dict(payload) if payload.get("type") == "pong" else {**payload, "connection_id": connection_id}
        await websocket.send_json(event)
        log_event(
            logger, logging.DEBUG if event.get("type") in {"transcript", "silence_tick", "pong"} else logging.INFO, "ws_event_sent",
            message_type=event.get("type"), turn_index=event.get("turn_index"),
            state=event.get("state"),
        )

    log_event(logger, logging.INFO, "ws_connected")


    try:
        session = db.query(JobSession).filter(JobSession.token == session_token).first()
        if not session:
            await send_event({
                "type": "error",
                "code": "SESSION_NOT_FOUND",
                "message": "Interview session not found.",
            })
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if session.status == "completed":
            await send_event({
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
        current_spoken_text = ""

        async def send_spoken_audio(text: str, turn_index: int) -> bool:
            """Send one complete MP3; report provider failure without pretending silence is speech."""
            nonlocal first_audio_logged
            synthesis_started = time.perf_counter()
            try:
                audio_bytes = await deepgram_service.synthesize_speech(text)
                if not audio_bytes:
                    raise VoiceSynthesisError("Empty speech audio")
            except VoiceSynthesisError:
                await send_event({
                    "type": "error",
                    "code": "TTS_FAILED",
                    "turn_index": turn_index,
                    "message": "Voice is temporarily unavailable. You can retry playback or answer the question.",
                })
                return False

            await send_event({
                "type": "audio",
                "turn_index": turn_index,
                "data": base64.b64encode(audio_bytes).decode("utf-8"),
                "format": "audio/mp3",
                "is_final_chunk": True,
            })
            log_event(
                logger, logging.INFO, "ws_audio_sent", turn_index=turn_index,
                bytes=len(audio_bytes), duration_ms=round((time.perf_counter() - synthesis_started) * 1000, 1),
            )
            if turn_index == 1 and not first_audio_logged:
                first_audio_logged = True
                log_event(logger, logging.INFO, "first_audio_ready", duration_ms=round((time.perf_counter() - accepted_at) * 1000, 1))
            return True

        async def finalize_candidate_turn():
            nonlocal agent_state, current_turn_index, current_topic_name
            nonlocal candidate_answer_buffer, turn_audio_buffer, last_speech_time, is_processing_turn
            nonlocal interview_state
            nonlocal current_spoken_text
            nonlocal topic_refinement_task

            if agent_state != "listening" or is_processing_turn:
                return

            is_processing_turn = True
            turn_started_at = time.perf_counter()
            agent_state = "thinking"
            last_speech_time = None
            log_event(logger, logging.INFO, "turn_processing_started", turn_index=current_turn_index)

            elapsed = int(time.time() - (session_start_time or time.time()))

            # 1. Notify thinking state
            await send_event({
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
                    await send_event({
                        "type": "transcript",
                        "speaker": "candidate",
                        "text": raw_answer,
                        "is_final": True,
                    })

            if not raw_answer:
                # Do NOT submit phantom answers! Candidate has not spoken yet.
                log_event(logger, logging.INFO, "empty_answer_ignored", turn_index=current_turn_index)
                agent_state = "listening"
                is_processing_turn = False
                last_speech_time = None
                await send_event({
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

            if topic_refinement_task and topic_refinement_task.done():
                try:
                    refined_topics = topic_refinement_task.result()
                    if refined_topics:
                        interview_state["topics"] = merge_refined_topics(
                            interview_state.get("topics", []),
                            refined_topics,
                            interview_state.get("current_topic_index", 0),
                        )
                except Exception as exc:
                    log_event(logger, logging.WARNING, "topic_refinement_unavailable", error_type=type(exc).__name__)
                topic_refinement_task = None

            # 3. Step LangGraph interview state machine
            interview_state = await asyncio.to_thread(
                step_interview,
                graph=graph,
                state=interview_state,
                candidate_answer=answer_text,
                time_elapsed_seconds=elapsed,
            )

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

                # Synthesize closing audio
                current_spoken_text = closing_msg
                await send_spoken_audio(closing_msg, current_turn_index)
                await send_event({
                    "type": "interview_complete",
                    "session_id": session_id,
                    "closing_message": closing_msg,
                })
                await send_event({
                    "type": "status",
                    "state": "completed",
                    "question_index": current_turn_index,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": elapsed,
                })
                agent_state = "completed"
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

                agent_state = "speaking"
                await send_event({
                    "type": "status",
                    "state": "speaking",
                    "question_index": current_turn_index,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": elapsed,
                })
                await send_event({
                    "type": "question",
                    "turn_index": current_turn_index,
                    "topic": current_topic_name,
                    "text": steering_msg,
                    "is_follow_up": interview_state.get("is_follow_up", False),
                })
                log_event(logger, logging.INFO, "question_ready", turn_index=current_turn_index, duration_ms=round((time.perf_counter() - turn_started_at) * 1000, 1))

                current_spoken_text = steering_msg
                await send_spoken_audio(steering_msg, current_turn_index)

                agent_state = "listening"
                is_processing_turn = False
                await send_event({
                    "type": "status",
                    "state": "listening",
                    "question_index": current_turn_index,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": elapsed,
                })
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

            agent_state = "speaking"
            await send_event({
                "type": "status",
                "state": "speaking",
                "question_index": current_turn_index,
                "total_questions": total_questions,
                "time_elapsed_seconds": elapsed,
            })
            await send_event({
                "type": "question",
                "turn_index": current_turn_index,
                "topic": current_topic_name,
                "text": next_q,
                "is_follow_up": is_follow_up,
            })
            log_event(logger, logging.INFO, "question_ready", turn_index=current_turn_index, duration_ms=round((time.perf_counter() - turn_started_at) * 1000, 1))

            current_spoken_text = next_q
            await send_spoken_audio(next_q, current_turn_index)

            agent_state = "listening"
            is_processing_turn = False
            await send_event({
                "type": "status",
                "state": "listening",
                "question_index": current_turn_index,
                "total_questions": total_questions,
                "time_elapsed_seconds": elapsed,
            })

        last_silence_tick_time: float = 0.0

        async def silence_monitor_loop():
            """Monitors silence duration to trigger hybrid turn auto-conclusion (AC-012)."""
            nonlocal last_silence_tick_time
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
                                await send_event({
                                    "type": "silence_tick",
                                    "silence_seconds": round(silence_duration, 1),
                                    "threshold_seconds": 2.75,
                                })
                        elif silence_duration >= 2.75:
                            log_event(logger, logging.INFO, "silence_turn_finalized", turn_index=current_turn_index)
                            await finalize_candidate_turn()
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    log_event(logger, logging.WARNING, "silence_monitor_error", error_type=type(e).__name__)
                    break

        silence_monitor_task = asyncio.create_task(silence_monitor_loop())

        while True:
            raw_message = await websocket.receive_text()
            try:
                payload = json.loads(raw_message)
            except Exception:
                await send_event({
                    "type": "error",
                    "code": "INVALID_JSON",
                    "message": "Malformed JSON payload received.",
                })
                continue

            msg_type = payload.get("type")
            safe_message_type = msg_type if msg_type in {
                "ping", "mute_toggle", "replay_question", "start", "audio_chunk",
                "transcript_update", "text_fallback", "done_answering",
            } else "unknown"
            log_event(
                logger, logging.DEBUG if safe_message_type in {"audio_chunk", "transcript_update"} else logging.INFO,
                "ws_message_received", message_type=safe_message_type,
            )

            # A. Ping / Pong
            if msg_type == "ping":
                await send_event({"type": "pong"})
                continue

            # B. Mute Toggle (AC-014)
            if msg_type == "mute_toggle":
                is_muted = bool(payload.get("muted", False))
                log_event(logger, logging.DEBUG, "microphone_state", state="muted" if is_muted else "unmuted")
                continue

            if msg_type == "replay_question":
                if not has_started or agent_state != "listening" or not current_spoken_text:
                    await send_event({
                        "type": "error",
                        "code": "REPLAY_NOT_AVAILABLE",
                        "message": "This question is not ready to replay yet.",
                    })
                    continue
                agent_state = "speaking"
                await send_event({
                    "type": "status",
                    "state": "speaking",
                    "question_index": current_turn_index,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": int(time.time() - (session_start_time or time.time())),
                })
                await send_spoken_audio(current_spoken_text, current_turn_index)
                agent_state = "listening"
                await send_event({
                    "type": "status",
                    "state": "listening",
                    "question_index": current_turn_index,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": int(time.time() - (session_start_time or time.time())),
                })
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
                    await send_event({
                        "type": "status",
                        "state": agent_state,
                        "question_index": current_turn_index,
                        "total_questions": total_questions,
                        "time_elapsed_seconds": elapsed,
                    })
                    await send_event({
                        "type": "question",
                        "turn_index": current_turn_index,
                        "topic": current_topic_name,
                        "text": interview_state.get("current_question", "Welcome back. Please proceed with your answer."),
                        "is_follow_up": interview_state.get("is_follow_up", False),
                    })
                    continue

                has_started = True
                session_start_time = time.time()
                agent_state = "thinking"
                await send_event({
                    "type": "status",
                    "state": "thinking",
                    "question_index": 1,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": 0,
                })

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
                    current_spoken_text = last_interviewer_turn.text

                    agent_state = "listening"
                    candidate_answer_buffer = []
                    turn_audio_buffer.clear()
                    last_speech_time = None
                    await send_event({
                        "type": "status",
                        "state": "listening",
                        "question_index": current_turn_index,
                        "total_questions": total_questions,
                        "time_elapsed_seconds": 0,
                    })
                    await send_event({
                        "type": "question",
                        "turn_index": current_turn_index,
                        "topic": current_topic_name,
                        "text": last_interviewer_turn.text,
                        "is_follow_up": last_interviewer_turn.is_follow_up,
                    })
                    continue

                # Initialize LangGraph state machine for brand new interview
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
                topic_refinement_task = asyncio.create_task(
                    asyncio.to_thread(refine_topics_with_llm, interview_state.copy())
                )

                current_turn_index = 1
                topics = interview_state.get("topics", [])
                current_topic_name = topics[0]["name"] if topics else "General"

                messages = interview_state.get("messages", [])
                greeting_text = messages[0]["content"] if messages else f"Hello {cand_name}! Welcome to your technical screening for {session.job_title}."
                first_question_text = interview_state.get("current_question", "")
                spoken_text = f"{greeting_text} {first_question_text}".strip()
                current_spoken_text = spoken_text

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

                # Emit Speaking status + Question + Audio
                agent_state = "speaking"
                await send_event({
                    "type": "status",
                    "state": "speaking",
                    "question_index": 1,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": 0,
                })
                await send_event({
                    "type": "question",
                    "turn_index": 1,
                    "topic": current_topic_name,
                    "text": spoken_text,
                    "is_follow_up": False,
                })
                log_event(logger, logging.INFO, "first_question_ready", duration_ms=round((time.perf_counter() - accepted_at) * 1000, 1))
                await send_spoken_audio(spoken_text, 1)

                # Transition to listening state
                agent_state = "listening"
                candidate_answer_buffer = []
                turn_audio_buffer.clear()
                last_speech_time = None
                await send_event({
                    "type": "status",
                    "state": "listening",
                    "question_index": 1,
                    "total_questions": total_questions,
                    "time_elapsed_seconds": int(time.time() - session_start_time),
                })
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
                        await send_event({
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
                    await send_event({
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
                    await send_event({
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

    except WebSocketDisconnect:
        log_event(logger, logging.INFO, "ws_disconnected")
    except Exception as e:
        log_event(logger, logging.ERROR, "ws_error", error_type=type(e).__name__)
        try:
            await send_event({
                "type": "error",
                "code": "INTERNAL_ERROR",
                "message": "An unexpected interview error occurred.",
            })
        except Exception:
            pass
    finally:
        if silence_monitor_task and not silence_monitor_task.done():
            silence_monitor_task.cancel()
        if topic_refinement_task and not topic_refinement_task.done():
            topic_refinement_task.cancel()
        connection_id_var.reset(connection_context)


