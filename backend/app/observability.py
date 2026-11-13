"""Privacy-safe event logging and request/connection correlation."""

import contextvars
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import re
from datetime import datetime, timezone
from uuid import uuid4

request_id_var = contextvars.ContextVar("request_id", default=None)
connection_id_var = contextvars.ContextVar("connection_id", default=None)

_SAFE_FIELDS = {
    "stage", "model", "region", "route", "method", "status", "duration_ms",
    "bytes", "first_byte_ms", "turn_index", "message_type", "state",
    "error_type", "configured", "mock_mode", "question_index", "total_questions",
    "nvidia_configured", "deepgram_configured", "database_backend",
    "difficulty", "question_source",
}
_TOKEN_PATH = re.compile(r"(?i)(/(?:ws/interview|interview|api/sessions/by-token)/)[^/?\s\"']+")
_SESSION_PATH = re.compile(r"(?i)(/api/sessions/)[^/?\s\"']+")
_AUTH = re.compile(r"(?i)(authorization\s*[:=]\s*(?:bearer|token)\s+)[^\s,\"']+")
_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_KEY = re.compile(r"\b(?:nvapi-|sk-|dg_)[A-Za-z0-9_-]{8,}\b", re.IGNORECASE)


def new_id() -> str:
    return str(uuid4())


def sanitize(value: str) -> str:
    value = _TOKEN_PATH.sub(r"\1[redacted]", value)
    value = _SESSION_PATH.sub(r"\1[redacted]", value)
    value = _AUTH.sub(r"\1[redacted]", value)
    value = _EMAIL.sub("[redacted-email]", value)
    return _KEY.sub("[redacted-key]", value)


class PrivacyFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not record.name.startswith("backend."):
            record.msg = "uvicorn_event" if record.name.startswith("uvicorn") else "dependency_warning"
            record.event_fields = {}
        else:
            record.msg = sanitize(record.getMessage())
        record.args = ()
        record.exc_info = None
        record.stack_info = None
        record.request_id = request_id_var.get()
        record.connection_id = connection_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "event": sanitize(record.getMessage()),
            "logger": record.name,
        }
        if getattr(record, "request_id", None):
            payload["request_id"] = record.request_id
        if getattr(record, "connection_id", None):
            payload["connection_id"] = record.connection_id
        payload.update(getattr(record, "event_fields", {}))
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def log_event(logger: logging.Logger, level: int, event: str, **fields) -> None:
    safe = {}
    for key, value in fields.items():
        if key not in _SAFE_FIELDS or value is None:
            continue
        if isinstance(value, (str, int, float, bool)):
            safe[key] = sanitize(value) if (isinstance(value, str) and key != "route") else value
    logger.log(level, event, extra={"event_fields": safe})


def configure_logging(level: str = "INFO", log_file: str = "logs/interview-agent.jsonl", max_bytes: int = 5 * 1024 * 1024, backup_count: int = 3) -> None:
    """Install JSON console and rotating file handlers once per app startup."""
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_interview_agent_handler", False):
            root.removeHandler(handler)
            handler.close()
    formatter = JsonFormatter()
    privacy_filter = PrivacyFilter()
    handlers = [logging.StreamHandler()]
    file_error_type = None
    if log_file:
        try:
            path = Path(log_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            handlers.append(RotatingFileHandler(path, maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8"))
        except OSError as exc:
            file_error_type = type(exc).__name__
    for handler in handlers:
        handler._interview_agent_handler = True
        handler.setLevel(numeric_level)
        handler.setFormatter(formatter)
        handler.addFilter(privacy_filter)
        root.addHandler(handler)
    root.setLevel(numeric_level)
    for name in ("httpx", "httpx2", "httpcore", "openai", "deepgram", "langchain_openai"):
        logging.getLogger(name).setLevel(logging.WARNING)
    # Our HTTP middleware records route templates, so raw Uvicorn access paths
    # (which may contain invitation tokens) must never be emitted.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        for handler in logging.getLogger(name).handlers:
            if not any(isinstance(item, PrivacyFilter) for item in handler.filters):
                handler.addFilter(PrivacyFilter())
    log_event(logging.getLogger(__name__), logging.INFO, "logging_ready", configured=len(handlers) > 1)
    if file_error_type:
        log_event(logging.getLogger(__name__), logging.WARNING, "logging_file_unavailable", error_type=file_error_type)
