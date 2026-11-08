import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from langgraph.graph import StateGraph, START, END

from backend.app.interview.nodes import (
    ask_question_node,
    closing_node,
    decide_next_node,
    evaluate_answer_node,
    follow_up_node,
    greeting_node,
    scorecard_node,
    steering_node,
    topic_generation_node,
)
from backend.app.interview.state import InterviewState

logger = logging.getLogger(__name__)


def route_entry(state: InterviewState) -> str:
    """Routes initial invocation vs. ongoing answer processing."""
    if not state.get("topics"):
        return "topic_generation"
    if state.get("phase") == "completed":
        return END
    return "steering"


def route_after_steering(state: InterviewState) -> str:
    """If drift was detected, pause and wait for candidate redirect response; otherwise evaluate."""
    if state.get("needs_steering"):
        return END
    return "evaluate_answer"


def route_after_decide(state: InterviewState) -> str:
    """Routes to follow-up, next topic question, or interview closing."""
    action = state.get("next_action")
    if action == "follow_up":
        return "follow_up"
    elif action == "ask":
        return "ask_question"
    else:
        return "closing"


def create_interview_graph():
    """
    Assembles and compiles the LangGraph interview state machine.
    """
    builder = StateGraph(InterviewState)

    # Register nodes
    builder.add_node("topic_generation", topic_generation_node)
    builder.add_node("greeting", greeting_node)
    builder.add_node("ask_question", ask_question_node)
    builder.add_node("steering", steering_node)
    builder.add_node("evaluate_answer", evaluate_answer_node)
    builder.add_node("decide_next", decide_next_node)
    builder.add_node("follow_up", follow_up_node)
    builder.add_node("closing", closing_node)
    builder.add_node("scorecard", scorecard_node)

    # Edges & routing
    builder.add_conditional_edges(
        START,
        route_entry,
        {
            "topic_generation": "topic_generation",
            "steering": "steering",
            END: END,
        },
    )

    # Startup sequence: topics -> greeting -> first question -> wait for candidate
    builder.add_edge("topic_generation", "greeting")
    builder.add_edge("greeting", "ask_question")
    builder.add_edge("ask_question", END)

    # Candidate turn sequence: steering check -> evaluation -> decision
    builder.add_conditional_edges(
        "steering",
        route_after_steering,
        {
            "evaluate_answer": "evaluate_answer",
            END: END,
        },
    )
    builder.add_edge("evaluate_answer", "decide_next")

    # Decision branching: follow-up | ask next topic | close
    builder.add_conditional_edges(
        "decide_next",
        route_after_decide,
        {
            "follow_up": "follow_up",
            "ask_question": "ask_question",
            "closing": "closing",
        },
    )

    builder.add_edge("follow_up", END)
    builder.add_edge("closing", "scorecard")
    builder.add_edge("scorecard", END)

    return builder.compile()


def initialize_interview(
    session_id: str,
    job_title: str,
    jd_text: str,
    resume_text: Optional[str] = None,
    candidate_name: Optional[str] = "Candidate",
    candidate_email: Optional[str] = "",
    config: Optional[Dict[str, Any]] = None,
    graph: Optional[Any] = None,
) -> InterviewState:
    """
    Initializes a new interview session: extracts topics, generates greeting and initial question.
    """
    if config is None:
        config = {
            "question_count": 8,
            "difficulty": "Mid-level",
            "duration_minutes": 30,
        }

    initial_state: InterviewState = {
        "session_id": session_id,
        "job_title": job_title,
        "jd_text": jd_text,
        "resume_text": resume_text or "",
        "candidate_name": candidate_name or "Candidate",
        "candidate_email": candidate_email or "",
        "config": config,
        "topics": [],
        "current_topic_index": 0,
        "current_question": "",
        "current_turn_index": 0,
        "follow_up_count": 0,
        "last_candidate_answer": "",
        "evaluations": [],
        "messages": [],
        "phase": "greeting",
        "scorecard": None,
        "is_follow_up": False,
        "needs_steering": False,
        "steering_message": None,
        "time_elapsed_seconds": 0,
        "next_action": None,
        "last_evaluation": None,
    }

    if graph is None:
        graph = create_interview_graph()

    return graph.invoke(initial_state)


def step_interview(
    graph: Any,
    state: InterviewState,
    candidate_answer: Optional[str] = None,
    time_elapsed_seconds: Optional[int] = None,
) -> InterviewState:
    """
    Steps the interview graph forward given candidate's answer and elapsed time.
    """
    new_state = dict(state)

    if time_elapsed_seconds is not None:
        new_state["time_elapsed_seconds"] = time_elapsed_seconds

    if candidate_answer is not None:
        new_state["last_candidate_answer"] = candidate_answer
        messages = list(new_state.get("messages", []))
        messages.append({
            "role": "candidate",
            "content": candidate_answer,
            "type": "candidate_answer",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        new_state["messages"] = messages

    return graph.invoke(new_state)
