import io
from backend.app.models.db_models import JobSession, InterviewTurn, FinalScorecard


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "interview-agent-api"
    assert data["version"] == "1.0.0"
    assert "deepgram_configured" in data
    assert "nvidia_configured" in data


def test_create_session_success(client, db_session):
    payload = {
        "job_title": "Senior Python Backend Engineer",
        "jd_text": "We are seeking a senior engineer proficient with Python, FastAPI, distributed systems, and SQL databases...",
        "question_count": 8,
        "difficulty": "Senior",
        "duration_minutes": 30,
        "candidate_name": "Jane Doe",
        "candidate_email": "jane@example.com",
    }
    response = client.post("/api/sessions", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert data["job_title"] == "Senior Python Backend Engineer"
    assert data["question_count"] == 8
    assert data["difficulty"] == "Senior"
    assert data["duration_minutes"] == 30
    assert data["candidate_name"] == "Jane Doe"
    assert data["candidate_email"] == "jane@example.com"
    assert data["status"] == "pending"
    assert data["has_resume"] is False
    assert len(data["token"]) > 0
    assert data["invite_url"] == f"/interview/{data['token']}"

    # Verify database persistence
    db_obj = db_session.query(JobSession).filter(JobSession.id == data["id"]).first()
    assert db_obj is not None
    assert db_obj.token == data["token"]
    assert len(db_obj.candidates) == 1
    assert db_obj.candidates[0].email == "jane@example.com"


def test_create_session_validation_failure(client):
    # Empty job title
    payload = {
        "job_title": "",
        "jd_text": "Short",
        "question_count": 2,  # Below min 5
        "difficulty": "Senior",
        "duration_minutes": 5,  # Below min 15
    }
    response = client.post("/api/sessions", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["code"] == "VALIDATION_ERROR"
    assert len(data["errors"]) > 0


def test_upload_resume_pdf_success(client, db_session, sample_pdf_bytes):
    # 1. Create a session first
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "Full Stack Engineer",
            "jd_text": "Proficiency in React and Python required for building high-scale apps.",
            "question_count": 6,
            "difficulty": "Mid",
            "duration_minutes": 25,
        },
    )
    session_id = create_resp.json()["id"]

    # 2. Upload PDF resume
    files = {"file": ("jane_resume.pdf", sample_pdf_bytes, "application/pdf")}
    resp = client.post(f"/api/sessions/{session_id}/resume", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == session_id
    assert data["filename"] == "jane_resume.pdf"
    assert data["parsed_character_count"] > 0
    assert "Jane Doe Senior Engineer" in data["extracted_preview"]

    # 3. Verify DB record updated
    db_obj = db_session.query(JobSession).filter(JobSession.id == session_id).first()
    assert db_obj.has_resume is True
    assert db_obj.resume_filename == "jane_resume.pdf"
    assert "Jane Doe Senior Engineer" in db_obj.resume_text


def test_upload_resume_docx_success(client, db_session, sample_docx_bytes):
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "Backend Developer",
            "jd_text": "Experienced Python engineer with focus on performance.",
            "question_count": 5,
            "difficulty": "Mid",
            "duration_minutes": 20,
        },
    )
    session_id = create_resp.json()["id"]

    files = {"file": ("resume.docx", sample_docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    resp = client.post(f"/api/sessions/{session_id}/resume", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == session_id
    assert data["filename"] == "resume.docx"
    assert data["parsed_character_count"] > 0
    assert "Jane Doe" in data["extracted_preview"]


def test_upload_resume_invalid_format(client, sample_pdf_bytes):
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "Security Analyst",
            "jd_text": "Knowledge of network security and vulnerability assessments.",
        },
    )
    session_id = create_resp.json()["id"]

    files = {"file": ("resume.exe", b"MZ fake executable content", "application/octet-stream")}
    resp = client.post(f"/api/sessions/{session_id}/resume", files=files)
    assert resp.status_code == 400
    data = resp.json()
    assert data["code"] == "INVALID_FILE_TYPE"
    assert "Unsupported file format" in data["detail"]


def test_upload_resume_oversize(client):
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "DevOps Engineer",
            "jd_text": "Knowledge of Kubernetes, Docker, and CI/CD pipelines.",
        },
    )
    session_id = create_resp.json()["id"]

    # 11MB file
    huge_bytes = b"0" * (11 * 1024 * 1024)
    files = {"file": ("huge_resume.pdf", huge_bytes, "application/pdf")}
    resp = client.post(f"/api/sessions/{session_id}/resume", files=files)
    assert resp.status_code == 413
    data = resp.json()
    assert data["code"] == "FILE_TOO_LARGE"
    assert "File exceeds maximum 10MB limit" in data["detail"]


