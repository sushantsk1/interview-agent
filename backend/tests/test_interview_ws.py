import asyncio
import base64
import os
import time
import pytest
from starlette.testclient import TestClient

from backend.app.models.db_models import (
    Candidate,
    FinalScorecard,
    InterviewTurn,
    JobSession,
    TurnEvaluation,
)
from backend.app.services.deepgram_service import (
    DeepgramVoiceService,
    generate_synthetic_mp3,
    generate_synthetic_wav,
)


@pytest.fixture(autouse=True)
def setup_mock_env(monkeypatch):
    """Ensure all WebSocket tests run with deterministic mock LLM and Deepgram (AC-027, AC-028)."""
    monkeypatch.setenv("INTERVIEW_MOCK_LLM", "true")
    monkeypatch.setenv("MOCK_DEEPGRAM", "true")


@pytest.fixture
def test_session(db_session):
    session = JobSession(
        token="test_ws_token_123",
        job_title="Senior Backend Engineer",
        jd_text="Experience with Python, FastAPI, and distributed microservices.",
        question_count=2,
        difficulty="Senior",
        duration_minutes=15,
        candidate_name="Initial Name",
        candidate_email="initial@example.com",
        status="pending",
        has_resume=False,
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session


def test_deepgram_service_unit():
    """Unit test for DeepgramVoiceService and zero-dependency synthetic audio (AC-027)."""
    # 1. Synthetic MP3 generation
    mp3 = generate_synthetic_mp3(num_frames=4)
    assert len(mp3) == 417 * 4
    assert mp3[:2] == b"\xff\xfb"

    # 2. Synthetic WAV generation
    wav = generate_synthetic_wav(duration_sec=0.5, sample_rate=16000)
    assert wav[:4] == b"RIFF"
    assert len(wav) > 44

    # 3. Voice service mock mode operations
    svc = DeepgramVoiceService(mock_mode=True)
    assert svc.is_mock_mode is True

    # 4. Fallback on invalid key or error
    async def run_async_tests():
        audio_mp3 = await svc.synthesize_speech("Hello candidate")
        assert len(audio_mp3) > 0
        assert audio_mp3[:2] == b"\xff\xfb"

        audio_wav = await svc.synthesize_speech("Hello", audio_format="audio/wav")
        assert audio_wav[:4] == b"RIFF"

        # Mock STT
        trans = await svc.transcribe_audio(b"some audio bytes")
        assert len(trans) > 0
        assert "Python" in trans or "experience" in trans

        # Embedded test marker transcription
        marker_trans = await svc.transcribe_audio(b"headerTEST_TRANSCRIPT:Microservices architecture\nfooter")
        assert marker_trans == "Microservices architecture"

    asyncio.run(run_async_tests())


def test_ws_connection_invalid_token(client):
    """Connecting with an invalid token returns SESSION_NOT_FOUND error and closes (CONTRACT 3.2)."""
    with client.websocket_connect("/ws/interview/non_existent_token") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert msg["code"] == "SESSION_NOT_FOUND"


def test_ws_connection_completed_session(client, db_session, test_session):
    """Connecting to an already completed interview returns SESSION_COMPLETED error."""
    test_session.status = "completed"
    db_session.commit()

    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert msg["code"] == "SESSION_COMPLETED"


def test_ws_ping_pong(client, test_session):
    """Ping payload responds with pong."""
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "ping"})
        msg = ws.receive_json()
        assert msg == {"type": "pong"}


def test_ws_start_and_greeting_flow(client, db_session, test_session):
    """
    On session start:
    - AI greets candidate with Aura-2 TTS and initial question (AC-010).
    - Session status transitions to 'in_progress'.
    - Candidate record is linked in DB.
    - Initial interviewer turn is recorded in DB (AC-029).
    """
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({
            "type": "start",
            "candidate_name": "Jane Doe",
            "candidate_email": "jane.doe@example.com",
        })

        # Expect: status(speaking) -> question -> audio -> status(listening)
        m1 = ws.receive_json()
        assert m1["type"] == "status"
        assert m1["state"] == "speaking"
        assert m1["question_index"] == 1
        assert m1["total_questions"] == test_session.question_count

        m2 = ws.receive_json()
        assert m2["type"] == "question"
        assert m2["turn_index"] == 1
        assert len(m2["text"]) > 0
        assert m2["is_follow_up"] is False

        m3 = ws.receive_json()
        assert m3["type"] == "audio"
        assert m3["turn_index"] == 1
        assert m3["format"] == "audio/mp3"
        assert m3["is_final_chunk"] is True
        # Verify base64 audio decodes to valid MP3
        decoded_audio = base64.b64decode(m3["data"])
        assert len(decoded_audio) > 0
        assert decoded_audio[0] == 0xFF and (decoded_audio[1] & 0xE0) == 0xE0


        m4 = ws.receive_json()
        assert m4["type"] == "status"
        assert m4["state"] == "listening"
        assert m4["question_index"] == 1

    # Verify DB persistence
    db_session.refresh(test_session)
    assert test_session.status == "in_progress"
    assert test_session.candidate_name == "Jane Doe"
    assert test_session.candidate_email == "jane.doe@example.com"

    cand = db_session.query(Candidate).filter(Candidate.session_id == test_session.id).first()
    assert cand is not None
    assert cand.name == "Jane Doe"

    turns = db_session.query(InterviewTurn).filter(InterviewTurn.session_id == test_session.id).all()
    assert len(turns) == 1
    assert turns[0].speaker == "interviewer"
    assert turns[0].turn_index == 1
    assert turns[0].text == m2["text"]


