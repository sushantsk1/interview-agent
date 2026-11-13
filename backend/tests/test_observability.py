import asyncio
import json
import logging
from pathlib import Path
from uuid import UUID

from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.interview.llm_factory import safe_llm_invoke
from backend.app.main import app
from backend.app.observability import (
    configure_logging,
    connection_id_var,
    log_event,
    request_id_var,
)


def read_events(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def test_json_sinks_redact_provider_content_and_uvicorn_token(tmp_path, capsys):
    path = tmp_path / "events.jsonl"
    configure_logging("DEBUG", str(path))

    class FailingModel:
        def invoke(self, _prompt):
            raise RuntimeError("Candidate Alice said secret nvapi-1234567890")

    safe_llm_invoke(FailingModel(), "Candidate Alice said secret", stage="question")
    logging.getLogger("deepgram").warning("Candidate Alice said secret nvapi-1234567890")
    logging.getLogger("uvicorn.error").warning("WebSocket /ws/interview/private-invite-token [accepted]")

    output = path.read_text(encoding="utf-8") + capsys.readouterr().err
    assert "Alice" not in output
    assert "nvapi-1234567890" not in output
    assert "private-invite-token" not in output
    events = read_events(path)
    assert any(event["event"] == "model_fallback" and event["error_type"] == "RuntimeError" for event in events)
    assert any(event["event"] == "dependency_warning" for event in events)


def test_rotating_file_and_context_propagation_into_to_thread(tmp_path):
    path = tmp_path / "events.jsonl"
    configure_logging("INFO", str(path), max_bytes=350, backup_count=2)
    request_context = request_id_var.set("request-test-id")
    connection_context = connection_id_var.set("connection-test-id")
    try:
        asyncio.run(asyncio.to_thread(log_event, logging.getLogger("backend.app.test"), logging.INFO, "thread_event", stage="question"))
    finally:
        request_id_var.reset(request_context)
        connection_id_var.reset(connection_context)
    event = next(event for event in read_events(path) if event["event"] == "thread_event")
    assert event["request_id"] == "request-test-id"
    assert event["connection_id"] == "connection-test-id"

    for _ in range(20):
        log_event(logging.getLogger("backend.app.test"), logging.INFO, "rotation_event", stage="question")
    assert (tmp_path / "events.jsonl.1").exists()
    assert (tmp_path / "events.jsonl.2").exists()


def test_http_request_id_route_template_and_websocket_connection_id(tmp_path, monkeypatch):
    path = tmp_path / "app.jsonl"
    monkeypatch.setattr(settings, "LOG_FILE", str(path))
    with TestClient(app) as client:
        response = client.get(
            "/api/sessions/by-token/private-invite-token",
            headers={"Origin": "http://localhost:5173", "X-Request-ID": "spoofed-client-id"},
        )
        assert response.status_code == 404
        request_id = response.headers["X-Request-ID"]
        UUID(request_id)
        assert request_id != "spoofed-client-id"
        assert "X-Request-ID" in response.headers["access-control-expose-headers"]

        with client.websocket_connect("/ws/interview/private-invite-token") as ws:
            event = ws.receive_json()
            UUID(event["connection_id"])
            assert event["type"] == "error"

    output = path.read_text(encoding="utf-8")
    assert "private-invite-token" not in output
    assert "spoofed-client-id" not in output
    events = read_events(path)
    http = next(event for event in events if event["event"] == "http_request")
    assert http["route"] == "/api/sessions/by-token/{token}"
    assert http["request_id"] == request_id
    assert any(event["event"] == "ws_connected" and "connection_id" in event for event in events)