def test_upload_resume_session_not_found(client, sample_pdf_bytes):
    files = {"file": ("resume.pdf", sample_pdf_bytes, "application/pdf")}
    resp = client.post("/api/sessions/non-existent-session-id/resume", files=files)
    assert resp.status_code == 404
    data = resp.json()
    assert data["code"] == "SESSION_NOT_FOUND"


def test_get_session_by_token(client):
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "AI Engineer",
            "jd_text": "Experience with LLMs, prompt engineering, and vector databases.",
            "candidate_name": "Bob Smith",
            "candidate_email": "bob@example.com",
        },
    )
    token = create_resp.json()["token"]

    resp = client.get(f"/api/sessions/by-token/{token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["token"] == token
    assert data["job_title"] == "AI Engineer"
    assert data["candidate_name"] == "Bob Smith"


def test_get_session_by_invalid_token(client):
    resp = client.get("/api/sessions/by-token/completely-invalid-token")
    assert resp.status_code == 404
    data = resp.json()
    assert data["code"] == "SESSION_NOT_FOUND"


def test_list_sessions_and_filtering(client):
    # Create 2 sessions: 1 pending, 1 completed
    client.post(
        "/api/sessions",
        json={
            "job_title": "Frontend Engineer",
            "jd_text": "React, TypeScript, CSS, responsive layouts.",
            "candidate_name": "Alice",
        },
    )
    s2 = client.post(
        "/api/sessions",
        json={
            "job_title": "Backend Engineer",
            "jd_text": "FastAPI, PostgreSQL, Redis, unit testing.",
            "candidate_name": "Charlie",
        },
    ).json()

    # Get all
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2
    assert len(data["items"]) >= 2

    # Filter by status
    resp_pending = client.get("/api/sessions?status=pending")
    assert resp_pending.status_code == 200
    assert resp_pending.json()["total"] >= 2

    resp_completed = client.get("/api/sessions?status=completed")
    assert resp_completed.status_code == 200
    assert resp_completed.json()["total"] == 0


def test_get_transcript(client, db_session):
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "Data Scientist",
            "jd_text": "Machine learning, pandas, scikit-learn, statistical modeling.",
        },
    )
    session_id = create_resp.json()["id"]

    # Insert turns into DB
    turn1 = InterviewTurn(
        session_id=session_id,
        turn_index=1,
        speaker="interviewer",
        text="Hello! Welcome to your interview.",
    )
    turn2 = InterviewTurn(
        session_id=session_id,
        turn_index=1,
        speaker="candidate",
        text="Thank you, happy to be here.",
    )
    db_session.add_all([turn1, turn2])
    db_session.commit()

    resp = client.get(f"/api/sessions/{session_id}/transcript")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == session_id
    assert len(data["turns"]) == 2
    assert data["turns"][0]["speaker"] == "interviewer"
    assert data["turns"][0]["text"] == "Hello! Welcome to your interview."
    assert data["turns"][1]["speaker"] == "candidate"


def test_get_scorecard(client, db_session):
    create_resp = client.post(
        "/api/sessions",
        json={
            "job_title": "Cloud Architect",
            "jd_text": "AWS, GCP, Terraform, microservices design and governance.",
            "candidate_name": "Dave",
        },
    )
    session_id = create_resp.json()["id"]

    # Scorecard not yet created -> 404
    resp = client.get(f"/api/sessions/{session_id}/scorecard")
    assert resp.status_code == 404
    assert resp.json()["code"] == "SCORECARD_NOT_FOUND"

    # Add scorecard to DB
    scorecard = FinalScorecard(
        session_id=session_id,
        overall_score=8.5,
        recommendation="Hire",
        dimension_relevance=9.0,
        dimension_depth=8.0,
        dimension_correctness=8.5,
        dimension_communication=8.5,
        summary="Candidate showed deep architectural mastery.",
        strengths=["Strong AWS knowledge", "Clear communication"],
        growth_areas=["Could elaborate more on GCP"],
        duration_seconds=1200,
    )
    db_session.add(scorecard)
    db_session.commit()

    resp = client.get(f"/api/sessions/{session_id}/scorecard")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == session_id
    assert data["overall_score"] == 8.5
    assert data["recommendation"] == "Hire"
    assert data["dimension_scores"]["relevance"] == 9.0
    assert len(data["strengths"]) == 2
    assert "Strong AWS knowledge" in data["strengths"]
