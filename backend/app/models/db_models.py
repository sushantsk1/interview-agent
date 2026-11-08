import uuid
import secrets
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Text,
    Integer,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
)
from sqlalchemy.orm import relationship
from backend.app.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


def generate_token() -> str:
    return secrets.token_hex(6)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobSession(Base):
    __tablename__ = "job_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    token = Column(String(64), unique=True, index=True, nullable=False, default=generate_token)
    job_title = Column(String(255), nullable=False)
    jd_text = Column(Text, nullable=False)
    question_count = Column(Integer, default=8, nullable=False)
    difficulty = Column(String(50), default="Senior", nullable=False)
    duration_minutes = Column(Integer, default=30, nullable=False)
    candidate_name = Column(String(255), nullable=True)
    candidate_email = Column(String(255), nullable=True)
    status = Column(String(50), default="pending", nullable=False)
    has_resume = Column(Boolean, default=False, nullable=False)
    resume_filename = Column(String(255), nullable=True)
    resume_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    candidates = relationship(
        "Candidate", back_populates="session", cascade="all, delete-orphan"
    )
    turns = relationship(
        "InterviewTurn",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="InterviewTurn.turn_index",
    )
    scorecard = relationship(
        "FinalScorecard",
        back_populates="session",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(
        String(36), ForeignKey("job_sessions.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    session = relationship("JobSession", back_populates="candidates")


class InterviewTurn(Base):
    __tablename__ = "interview_turns"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(
        String(36), ForeignKey("job_sessions.id", ondelete="CASCADE"), nullable=False
    )
    turn_index = Column(Integer, nullable=False)
    speaker = Column(String(50), nullable=False)  # "interviewer" or "candidate"
    topic = Column(String(255), nullable=True)
    text = Column(Text, nullable=False)
    is_follow_up = Column(Boolean, default=False, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    session = relationship("JobSession", back_populates="turns")
    evaluation = relationship(
        "TurnEvaluation",
        back_populates="turn",
        uselist=False,
        cascade="all, delete-orphan",
    )


class TurnEvaluation(Base):
    __tablename__ = "turn_evaluations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    turn_id = Column(
        String(36), ForeignKey("interview_turns.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    relevance = Column(Float, nullable=False, default=0.0)
    depth = Column(Float, nullable=False, default=0.0)
    correctness = Column(Float, nullable=False, default=0.0)
    communication = Column(Float, nullable=False, default=0.0)
    feedback = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    turn = relationship("InterviewTurn", back_populates="evaluation")


class FinalScorecard(Base):
    __tablename__ = "final_scorecards"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(
        String(36), ForeignKey("job_sessions.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    overall_score = Column(Float, nullable=False, default=0.0)
    recommendation = Column(String(50), nullable=False)  # "Strong Hire", "Hire", "Borderline", "Do Not Hire"
    dimension_relevance = Column(Float, nullable=False, default=0.0)
    dimension_depth = Column(Float, nullable=False, default=0.0)
    dimension_correctness = Column(Float, nullable=False, default=0.0)
    dimension_communication = Column(Float, nullable=False, default=0.0)
    summary = Column(Text, nullable=False)
    strengths = Column(JSON, nullable=False, default=list)
    growth_areas = Column(JSON, nullable=False, default=list)
    duration_seconds = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    session = relationship("JobSession", back_populates="scorecard")
