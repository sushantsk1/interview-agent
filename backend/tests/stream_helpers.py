def drain_speech(ws, acknowledge=True):
    """Read an entire variable-length v1 utterance, optionally acknowledging drain."""
    events = []
    while True:
        msg = ws.receive_json()
        events.append(msg)
        assert msg.get("code") != "INTERNAL_ERROR", msg
        if msg.get("type") == "audio" and msg.get("is_final_chunk"):
            if acknowledge:
                ws.send_json({"type": "playback_complete", "stream_id": msg["stream_id"]})
            return events


def listen(ws):
    events = drain_speech(ws)
    status = ws.receive_json()
    assert status["type"] == "status" and status["state"] == "listening", status
    return events
