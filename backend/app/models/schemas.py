from datetime import datetime
from typing import List, Optional, Any
from pydantic import BaseModel, Field, ConfigDict


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "interview-agent-api"
    version: str = "1.0.0"
    deepgram_configured: bool
    nvidia_configured: bool


class SessionCreateRequest(BaseModel):
    job_title: str = Field(..., min_length=1, max_length=255)
    jd_text: str = Field(..., min_length=10)
    question_count: int = Field(default=8, ge=5, le=15)
    difficulty: str = Field(default="Senior")
    duration_minutes: int = Field(default=30, ge=15, le=60)
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None


class SessionResponse(BaseModel):
    id: str
    token: str
    job_title: str
    status: str
    question_count: int
    difficulty: str
    duration_minutes: int
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    invite_url: str
    has_resume: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ResumeUploadResponse(BaseModel):
    session_id: str
    filename: str
    parsed_character_count: int
    extracted_preview: str


class SessionListItem(BaseModel):
    id: str
    token: str
    job_title: str
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    status: str
    question_count: int
    difficulty: str
    duration_minutes: int
    overall_score: Optional[float] = None
    recommendation: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class SessionListResponse(BaseModel):
    items: List[SessionListItem]
    total: int


class CandidateSessionInfo(BaseModel):
    id: str
    token: str
    job_title: str
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    status: str
    question_count: int
    difficulty: str
    duration_minutes: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DimensionScores(BaseModel):
    relevance: float
    depth: float
    correctness: float
    communication: float


class EvaluationTurnItem(BaseModel):
    turn_index: int
    topic: Optional[str] = None
    question: str
    answer: str
    is_follow_up: bool = False
    scores: DimensionScores
    feedback: Optional[str] = None


class ScorecardResponse(BaseModel):
    session_id: str
    candidate_name: Optional[str] = None
    job_title: str
    status: str
    duration_seconds: int
    overall_score: float
    recommendation: str
    dimension_scores: DimensionScores
    summary: str
    strengths: List[str]
    growth_areas: List[str]
    evaluations: List[EvaluationTurnItem] = []


class TranscriptTurnItem(BaseModel):
    turn_index: int
    speaker: str
    text: str
    timestamp: datetime


class TranscriptResponse(BaseModel):
    session_id: str
    turns: List[TranscriptTurnItem]


class ErrorDetail(BaseModel):
    detail: str
    code: str
    errors: Optional[List[Any]] = []
