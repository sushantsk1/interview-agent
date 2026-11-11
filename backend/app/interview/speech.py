"""Bridge synchronous graph prose to an async, backpressured speech pipeline."""
import asyncio
import base64
import concurrent.futures
import contextvars
import re
import threading
import uuid
from typing import Callable, Optional

from backend.app.interview.llm_factory import safe_llm_stream

speech_sink: contextvars.ContextVar[Optional[Callable]] = contextvars.ContextVar("speech_sink", default=None)


def speech_metadata(state, follow_up=False, closing=False, turn_index=None):
    topics = state.get("topics", [])
    index = state.get("current_topic_index", 0)
    return {
        "turn_index": turn_index if turn_index is not None else state.get("current_turn_index", 0) + (0 if closing else 1),
        "topic": topics[index]["name"] if index < len(topics) else "General",
        "is_follow_up": follow_up,
    }


def emit_speech(state, text, **kwargs):
    sink = speech_sink.get()
    if sink:
        sink((speech_metadata(state, **kwargs), text))


def stream_prose(llm, prompt, state, **kwargs):
    chunks = []
    for text in safe_llm_stream(llm, prompt):
        chunks.append(text)
        emit_speech(state, text, **kwargs)
    return "".join(chunks).strip()


async def stream_graph_speech(invoke, websocket, voice, total_questions, elapsed):
    """Run blocking graph work off-loop while forwarding playable PCM as it arrives.

    Text is released per phrase with its first audio bytes. The graph keeps generating
    into a bounded queue while TTS consumes phrases; it never waits for the full reply.
    """
    loop = asyncio.get_running_loop()
    events = asyncio.Queue(maxsize=32)
    cancelled = threading.Event()
    stream_id = uuid.uuid4().hex
    sentinel = object()

    def put(event):
        if cancelled.is_set():
            raise RuntimeError("Speech stream cancelled")
        future = asyncio.run_coroutine_threadsafe(events.put(event), loop)
        while True:
            try:
                future.result(timeout=0.1)
                return
            except concurrent.futures.TimeoutError:
                if cancelled.is_set():
                    future.cancel()
                    raise RuntimeError("Speech stream cancelled")

    def run():
        token = speech_sink.set(put)
        try:
            result = invoke()
            put((sentinel, result))
        except Exception as exc:
            if not cancelled.is_set():
                put((sentinel, exc))
        finally:
            speech_sink.reset(token)

    worker = asyncio.create_task(asyncio.to_thread(run))
    metadata = None
    pending = ""
    cumulative = ""
    emitted_status = False
    voice_failed = False

    async def speak(phrase):
        nonlocal cumulative
        cumulative += phrase
        published = False
        nonlocal voice_failed
        try:
            if not voice_failed:
                async for chunk in voice.stream_speech(phrase):
                    if not published:
                        await websocket.send_json({"type": "question", **metadata, "stream_id": stream_id,
                                                   "text": cumulative.strip(), "is_final": False})
                        published = True
                    if chunk:
                        await websocket.send_json({"type": "audio", "turn_index": metadata["turn_index"],
                                                   "stream_id": stream_id, "data": base64.b64encode(chunk).decode(),
                                                   "format": "audio/pcm", "sample_rate": 24000, "is_final_chunk": False})
        except Exception:
            voice_failed = True
            await websocket.send_json({"type": "error", "code": "AUDIO_UNAVAILABLE", "stream_id": stream_id,
                                       "message": "Voice is temporarily unavailable. You can continue using the question text."})
        if not published:
            # Text remains useful if the provider cannot produce voice.
            await websocket.send_json({"type": "question", **metadata, "stream_id": stream_id,
                                       "text": cumulative.strip(), "is_final": False})

    try:
        result = None
        while True:
            info, text = await events.get()
            if info is sentinel:
                if isinstance(text, Exception):
                    raise text
                result = text
                break
            metadata = info
            if not emitted_status:
                await websocket.send_json({"type": "status", "state": "speaking",
                                           "question_index": metadata["turn_index"],
                                           "total_questions": total_questions,
                                           "time_elapsed_seconds": elapsed})
                emitted_status = True
            pending += text
            # Complete sentences first. Long single sentences start speaking at a
            # word boundary after ~100 chars, rather than waiting for punctuation.
            while True:
                boundary = re.search(r'[.!?](?:\s|$)', pending)
                end = boundary.end() if boundary else 0
                if not end and len(pending) >= 120:
                    end = pending.rfind(" ", 0, 120) + 1
                if not end:
                    break
                phrase, pending = pending[:end], pending[end:]
                if phrase.strip():
                    await speak(phrase)
        if pending.strip():
            await speak(pending)
        if metadata:
            await websocket.send_json({"type": "question", **metadata, "stream_id": stream_id,
                                       "text": cumulative.strip(), "is_final": True})
            await websocket.send_json({"type": "audio", "turn_index": metadata["turn_index"],
                                       "stream_id": stream_id, "data": "", "format": "audio/pcm",
                                       "sample_rate": 24000, "is_final_chunk": True})
        await worker
        return result, stream_id if metadata else None
    except Exception:
        # End any partly audible stream explicitly before the connection retries.
        # Never append a mock question after real partial speech.
        if metadata:
            await websocket.send_json({"type": "error", "code": "GENERATION_INTERRUPTED",
                                       "stream_id": stream_id,
                                       "message": "Question generation was interrupted. Reconnecting will retry the question."})
            await websocket.send_json({"type": "question", **metadata, "stream_id": stream_id,
                                       "text": cumulative.strip(), "is_final": True})
            await websocket.send_json({"type": "audio", "turn_index": metadata["turn_index"],
                                       "stream_id": stream_id, "data": "", "format": "audio/pcm",
                                       "sample_rate": 24000, "is_final_chunk": True})
        raise
    finally:
        cancelled.set()
        if not worker.done():
            worker.cancel()
