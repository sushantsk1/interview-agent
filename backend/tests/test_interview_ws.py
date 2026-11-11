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
    from backend.tests.stream_helpers import listen
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start", "candidate_name": "Jane Doe", "candidate_email": "jane.doe@example.com"})
        events = listen(ws)
        assert events[0]["state"] == "speaking"
        questions = [e for e in events if e["type"] == "question"]
        assert questions[-1]["is_final"] is True
        assert all(q["stream_id"] == questions[0]["stream_id"] for q in questions)
        assert all(b["text"].startswith(a["text"]) for a, b in zip(questions, questions[1:]))
        audio = [e for e in events if e["type"] == "audio" and e["data"]]
        assert audio and all(e["format"] == "audio/pcm" and e["sample_rate"] == 24000 for e in audio)
    db_session.refresh(test_session)
    assert test_session.status == "in_progress"
    cand = db_session.query(Candidate).filter(Candidate.session_id == test_session.id).one()
    assert cand.name == "Jane Doe"
    turns = db_session.query(InterviewTurn).filter(InterviewTurn.session_id == test_session.id).all()
    assert len(turns) == 1 and turns[0].text == questions[-1]["text"]


def test_ws_audio_chunk_and_done_answering(client, db_session, test_session):
    from backend.tests.stream_helpers import listen
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        listen(ws)
        audio = base64.b64encode(b"TEST_TRANSCRIPT:I use FastAPI and PostgreSQL for high-throughput APIs.\n").decode()
        ws.send_json({"type": "audio_chunk", "data": audio})
        assert ws.receive_json()["type"] == "transcript"
        ws.send_json({"type": "done_answering"})
        assert ws.receive_json()["state"] == "thinking"
        events = listen(ws)
        assert next(e for e in events if e["type"] == "question")["turn_index"] == 2
    candidate = db_session.query(InterviewTurn).filter(InterviewTurn.speaker == "candidate").one()
    evaluation = db_session.query(TurnEvaluation).filter(TurnEvaluation.turn_id == candidate.id).one()
    assert 0 <= evaluation.relevance <= 10


def test_ws_playback_ack_gates_answers_and_ignores_stale_ack(client, test_session):
    from backend.tests.stream_helpers import drain_speech
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        events = drain_speech(ws, acknowledge=False)
        stream_id = events[-1]["stream_id"]
        ws.send_json({"type": "text_fallback", "text": "Should be ignored while speaking"})
        ws.send_json({"type": "playback_complete", "stream_id": "stale"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
        ws.send_json({"type": "playback_complete", "stream_id": stream_id})
        assert ws.receive_json()["state"] == "listening"


def test_ws_text_fallback_and_completion(client, db_session, test_session):
    from backend.tests.stream_helpers import listen, drain_speech
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        listen(ws)
        for index in range(2):
            ws.send_json({"type": "text_fallback", "text": "I use Redis caching and asynchronous APIs to handle high load."})
            assert ws.receive_json()["type"] == "transcript"
            assert ws.receive_json()["state"] == "thinking"
            if index == 0:
                listen(ws)
            else:
                events = drain_speech(ws, acknowledge=False)
                ws.send_json({"type": "ping"})
                assert ws.receive_json()["type"] == "pong"  # completion waits for closing playback
                ws.send_json({"type": "playback_complete", "stream_id": events[-1]["stream_id"]})
                complete = ws.receive_json()
                assert complete["type"] == "interview_complete"
                assert ws.receive_json()["state"] == "completed"
    db_session.refresh(test_session)
    assert test_session.status == "completed"
    assert db_session.query(FinalScorecard).filter(FinalScorecard.session_id == test_session.id).one()
    assert client.get(f"/api/sessions/{test_session.id}/scorecard").status_code == 200


def test_ws_mute_toggle(client, test_session):
    from backend.tests.stream_helpers import listen
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        listen(ws)
        audio = base64.b64encode(b"some-muted-audio").decode()
        ws.send_json({"type": "mute_toggle", "muted": True})
        ws.send_json({"type": "audio_chunk", "data": audio})
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
        ws.send_json({"type": "mute_toggle", "muted": False})
        ws.send_json({"type": "audio_chunk", "data": audio})
        assert ws.receive_json()["type"] == "transcript"


def test_ws_silence_detection_auto_conclusion(client, test_session):
    from backend.tests.stream_helpers import listen
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        listen(ws)
        audio = base64.b64encode(b"TEST_TRANSCRIPT:I use Redis caching and asynchronous APIs for reliability.\n").decode()
        ws.send_json({"type": "audio_chunk", "data": audio})
        assert ws.receive_json()["type"] == "transcript"
        while True:
            msg = ws.receive_json()
            if msg.get("state") == "thinking":
                break
            assert msg["type"] == "silence_tick"


def test_auto_silence_early_playback_ack_waits_for_persistence(client, test_session, monkeypatch):
    """An immediate browser ack cannot race the auto-turn graph result/DB commit."""
    import threading
    from backend.tests.stream_helpers import listen, drain_speech
    from backend.app.ws import interview_ws

    original = interview_ws.stream_graph_speech
    result_pending = threading.Event()
    release_result = threading.Event()
    calls = 0

    async def delayed_result(*args, **kwargs):
        nonlocal calls
        calls += 1
        result = await original(*args, **kwargs)
        if calls == 2:
            result_pending.set()
            assert await asyncio.to_thread(release_result.wait, 3)
        return result

    monkeypatch.setattr(interview_ws, 'stream_graph_speech', delayed_result)
    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({"type": "start"})
        listen(ws)
        ws.send_json({"type": "transcript_update", "text": "I build async Python APIs with Redis caching.", "is_final": True})
        assert ws.receive_json()['type'] == 'transcript'
        while ws.receive_json().get('state') != 'thinking':
            pass
        events = drain_speech(ws, acknowledge=False)
        assert result_pending.wait(1)
        ws.send_json({'type': 'playback_complete', 'stream_id': events[-1]['stream_id']})
        ws.send_json({'type': 'ping'})
        assert ws.receive_json() == {'type': 'pong'}  # receive stays responsive during processing
        release_result.set()
        assert ws.receive_json()['state'] == 'listening'


def test_auto_silence_partial_model_failure_closes_for_retry(client, test_session, monkeypatch):
    from backend.tests.stream_helpers import listen
    from backend.app.interview import nodes
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect(f"/ws/interview/{test_session.token}") as ws:
        ws.send_json({'type': 'start'})
        listen(ws)

        def broken_stream(llm, prompt):
            yield 'What are your API tradeoffs? '
            raise ConnectionError('model connection interrupted')

        # Force the next turn onto the streaming prose node rather than JSON follow-up.
        monkeypatch.setattr('backend.app.interview.speech.safe_llm_stream', broken_stream)
        ws.send_json({'type': 'transcript_update', 'text': "I don't know about this implementation.", 'is_final': True})
        assert ws.receive_json()['type'] == 'transcript'
        events = []
        with pytest.raises(WebSocketDisconnect) as disconnected:
            while True:
                events.append(ws.receive_json())
        assert disconnected.value.code == 1011
        assert any(e.get('code') == 'GENERATION_INTERRUPTED' for e in events)
        assert any(e['type'] == 'audio' and e['is_final_chunk'] for e in events)
        assert not any(e.get('state') == 'listening' for e in events)