def test_ws_audio_chunk_and_done_answering(client, db_session, test_session):
    """
    Candidate streams audio chunk, receives transcript (AC-011),
    and clicks 'Done Answering' (AC-013) to finalize turn and advance.
    """
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        # Start
        ws.send_json({"type": "start", "candidate_name": "Jane Doe"})
        ws.receive_json()  # status: speaking
        ws.receive_json()  # question 1
        ws.receive_json()  # audio 1
        ws.receive_json()  # status: listening

        # Stream audio chunk with custom text
        custom_audio = b"dummy_pcm_TEST_TRANSCRIPT:I use FastAPI and PostgreSQL for high-throughput APIs.\n"
        b64_audio = base64.b64encode(custom_audio).decode("utf-8")
        ws.send_json({"type": "audio_chunk", "data": b64_audio, "format": "audio/webm"})

        # Expect transcript event (AC-011)
        trans_msg = ws.receive_json()
        assert trans_msg["type"] == "transcript"
        assert trans_msg["speaker"] == "candidate"
        assert trans_msg["text"] == "I use FastAPI and PostgreSQL for high-throughput APIs."
        assert trans_msg["is_final"] is True

        # Click "Done Answering" (AC-013)
        ws.send_json({"type": "done_answering"})

        # Expect: status(thinking)
        think_msg = ws.receive_json()
        assert think_msg["type"] == "status"
        assert think_msg["state"] == "thinking"

        # Next question (turn 2)
        q_status = ws.receive_json()  # status: speaking
        assert q_status["type"] == "status"
        assert q_status["state"] == "speaking"

        q2_msg = ws.receive_json()  # question
        assert q2_msg["type"] == "question"
        assert q2_msg["turn_index"] == 2

        q2_audio = ws.receive_json()  # audio
        assert q2_audio["type"] == "audio"
        assert q2_audio["turn_index"] == 2

        ws.receive_json()  # status: listening

    # Verify DB candidate turn and evaluation persistence (AC-020, AC-029)
    turns = (
        db_session.query(InterviewTurn)
        .filter(InterviewTurn.session_id == test_session.id)
        .order_by(InterviewTurn.turn_index, InterviewTurn.speaker)
        .all()
    )
    # Interviewer turn 1, Candidate turn 1, Interviewer turn 2
    assert len(turns) >= 3
    cand_turns = [t for t in turns if t.speaker == "candidate"]
    assert len(cand_turns) == 1
    assert "FastAPI" in cand_turns[0].text

    eval_record = (
        db_session.query(TurnEvaluation)
        .filter(TurnEvaluation.turn_id == cand_turns[0].id)
        .first()
    )
    assert eval_record is not None
    assert 0.0 <= eval_record.relevance <= 10.0
    assert 0.0 <= eval_record.depth <= 10.0
    assert 0.0 <= eval_record.correctness <= 10.0
    assert 0.0 <= eval_record.communication <= 10.0


def test_ws_text_fallback(client, db_session, test_session):
    """Candidate typed text fallback input when microphone fails (AC-026)."""
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        # Start
        ws.send_json({"type": "start", "candidate_name": "Jane Doe"})
        ws.receive_json()  # status speaking
        ws.receive_json()  # question 1
        ws.receive_json()  # audio 1
        ws.receive_json()  # status listening

        # Submit text fallback
        ws.send_json({
            "type": "text_fallback",
            "text": "My microphone is glitching so I am typing my response about caching with Redis.",
        })

        # Expect transcript event
        trans = ws.receive_json()
        assert trans["type"] == "transcript"
        assert "caching with Redis" in trans["text"]

        # Expect thinking status
        thinking = ws.receive_json()
        assert thinking["type"] == "status"
        assert thinking["state"] == "thinking"

        # Expect next turn
        ws.receive_json()  # status speaking
        q2 = ws.receive_json()  # question 2
        assert q2["type"] == "question"
        assert q2["turn_index"] == 2
        ws.receive_json()  # audio 2
        ws.receive_json()  # status listening


