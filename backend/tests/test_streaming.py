import asyncio
import threading
from types import SimpleNamespace

import pytest

from backend.app.interview.llm_factory import safe_llm_stream
from backend.app.interview.speech import emit_speech, stream_graph_speech, stream_prose
from backend.app.services.deepgram_service import DeepgramVoiceService


class Socket:
    def __init__(self):
        self.messages = []
        self.first_audio = asyncio.Event()

    async def send_json(self, msg):
        self.messages.append(msg)
        if msg['type'] == 'audio' and msg['data']:
            self.first_audio.set()


@pytest.mark.asyncio
async def test_voice_provider_yields_before_completion_and_closes_on_cancel():
    gate = asyncio.Event()
    closed = asyncio.Event()
    params = {}

    async def generate(**kwargs):
        params.update(kwargs)
        try:
            yield b'\x01\x00'
            await gate.wait()
            yield b'\x02\x00'
        finally:
            closed.set()

    voice = DeepgramVoiceService(mock_mode=False)
    voice._client = SimpleNamespace(speak=SimpleNamespace(v1=SimpleNamespace(audio=SimpleNamespace(generate=generate))))
    stream = voice.stream_speech('hello')
    assert await anext(stream) == b'\x01\x00'
    assert not gate.is_set()
    await stream.aclose()
    assert closed.is_set()
    assert params['encoding'] == 'linear16' and params['container'] == 'none'
    assert params['sample_rate'] == 24000


@pytest.mark.asyncio
async def test_model_and_audio_are_delivered_before_graph_finishes():
    gate = threading.Event()
    finished = threading.Event()
    socket = Socket()

    def invoke():
        emit_speech({}, 'Tell me about your API design. ')
        assert gate.wait(2)
        emit_speech({}, 'How would you test it?')
        finished.set()
        return {'current_question': 'test'}

    task = asyncio.create_task(stream_graph_speech(invoke, socket, DeepgramVoiceService(mock_mode=True), 3, 0))
    try:
        await asyncio.wait_for(socket.first_audio.wait(), 1)
        assert not finished.is_set()
        assert socket.messages[0]['state'] == 'speaking'
        assert socket.messages[-2]['type'] == 'question'
        assert 'How would you test' not in socket.messages[-2]['text']
    finally:
        gate.set()
    result, stream_id = await task
    assert result['current_question'] == 'test'
    assert socket.messages[-1]['is_final_chunk'] is True
    assert socket.messages[-1]['stream_id'] == stream_id


@pytest.mark.asyncio
async def test_voice_failure_still_settles_text_and_terminal_marker():
    class Voice:
        async def stream_speech(self, text):
            yield b'\x00\x00'
            raise ConnectionError('voice interrupted')

    socket = Socket()
    def invoke():
        emit_speech({}, 'How do you test APIs? ')
        emit_speech({}, 'Explain the approach.')
        return {'ok': True}

    result, stream_id = await stream_graph_speech(invoke, socket, Voice(), 3, 0)
    errors = [m for m in socket.messages if m['type'] == 'error']
    assert len(errors) == 1 and errors[0]['code'] == 'AUDIO_UNAVAILABLE'
    assert errors[0]['stream_id'] == stream_id
    assert socket.messages[-1]['is_final_chunk'] is True
    assert socket.messages[-2]['text'].endswith('Explain the approach.')


@pytest.mark.asyncio
async def test_partial_model_failure_ends_stream_without_mock_splice():
    socket = Socket()
    def invoke():
        emit_speech({}, 'What are the tradeoffs? ')
        raise ConnectionError('model interrupted')

    with pytest.raises(ConnectionError):
        await stream_graph_speech(invoke, socket, DeepgramVoiceService(mock_mode=True), 3, 0)
    assert socket.messages[-1]['is_final_chunk'] is True
    assert socket.messages[-2]['text'] == 'What are the tradeoffs?'
    assert any(m.get('code') == 'GENERATION_INTERRUPTED' for m in socket.messages)


def test_safe_llm_stream_does_not_splice_fallback_after_partial_output():
    class Model:
        def stream(self, prompt):
            yield 'How would you '
            raise ConnectionError('interrupted')

    stream = safe_llm_stream(Model(), 'question')
    assert next(stream) == 'How would you '
    with pytest.raises(ConnectionError):
        next(stream)
