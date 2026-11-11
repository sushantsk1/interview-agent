from typing import TypedDict, List, Dict, Any, Optional

class Topic(TypedDict):
    id: int
    name: str
    description: str
    type: str  # "technical" | "experience" | "behavioral"

class DimensionScores(TypedDict):
    relevance: float
    depth: float
    correctness: float
    communication: float

class TurnEvaluation(TypedDict):
    turn_index: int
    topic: str
    question: str
    answer: str
    is_follow_up: bool
    scores: DimensionScores
    feedback: str

class Message(TypedDict):
    role: str  # "interviewer" | "candidate" | "system"
    content: str
    type: str  # "greeting" | "question" | "follow_up" | "steering" | "closing" | "candidate_answer"
    timestamp: Optional[str]

class Scorecard(TypedDict):
    overall_score: float
    dimension_scores: DimensionScores
    recommendation: str  # "Strong Hire" | "Hire" | "Borderline" | "Do Not Hire"
    summary: str
    strengths: List[str]
    growth_areas: List[str]

class InterviewState(TypedDict, total=False):
    session_id: str
    job_title: str
    jd_text: str
    resume_text: Optional[str]
    candidate_name: Optional[str]
    candidate_email: Optional[str]
    config: Dict[str, Any]  # question_count, difficulty, duration_minutes
    topics: List[Topic]
    current_topic_index: int
    current_question: str
    current_turn_index: int
    follow_up_count: int  # strictly <= 2 per topic
    last_candidate_answer: str
    evaluations: List[TurnEvaluation]
    messages: List[Message]
    phase: str  # 'greeting' | 'questioning' | 'closing' | 'completed'
    scorecard: Optional[Scorecard]
    
    # Routing and runtime fields
    is_follow_up: bool
    needs_steering: bool
    steering_message: Optional[str]
    time_elapsed_seconds: int
    next_action: Optional[str]
    last_evaluation: Optional[TurnEvaluation]

    follow_up_proposal: Optional[Dict[str, Any]]
