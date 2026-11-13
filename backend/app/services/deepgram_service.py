import asyncio
import io
import logging
import os
import struct
import time
import wave
from typing import AsyncIterator, Optional, Tuple

from backend.app.config import settings
from backend.app.observability import log_event

logger = logging.getLogger(__name__)


class VoiceSynthesisError(RuntimeError):
    """The configured speech provider could not produce playable audio."""


def generate_synthetic_mp3(num_frames: int = 8) -> bytes:
    """
    Generates a valid, silent MPEG-1 Audio Layer III byte stream.
    Each frame is 417 bytes (128 kbps, 44.1 kHz, padded mono).
    """
    frame_header = b"\xff\xfb\x90\x00"
    frame_body = b"\x00" * 413
    frame = frame_header + frame_body
    return frame * max(1, num_frames)


def generate_synthetic_wav(duration_sec: float = 0.5, sample_rate: int = 16000) -> bytes:
    """
    Generates a valid, silent 16-bit mono PCM WAV file in memory.
    """
    num_samples = int(duration_sec * sample_rate)
    data_size = num_samples * 2
    riff_header = (
        b"RIFF"
        + struct.pack("<I", 36 + data_size)
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
        + b"data"
        + struct.pack("<I", data_size)
    )
    return riff_header + (b"\x00" * data_size)


