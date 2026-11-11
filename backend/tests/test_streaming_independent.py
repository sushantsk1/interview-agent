"""Independent regressions for candidate turn integrity during streaming."""
import pytest

from backend.app.models.db_models import InterviewTurn, JobSession, TurnEvaluation
from backend.tests.stream_helpers import listen


@pytest.fixture
def independent_session(db_session, monkeypatch):
    monkeypatch.setenv('INTERVIEW_MOCK_LLM', 'true')
    monkeypatch.setenv('MOCK_DEEPGRAM', 'true')
    session = JobSession(token='independent-stream', job_title='Python Engineer',
                         jd_text='Python asynchronous services and distributed storage',
                         question_count=5, duration_minutes=15, difficulty='Senior', status='pending')
    db_session.add(session)
    db_session.commit()
    return session


def test_empty_done_preserves_question_and_does_not_evaluate(client, db_session, independent_session):
    with client.websocket_connect('/ws/interview/independent-stream') as ws:
        ws.send_json({'type': 'start'})
        listen(ws)
        ws.send_json({'type': 'done_answering'})
        assert ws.receive_json()['state'] == 'thinking'
        status = ws.receive_json()
        assert status['state'] == 'listening' and status['question_index'] == 1
        ws.send_json({'type': 'ping'})
        assert ws.receive_json()['type'] == 'pong'
    assert db_session.query(InterviewTurn).filter(InterviewTurn.speaker == 'candidate').count() == 0
    assert db_session.query(TurnEvaluation).count() == 0


def test_reconnect_restores_last_question_without_repeating_greeting(client, db_session, independent_session):
    with client.websocket_connect('/ws/interview/independent-stream') as ws:
        ws.send_json({'type': 'start'})
        listen(ws)
        ws.send_json({'type': 'text_fallback', 'text': "I don't know this topic."})
        assert ws.receive_json()['type'] == 'transcript'
        assert ws.receive_json()['state'] == 'thinking'
        second = listen(ws)
        question = [event for event in second if event['type'] == 'question'][-1]
    with client.websocket_connect('/ws/interview/independent-stream') as ws:
        ws.send_json({'type': 'start'})
        status, restored = ws.receive_json(), ws.receive_json()
        assert status['state'] == 'listening'
        assert restored['type'] == 'question'
        assert restored['turn_index'] == question['turn_index']
        assert restored['text'] == question['text']
        assert 'Hello' not in restored['text']
        ws.send_json({'type': 'ping'})
        assert ws.receive_json()['type'] == 'pong'
    assert db_session.query(InterviewTurn).filter(InterviewTurn.speaker == 'candidate').count() == 1
    assert db_session.query(TurnEvaluation).count() == 1


@pytest.mark.asyncio
async def test_disconnect_cancellation_closes_provider_and_stops_graph_backpressure():
    import asyncio
    import threading
    from backend.app.interview.speech import emit_speech, stream_graph_speech

    entered = asyncio.Event()
    closed = asyncio.Event()
    stopped = threading.Event()

    class Voice:
        async def stream_speech(self, phrase):
            try:
                yield b'\x01\x00'
                entered.set()
                await asyncio.Event().wait()
            finally:
                closed.set()

    class Socket:
        async def send_json(self, payload):
            pass

    def graph():
        try:
            for _ in range(10000):
                emit_speech({}, 'Describe your API design. ')
        finally:
            stopped.set()

    task = asyncio.create_task(stream_graph_speech(graph, Socket(), Voice(), 5, 0))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.wait_for(closed.wait(), 1)
    for _ in range(20):
        if stopped.is_set():
            break
        await asyncio.sleep(.02)
    assert stopped.is_set(), 'Disconnected speech must unblock the bounded graph producer'