def test_ws_mute_toggle(client, test_session):
    """Microphone mute toggle prevents audio ingestion (AC-014)."""
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        ws.receive_json()  # speaking
        ws.receive_json()  # q1
        ws.receive_json()  # a1
        ws.receive_json()  # listening

        # Toggle mute ON
        ws.send_json({"type": "mute_toggle", "muted": True})

        # Send audio chunk while muted -> should NOT produce a transcript
        b64_audio = base64.b64encode(b"some-muted-audio").decode("utf-8")
        ws.send_json({"type": "audio_chunk", "data": b64_audio, "format": "audio/webm"})

        # Send ping to verify websocket is responsive and no transcript was queued
        ws.send_json({"type": "ping"})
        pong = ws.receive_json()
        assert pong == {"type": "pong"}

        # Unmute
        ws.send_json({"type": "mute_toggle", "muted": False})
        ws.send_json({"type": "audio_chunk", "data": b64_audio, "format": "audio/webm"})
        trans = ws.receive_json()
        assert trans["type"] == "transcript"


def test_ws_silence_detection_auto_conclusion(client, db_session, test_session):
    """
    Hybrid turn detection: sustained silence >= 2.75s triggers auto-turn conclusion (AC-012).
    """
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        ws.receive_json()  # speaking
        ws.receive_json()  # q1
        ws.receive_json()  # a1
        ws.receive_json()  # listening

        # Candidate speaks: sends audio chunk
        custom_audio = b"TEST_TRANSCRIPT:Speaking then pausing for silence timeout.\n"
        b64 = base64.b64encode(custom_audio).decode("utf-8")
        ws.send_json({"type": "audio_chunk", "data": b64, "format": "audio/webm"})

        trans = ws.receive_json()
        assert trans["type"] == "transcript"

        # Now simulate silence by waiting for silence ticks and auto-conclusion
        # Collect incoming messages until thinking or silence_tick
        messages = []
        start_wait = time.time()
        while time.time() - start_wait < 5.0:
            try:
                # Receive next message with a short timeout
                msg = ws.receive_json()
                messages.append(msg)
                if msg.get("type") == "status" and msg.get("state") == "thinking":
                    break
            except Exception:
                break

        msg_types = [m.get("type") for m in messages]
        # Silence tick or auto-concluded thinking state observed!
        assert "status" in msg_types
        thinking_msgs = [m for m in messages if m.get("type") == "status" and m.get("state") == "thinking"]
        assert len(thinking_msgs) >= 1


def test_ws_full_interview_completion_and_scorecard(client, db_session, test_session):
    """
    Completes full interview cycle across configured question quota:
    - Generates closing speech audio and completion payload (AC-019).
    - Persists FinalScorecard and updates session to 'completed' (AC-021).
    - REST scorecard endpoint returns 200 with full metrics.
    """
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        # Start
        ws.send_json({"type": "start", "candidate_name": "Jane Doe"})
        ws.receive_json()  # speaking
        ws.receive_json()  # q1
        ws.receive_json()  # a1
        ws.receive_json()  # listening

        # Turn 1 answer
        ws.send_json({
            "type": "text_fallback",
            "text": "First answer: I design RESTful APIs using FastAPI and relational databases with SQLAlchemy.",
        })
        ws.receive_json()  # transcript
        ws.receive_json()  # thinking
        ws.receive_json()  # speaking
        q2 = ws.receive_json()  # q2
        assert q2["type"] == "question"
        assert q2["turn_index"] == 2
        ws.receive_json()  # a2
        ws.receive_json()  # listening

        # Turn 2 answer (reaches question_count = 2 quota)
        ws.send_json({
            "type": "text_fallback",
            "text": "Second answer: I use background workers and asynchronous queues for high scale.",
        })
        ws.receive_json()  # transcript
        ws.receive_json()  # thinking

        # Expect closing sequence
        closing_audio = ws.receive_json()
        assert closing_audio["type"] == "audio"

        comp_msg = ws.receive_json()
        assert comp_msg["type"] == "interview_complete"
        assert comp_msg["session_id"] == test_session.id
        assert len(comp_msg["closing_message"]) > 0

        final_status = ws.receive_json()
        assert final_status["type"] == "status"
        assert final_status["state"] == "completed"

    # Verify Database persistence
    db_session.refresh(test_session)
    assert test_session.status == "completed"
    assert test_session.completed_at is not None

    scorecard = db_session.query(FinalScorecard).filter(FinalScorecard.session_id == test_session.id).first()
    assert scorecard is not None
    assert 0.0 <= scorecard.overall_score <= 10.0
    assert scorecard.recommendation in ["Strong Hire", "Hire", "Borderline", "Do Not Hire"]
    assert len(scorecard.summary) > 0
    assert isinstance(scorecard.strengths, list)
    assert isinstance(scorecard.growth_areas, list)

    # Verify REST API returns scorecard correctly
    res_sc = client.get(f"/api/sessions/{test_session.id}/scorecard")
    assert res_sc.status_code == 200
    sc_data = res_sc.json()
    assert sc_data["overall_score"] == scorecard.overall_score
    assert len(sc_data["evaluations"]) >= 2

    # Verify REST API returns transcript correctly
    res_tr = client.get(f"/api/sessions/{test_session.id}/transcript")
    assert res_tr.status_code == 200
    tr_data = res_tr.json()
    assert len(tr_data["turns"]) >= 4  # interviewer + candidate for turns 1 and 2

