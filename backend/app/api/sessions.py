from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, Query, status
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models.db_models import (
    JobSession,
    Candidate,
    InterviewTurn,
    TurnEvaluation,
    FinalScorecard,
    generate_token,
)
from backend.app.models.schemas import (
    SessionCreateRequest,
    SessionResponse,
    ResumeUploadResponse,
    SessionListResponse,
    SessionListItem,
    CandidateSessionInfo,
    ScorecardResponse,
    TranscriptResponse,
    TranscriptTurnItem,
    EvaluationTurnItem,
    DimensionScores,
)
from backend.app.services.resume_parser import parse_resume, ResumeParserException
from fastapi import HTTPException

router = APIRouter(prefix="/sessions", tags=["Sessions"])


def raise_api_error(status_code: int, detail: str, code: str):
    raise HTTPException(
        status_code=status_code,
        detail={"detail": detail, "code": code, "errors": []},
    )


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    db: Session = Depends(get_db),
):
    token = generate_token()
    session = JobSession(
        token=token,
        job_title=payload.job_title.strip(),
        jd_text=payload.jd_text.strip(),
        question_count=payload.question_count,
        difficulty=payload.difficulty,
        duration_minutes=payload.duration_minutes,
        candidate_name=payload.candidate_name.strip() if payload.candidate_name else None,
        candidate_email=payload.candidate_email.strip() if payload.candidate_email else None,
        status="pending",
        has_resume=False,
    )
    db.add(session)
    db.flush()

    if payload.candidate_name and payload.candidate_email:
        candidate = Candidate(
            session_id=session.id,
            name=payload.candidate_name.strip(),
            email=payload.candidate_email.strip(),
        )
        db.add(candidate)

    db.commit()
    db.refresh(session)

    return SessionResponse(
        id=session.id,
        token=session.token,
        job_title=session.job_title,
        status=session.status,
        question_count=session.question_count,
        difficulty=session.difficulty,
        duration_minutes=session.duration_minutes,
        candidate_name=session.candidate_name,
        candidate_email=session.candidate_email,
        invite_url=f"/interview/{session.token}",
        has_resume=session.has_resume,
        created_at=session.created_at,
    )


@router.post("/{session_id}/resume", response_model=ResumeUploadResponse)
async def upload_resume(
    session_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    session = db.query(JobSession).filter(JobSession.id == session_id).first()
    if not session:
        raise_api_error(status.HTTP_404_NOT_FOUND, "Session not found", "SESSION_NOT_FOUND")

    content = await file.read()
    extracted_text, char_count, preview = parse_resume(file.filename or "", content)

    session.has_resume = True
    session.resume_filename = file.filename
    session.resume_text = extracted_text
    db.commit()
    db.refresh(session)

    return ResumeUploadResponse(
        session_id=session.id,
        filename=file.filename or "unknown",
        parsed_character_count=char_count,
        extracted_preview=preview,
    )


@router.get("", response_model=SessionListResponse)
def list_sessions(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(JobSession)
    if status_filter:
        query = query.filter(JobSession.status == status_filter)

    total = query.count()
    sessions = query.order_by(JobSession.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for s in sessions:
        items.append(
            SessionListItem(
                id=s.id,
                token=s.token,
                job_title=s.job_title,
                candidate_name=s.candidate_name,
                candidate_email=s.candidate_email,
                status=s.status,
                question_count=s.question_count,
                difficulty=s.difficulty,
                duration_minutes=s.duration_minutes,
                overall_score=s.scorecard.overall_score if s.scorecard else None,
                recommendation=s.scorecard.recommendation if s.scorecard else None,
                created_at=s.created_at,
                completed_at=s.completed_at,
            )
        )

    return SessionListResponse(items=items, total=total)


@router.get("/by-token/{token}", response_model=CandidateSessionInfo)
def get_session_by_token(
    token: str,
    db: Session = Depends(get_db),
):
    session = db.query(JobSession).filter(JobSession.token == token).first()
    if not session:
        raise_api_error(status.HTTP_404_NOT_FOUND, "Session not found", "SESSION_NOT_FOUND")

    return CandidateSessionInfo(
        id=session.id,
        token=session.token,
        job_title=session.job_title,
        candidate_name=session.candidate_name,
        candidate_email=session.candidate_email,
        status=session.status,
        question_count=session.question_count,
        difficulty=session.difficulty,
        duration_minutes=session.duration_minutes,
        created_at=session.created_at,
    )


@router.get("/{session_id}/scorecard", response_model=ScorecardResponse)
def get_scorecard(
    session_id: str,
    db: Session = Depends(get_db),
):
    session = db.query(JobSession).filter(JobSession.id == session_id).first()
    if not session:
        raise_api_error(status.HTTP_404_NOT_FOUND, "Session not found", "SESSION_NOT_FOUND")

    if not session.scorecard:
        raise_api_error(
            status.HTTP_404_NOT_FOUND,
            "Scorecard not found for this session",
            "SCORECARD_NOT_FOUND",
        )

    scorecard = session.scorecard

    # Gather turn evaluations
    evaluations = []
    # Index turns by turn_index
    turns_by_index = {}
    for t in session.turns:
        turns_by_index.setdefault(t.turn_index, {})[t.speaker] = t

    for idx, speakers in sorted(turns_by_index.items()):
        cand_turn = speakers.get("candidate")
        interviewer_turn = speakers.get("interviewer")
        if cand_turn and cand_turn.evaluation:
            eval_data = cand_turn.evaluation
            evaluations.append(
                EvaluationTurnItem(
                    turn_index=idx,
                    topic=cand_turn.topic or (interviewer_turn.topic if interviewer_turn else None),
                    question=interviewer_turn.text if interviewer_turn else "",
                    answer=cand_turn.text,
                    is_follow_up=cand_turn.is_follow_up,
                    scores=DimensionScores(
                        relevance=eval_data.relevance,
                        depth=eval_data.depth,
                        correctness=eval_data.correctness,
                        communication=eval_data.communication,
                    ),
                    feedback=eval_data.feedback,
                )
            )

    return ScorecardResponse(
        session_id=session.id,
        candidate_name=session.candidate_name,
        job_title=session.job_title,
        status=session.status,
        duration_seconds=scorecard.duration_seconds,
        overall_score=scorecard.overall_score,
        recommendation=scorecard.recommendation,
        dimension_scores=DimensionScores(
            relevance=scorecard.dimension_relevance,
            depth=scorecard.dimension_depth,
            correctness=scorecard.dimension_correctness,
            communication=scorecard.dimension_communication,
        ),
        summary=scorecard.summary,
        strengths=scorecard.strengths if isinstance(scorecard.strengths, list) else [],
        growth_areas=scorecard.growth_areas if isinstance(scorecard.growth_areas, list) else [],
        evaluations=evaluations,
    )


@router.get("/{session_id}/transcript", response_model=TranscriptResponse)
def get_transcript(
    session_id: str,
    db: Session = Depends(get_db),
):
    session = db.query(JobSession).filter(JobSession.id == session_id).first()
    if not session:
        raise_api_error(status.HTTP_404_NOT_FOUND, "Session not found", "SESSION_NOT_FOUND")

    turns = [
        TranscriptTurnItem(
            turn_index=t.turn_index,
            speaker=t.speaker,
            text=t.text,
            timestamp=t.timestamp,
        )
        for t in session.turns
    ]

    return TranscriptResponse(session_id=session.id, turns=turns)