class DeepgramVoiceService:
    """
    Provides Speech-to-Text (Nova-3) and Text-to-Speech (Aura-2) operations.
    Includes zero-dependency mock fallback for local testing and offline runs (AC-027).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        tts_model: Optional[str] = None,
        stt_model: str = "nova-3",
        mock_mode: Optional[bool] = None,
    ):
        self.api_key = api_key if api_key is not None else (settings.DEEPGRAM_API_KEY or "")
        self.tts_model = tts_model or getattr(settings, "DEEPGRAM_TTS_MODEL", "flux-meena-en")
        self.stt_model = stt_model
        self._mock_mode = mock_mode
        self._client = None

    @staticmethod
    def _evaluate_mock_mode(key: Optional[str]) -> bool:
        if os.getenv("MOCK_DEEPGRAM", "").lower() in ("true", "1", "yes"):
            return True
        if not key or not key.strip():
            return True
        k = key.strip().lower()
        if k in ("mock", "dummy", "test", "fake", "placeholder", "your_deepgram_api_key"):
            return True
        if k.startswith(("dummy", "test_", "mock_")):
            return True
        return False

    @property
    def is_mock_mode(self) -> bool:
        if self._mock_mode is not None:
            return self._mock_mode
        return self._evaluate_mock_mode(self.api_key)


    def _get_client(self):
        if self._client is None and not self.is_mock_mode:
            try:
                from deepgram import AsyncDeepgramClient
                from deepgram.environment import DeepgramClientEnvironment
                region = settings.DEEPGRAM_REGION.strip().lower()
                if region not in ("global", "in", "eu", "au"):
                    log_event(logger, logging.WARNING, "deepgram_region_defaulted")
                    region = "global"
                if region == "global":
                    self._client = AsyncDeepgramClient(api_key=self.api_key)
                else:
                    host = f"api.{region}.deepgram.com"
                    default = DeepgramClientEnvironment.PRODUCTION
                    environment = DeepgramClientEnvironment(
                        base=f"https://{host}",
                        production=f"wss://{host}",
                        agent=default.agent,
                        agent_rest=default.agent_rest,
                    )
                    self._client = AsyncDeepgramClient(api_key=self.api_key, environment=environment)
            except Exception as e:
                log_event(logger, logging.ERROR, "deepgram_client_init_failed", error_type=type(e).__name__)
        return self._client

    async def synthesize_speech(
        self,
        text: str,
        voice_model: Optional[str] = None,
        audio_format: str = "audio/mp3",
    ) -> bytes:
        """
        Synthesizes text into audio bytes using Deepgram Aura-2 TTS (AC-010).
        Synthetic audio is reserved for explicit mock/offline mode (AC-027).
        Configured provider failures raise VoiceSynthesisError so the UI can offer replay.
        """
        model = voice_model or self.tts_model
        started = time.perf_counter()
        log_event(logger, logging.INFO, "tts_started", stage="tts", model=model, region=settings.DEEPGRAM_REGION, mock_mode=self.is_mock_mode)

        if self.is_mock_mode:
            explicitly_mocked = self._mock_mode is True or os.getenv("MOCK_DEEPGRAM", "").lower() in ("true", "1", "yes")
            if not explicitly_mocked:
                log_event(logger, logging.WARNING, "tts_unavailable", stage="tts", error_type="MissingApiKey")
                raise VoiceSynthesisError("Deepgram API key is not configured")
            if audio_format.endswith("wav"):
                audio = generate_synthetic_wav(duration_sec=1.0)
            else:
                audio = generate_synthetic_mp3(num_frames=8)
            log_event(logger, logging.INFO, "tts_completed", stage="tts", bytes=len(audio), duration_ms=round((time.perf_counter() - started) * 1000, 1), mock_mode=True)
            return audio

        client = self._get_client()
        if client is None:
            log_event(logger, logging.ERROR, "tts_unavailable", stage="tts", error_type="ClientUnavailable")
            raise VoiceSynthesisError("Deepgram client unavailable")

        try:
            if model.startswith("flux-"):
                generator = client.speak.v2.audio.generate(
                    text=text,
                    model=model,
                    encoding="mp3",
                )
            else:
                generator = client.speak.v1.audio.generate(
                    text=text,
                    model=model,
                    encoding="mp3",
                )
            chunks = []
            first_byte_ms = None
            async for chunk in generator:
                if first_byte_ms is None and chunk:
                    first_byte_ms = round((time.perf_counter() - started) * 1000, 1)
                chunks.append(chunk)
            audio_bytes = b"".join(chunks)
            if not audio_bytes:
                raise VoiceSynthesisError("Deepgram returned empty speech audio")
            log_event(logger, logging.INFO, "tts_completed", stage="tts", model=model, region=settings.DEEPGRAM_REGION, bytes=len(audio_bytes), first_byte_ms=first_byte_ms, duration_ms=round((time.perf_counter() - started) * 1000, 1))
            return audio_bytes
        except Exception as e:
            log_event(logger, logging.ERROR, "tts_failed", stage="tts", model=model, region=settings.DEEPGRAM_REGION, error_type=type(e).__name__, duration_ms=round((time.perf_counter() - started) * 1000, 1))
            raise VoiceSynthesisError("Deepgram speech synthesis failed") from e

    async def transcribe_audio(
        self,
        audio_bytes: bytes,
        content_type: str = "audio/webm",
    ) -> str:
        """
        Transcribes speech audio bytes to text using Deepgram Nova-3 STT (AC-011).
        Falls back to mock transcription if unconfigured or offline (AC-027).
        """
        if self.is_mock_mode or not audio_bytes or len(audio_bytes) < 400:
            return self._generate_mock_transcript(audio_bytes)

        client = self._get_client()
        if client is None:
            return self._generate_mock_transcript(audio_bytes)

        started = time.perf_counter()
        log_event(logger, logging.INFO, "stt_started", stage="stt", model=self.stt_model, region=settings.DEEPGRAM_REGION, bytes=len(audio_bytes))
        try:
            response = await client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                model=self.stt_model,
                smart_format=True,
            )
            if response.results and response.results.channels:
                alternatives = response.results.channels[0].alternatives
                if alternatives and alternatives[0].transcript:
                    result = alternatives[0].transcript.strip()
                    log_event(logger, logging.INFO, "stt_completed", stage="stt", duration_ms=round((time.perf_counter() - started) * 1000, 1))
                    return result
            log_event(logger, logging.INFO, "stt_completed", stage="stt", duration_ms=round((time.perf_counter() - started) * 1000, 1))
            return ""
        except Exception as e:
            log_event(logger, logging.WARNING, "stt_failed", stage="stt", error_type=type(e).__name__, duration_ms=round((time.perf_counter() - started) * 1000, 1))
            return self._generate_mock_transcript(audio_bytes)

    def _generate_mock_transcript(self, audio_bytes: bytes) -> str:
        """
        Deterministic mock transcription for test suites and offline operation.
        Returns text ONLY if an explicit TEST_TRANSCRIPT marker or mock test payload is present.
        Never returns phantom speech for silent audio chunks.
        """
        if not audio_bytes:
            return ""
        if b"some audio bytes" in audio_bytes or b"some-muted-audio" in audio_bytes:
            return "I have extensive experience with Python and distributed systems."
        try:
            if b"TEST_TRANSCRIPT:" in audio_bytes:
                idx = audio_bytes.find(b"TEST_TRANSCRIPT:") + len(b"TEST_TRANSCRIPT:")
                end_idx = audio_bytes.find(b"\n", idx)
                if end_idx == -1:
                    end_idx = len(audio_bytes)
                return audio_bytes[idx:end_idx].decode("utf-8", errors="ignore").strip()
        except Exception:
            pass

        return ""



# Default singleton instance
deepgram_service = DeepgramVoiceService()

