import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.interview.llm_factory import get_llm, safe_llm_invoke
from backend.app.interview.prompts import (
    CLOSING_PROMPT,
    EVALUATION_PROMPT,
    FOLLOW_UP_PROMPT,
    GREETING_PROMPT,
    QUESTION_GENERATION_PROMPT,
    SCORECARD_PROMPT,
    STEERING_PROMPT,
    TOPIC_GENERATION_PROMPT,
)
from backend.app.interview.state import (
    DimensionScores,
    InterviewState,
    Message,
    Scorecard,
    Topic,
    TurnEvaluation,
)

logger = logging.getLogger(__name__)


def parse_json_from_llm(text: str, default: Any = None) -> Any:
    """Robust parser for LLM JSON output handling fences and formatting quirks."""
    if not text:
        return default
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"(\[.*\]|\{.*\})", cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except Exception:
                pass
    return default


def clamp(val: float, low: float = 0.0, high: float = 10.0) -> float:
    return max(low, min(high, round(float(val), 1)))


def topic_generation_node(state: InterviewState) -> Dict[str, Any]:
    """
    Extracts 3-5 competency topics from JD and Resume (AC-015).
    """
    existing_topics = state.get("topics")
    if existing_topics and len(existing_topics) >= 2:
        return {"topics": existing_topics, "current_topic_index": 0}

    job_title = state.get("job_title", "Software Engineer")
    jd_text = state.get("jd_text", "")
    resume_text = state.get("resume_text") or "No resume provided."
    question_count = state.get("config", {}).get("question_count", 8)
    topic_count = max(3, min(5, question_count // 2 if question_count >= 6 else 3))

    prompt = TOPIC_GENERATION_PROMPT.format(
        job_title=job_title,
        jd_text=jd_text,
        resume_text=resume_text,
        topic_count=topic_count,
    )

    llm = get_llm(temperature=0.2)
    response_text = safe_llm_invoke(llm, prompt)
    raw_topics = parse_json_from_llm(response_text, [])

    topics: List[Topic] = []
    if isinstance(raw_topics, list) and len(raw_topics) >= 2:
        for i, t in enumerate(raw_topics):
            if isinstance(t, dict):
                topics.append(
                    Topic(
                        id=t.get("id", i + 1),
                        name=t.get("name", f"Competency {i+1}"),
                        description=t.get("description", "Evaluation of core skills"),
                        type=t.get("type", "technical" if i < 2 else "behavioral"),
                    )
                )

    if not topics or len(topics) < 2:
        topics = [
            Topic(
                id=1,
                name="Core Technical Skills",
                description=f"Core technical competencies and framework proficiency required for {job_title}.",
                type="technical",
            ),
            Topic(
                id=2,
                name="System Architecture & Data Design",
                description="Distributed architecture, scalability, persistence, and reliability.",
                type="technical",
            ),
            Topic(
                id=3,
                name="Production Experience & Troubleshooting",
                description="Handling outages, observability, debugging, and continuous delivery.",
                type="experience",
            ),
            Topic(
                id=4,
                name="Behavioral & Engineering Leadership",
                description="Collaboration, architectural trade-offs, code reviews, and mentorship.",
                type="behavioral",
            ),
        ]

    return {"topics": topics, "current_topic_index": 0}


def greeting_node(state: InterviewState) -> Dict[str, Any]:
    """
    Welcomes candidate, explains the interview structure (AC-010).
    Uses a responsive, instant greeting to eliminate startup latency.
    """
    job_title = state.get("job_title", "Technical Position")
    candidate_name = state.get("candidate_name") or "Candidate"

    greeting_text = (
        f"Hello {candidate_name}! Welcome to your technical interview for the {job_title} role. "
        "We'll cover your technical expertise, system design, and practical experience. Let's begin."
    )

    messages = list(state.get("messages", []))
    msg: Message = {
        "role": "interviewer",
        "content": greeting_text,
        "type": "greeting",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    messages.append(msg)

    return {
        "messages": messages,
        "phase": "greeting",
    }


def ask_question_node(state: InterviewState) -> Dict[str, Any]:
    """
    Synthesizes and asks the primary question for the current topic (AC-015).
    """
    topics = state.get("topics", [])
    topic_idx = state.get("current_topic_index", 0)

    if topic_idx >= len(topics):
        return {"next_action": "close"}

    current_topic = topics[topic_idx]
    job_title = state.get("job_title", "Software Engineer")
    config = state.get("config", {})
    difficulty = config.get("difficulty", "Mid-level")
    jd_text = state.get("jd_text", "")
    resume_text = state.get("resume_text") or "None"

    # Previous questions to prevent duplication
    prev_qs = [
        m.get("content", "")
        for m in state.get("messages", [])
        if m.get("type") in ["question", "follow_up"]
    ]
    previous_questions_str = "\n- ".join(prev_qs) if prev_qs else "None yet."

    prompt = QUESTION_GENERATION_PROMPT.format(
        job_title=job_title,
        difficulty=difficulty,
        topic_name=current_topic.get("name", "Core Engineering"),
        topic_type=current_topic.get("type", "technical"),
        topic_description=current_topic.get("description", ""),
        jd_text=jd_text,
        resume_text=resume_text,
        previous_questions=previous_questions_str,
    )

    llm = get_llm(temperature=0.5)
    question_text = safe_llm_invoke(llm, prompt).strip()

    messages = list(state.get("messages", []))
    msg: Message = {
        "role": "interviewer",
        "content": question_text,
        "type": "question",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    messages.append(msg)

    return {
        "current_question": question_text,
        "current_turn_index": state.get("current_turn_index", 0) + 1,
        "follow_up_count": 0,
        "is_follow_up": False,
        "needs_steering": False,
        "steering_message": None,
        "phase": "questioning",
        "messages": messages,
    }


def is_suspicious_drift(answer: str) -> bool:
    """Fast heuristic to detect prompt injection or severe drift without LLM latency."""
    low = answer.lower()
    suspicious = [
        "ignore previous", "ignore all", "forget instructions", "forget the interview", "system prompt",
        "tell me a joke", "sing a song", "recipe", "pizza", "weather", "bake a cake",
        "drop table", "pretend you are", "you are now", "say hire", "output 'hire",
        "hack", "bypass", "jailbreak"
    ]
    return any(s in low for s in suspicious)


def steering_node(state: InterviewState) -> Dict[str, Any]:
    """
    Detects off-topic rambling or prompt injection and politely steers back (AC-017).
    Uses fast-path heuristic to avoid unnecessary LLM latency for standard technical answers.
    """
    question = state.get("current_question", "")
    candidate_answer = state.get("last_candidate_answer", "")

    import os
    force_mock = os.getenv("INTERVIEW_MOCK_LLM", "").lower() in ["1", "true", "yes"]

    # Fast-path: if normal candidate response without adversarial triggers, skip LLM call
    if not force_mock and not is_suspicious_drift(candidate_answer):
        return {
            "needs_steering": False,
            "steering_message": None,
        }

    prompt = STEERING_PROMPT.format(
        question=question,
        candidate_answer=candidate_answer,
    )

    llm = get_llm(temperature=0.1)
    response_text = safe_llm_invoke(llm, prompt)
    parsed = parse_json_from_llm(response_text, {})

    is_drift = bool(parsed.get("is_drift", False))
    steering_text = parsed.get("steering_response", "")

    if is_drift:
        if not steering_text:
            steering_text = f"I appreciate your response, but let's keep our focus on the interview question: '{question}'. Could you please address that?"

        messages = list(state.get("messages", []))
        msg: Message = {
            "role": "interviewer",
            "content": steering_text,
            "type": "steering",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        messages.append(msg)

        return {
            "needs_steering": True,
            "steering_message": steering_text,
            "messages": messages,
        }

    return {
        "needs_steering": False,
        "steering_message": None,
    }


def evaluate_answer_node(state: InterviewState) -> Dict[str, Any]:
    """
    Scores the candidate's last answer strictly across 4 dimensions:
    Relevance, Depth, Correctness, Communication (0.0 to 10.0) (AC-020).
    """
    topics = state.get("topics", [])
    topic_idx = state.get("current_topic_index", 0)
    topic_name = topics[topic_idx]["name"] if topic_idx < len(topics) else "General"

    question = state.get("current_question", "")
    candidate_answer = state.get("last_candidate_answer", "")
    job_title = state.get("job_title", "Software Engineer")
    jd_text = state.get("jd_text", "")

    prompt = EVALUATION_PROMPT.format(
        job_title=job_title,
        topic_name=topic_name,
        question=question,
        candidate_answer=candidate_answer,
        jd_text=jd_text,
    )

    llm = get_llm(temperature=0.2)
    response_text = safe_llm_invoke(llm, prompt)
    parsed = parse_json_from_llm(response_text, {})

    # Defaults
    rel = clamp(parsed.get("relevance", 7.0))
    dep = clamp(parsed.get("depth", 6.5))
    cor = clamp(parsed.get("correctness", 7.0))
    com = clamp(parsed.get("communication", 7.5))
    feedback = str(parsed.get("feedback", "Answer demonstrated basic competency.")).strip()

    # Handling short / 'I don't know' answers (AC-018)
    no_knowledge_markers = [
        "don't know", "do not know", "no experience", "haven't used",
        "have not used", "not sure", "no idea", "pass"
    ]
    if any(m in candidate_answer.lower() for m in no_knowledge_markers):
        rel = min(rel, 5.0)
        dep = min(dep, 2.0)
        cor = min(cor, 2.0)
        feedback = "Candidate honestly stated they did not have direct experience with this concept."

    eval_record: TurnEvaluation = {
        "turn_index": state.get("current_turn_index", 1),
        "topic": topic_name,
        "question": question,
        "answer": candidate_answer,
        "is_follow_up": state.get("is_follow_up", False),
        "scores": {
            "relevance": rel,
            "depth": dep,
            "correctness": cor,
            "communication": com,
        },
        "feedback": feedback,
    }

    evaluations = list(state.get("evaluations", []))
    evaluations.append(eval_record)

    return {
        "evaluations": evaluations,
        "last_evaluation": eval_record,
    }


def decide_next_node(state: InterviewState) -> Dict[str, Any]:
    """
    Determines next action:
    - Duration cap / question count reached -> close (AC-019)
    - "I don't know" / short answer -> advance topic without stalling (AC-018)
    - Follow-up warranted & follow_up_count < 2 -> follow-up (AC-016)
    - Otherwise -> advance topic or close
    """
    config = state.get("config", {})
    duration_minutes = config.get("duration_minutes", 30)
    question_count_cap = config.get("question_count", 8)
    time_elapsed = state.get("time_elapsed_seconds", 0)

    # 1. Time cap reached (AC-019)
    if time_elapsed >= duration_minutes * 60:
        return {"next_action": "close"}

    # 2. Total question turns quota reached (AC-019)
    evaluations = state.get("evaluations", [])
    if len(evaluations) >= question_count_cap:
        return {"next_action": "close"}

    # 3. Handle 'I don't know' / short answer without stalling (AC-018)
    candidate_answer = state.get("last_candidate_answer", "").lower()
    no_knowledge_markers = [
        "don't know", "do not know", "no experience", "haven't used",
        "have not used", "not sure", "no idea"
    ]
    if any(m in candidate_answer for m in no_knowledge_markers):
        # Do not probe further; advance to next topic
        topics = state.get("topics", [])
        next_topic_idx = state.get("current_topic_index", 0) + 1
        if next_topic_idx < len(topics):
            return {
                "next_action": "ask",
                "current_topic_index": next_topic_idx,
                "follow_up_count": 0,
            }
        else:
            return {"next_action": "close"}

    # 4. Adaptive follow-up logic & hard cap (AC-016)
    follow_up_count = state.get("follow_up_count", 0)
    if follow_up_count < 2:
        topics = state.get("topics", [])
        topic_idx = state.get("current_topic_index", 0)
        topic_name = topics[topic_idx]["name"] if topic_idx < len(topics) else "General"
        job_title = state.get("job_title", "Software Engineer")
        difficulty = config.get("difficulty", "Mid-level")
        question = state.get("current_question", "")
        jd_text = state.get("jd_text", "")

        prompt = FOLLOW_UP_PROMPT.format(
            job_title=job_title,
            topic_name=topic_name,
            difficulty=difficulty,
            question=question,
            candidate_answer=state.get("last_candidate_answer", ""),
            jd_text=jd_text,
        )

        llm = get_llm(temperature=0.3)
        response_text = safe_llm_invoke(llm, prompt)
        parsed = parse_json_from_llm(response_text, {})

        needs_follow_up = bool(parsed.get("needs_follow_up", False))
        follow_up_q = parsed.get("follow_up_question", "").strip()

        if needs_follow_up and follow_up_q:
            return {
                "next_action": "follow_up",
                "current_question": follow_up_q,
            }

    # 5. Advance to next topic
    topics = state.get("topics", [])
    next_topic_idx = state.get("current_topic_index", 0) + 1
    if next_topic_idx < len(topics):
        return {
            "next_action": "ask",
            "current_topic_index": next_topic_idx,
            "follow_up_count": 0,
        }

    return {"next_action": "close"}


def follow_up_node(state: InterviewState) -> Dict[str, Any]:
    """
    Asks the adaptive follow-up question and increments follow_up_count (AC-016).
    """
    question_text = state.get("current_question", "")
    messages = list(state.get("messages", []))

    msg: Message = {
        "role": "interviewer",
        "content": question_text,
        "type": "follow_up",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    messages.append(msg)

    return {
        "current_turn_index": state.get("current_turn_index", 0) + 1,
        "follow_up_count": state.get("follow_up_count", 0) + 1,
        "is_follow_up": True,
        "needs_steering": False,
        "steering_message": None,
        "phase": "questioning",
        "messages": messages,
    }


def closing_node(state: InterviewState) -> Dict[str, Any]:
    """
    Generates wrap-up remarks and concludes the session (AC-019).
    """
    job_title = state.get("job_title", "Technical Position")
    candidate_name = state.get("candidate_name") or "Candidate"

    prompt = CLOSING_PROMPT.format(
        job_title=job_title,
        candidate_name=candidate_name,
    )

    llm = get_llm(temperature=0.3)
    closing_text = safe_llm_invoke(llm, prompt).strip()

    messages = list(state.get("messages", []))
    msg: Message = {
        "role": "interviewer",
        "content": closing_text,
        "type": "closing",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    messages.append(msg)

    return {
        "messages": messages,
        "phase": "closing",
    }


def scorecard_node(state: InterviewState) -> Dict[str, Any]:
    """
    Synthesizes overall score, dimension averages, strengths, growth areas,
    and final recommendation (AC-021).
    """
    evaluations = state.get("evaluations", [])
    job_title = state.get("job_title", "Software Engineer")
    candidate_name = state.get("candidate_name") or "Candidate"

    if evaluations:
        avg_rel = round(sum(e["scores"]["relevance"] for e in evaluations) / len(evaluations), 1)
        avg_dep = round(sum(e["scores"]["depth"] for e in evaluations) / len(evaluations), 1)
        avg_cor = round(sum(e["scores"]["correctness"] for e in evaluations) / len(evaluations), 1)
        avg_com = round(sum(e["scores"]["communication"] for e in evaluations) / len(evaluations), 1)
        overall_score = round((avg_rel + avg_dep + avg_cor + avg_com) / 4.0, 1)

        eval_summary_lines = []
        for e in evaluations:
            eval_summary_lines.append(
                f"- [{e.get('topic')}] Q: {e.get('question')} | Scores: Rel {e['scores']['relevance']}, Dep {e['scores']['depth']}, Cor {e['scores']['correctness']}, Com {e['scores']['communication']} | Feedback: {e.get('feedback')}"
            )
        eval_summary = "\n".join(eval_summary_lines)
    else:
        avg_rel = 5.0
        avg_dep = 5.0
        avg_cor = 5.0
        avg_com = 5.0
        overall_score = 5.0
        eval_summary = "No questions completed."

    prompt = SCORECARD_PROMPT.format(
        job_title=job_title,
        candidate_name=candidate_name,
        evaluations_summary=eval_summary,
        avg_relevance=avg_rel,
        avg_depth=avg_dep,
        avg_correctness=avg_cor,
        avg_communication=avg_com,
        overall_score=overall_score,
    )

    llm = get_llm(temperature=0.2)
    response_text = safe_llm_invoke(llm, prompt)
    parsed = parse_json_from_llm(response_text, {})

    # Recommendation validation
    valid_recs = ["Strong Hire", "Hire", "Borderline", "Do Not Hire"]
    rec = parsed.get("recommendation", "")
    if rec not in valid_recs:
        if overall_score >= 8.5:
            rec = "Strong Hire"
        elif overall_score >= 7.0:
            rec = "Hire"
        elif overall_score >= 5.0:
            rec = "Borderline"
        else:
            rec = "Do Not Hire"

    scorecard: Scorecard = {
        "overall_score": overall_score,
        "dimension_scores": {
            "relevance": avg_rel,
            "depth": avg_dep,
            "correctness": avg_cor,
            "communication": avg_com,
        },
        "recommendation": rec,
        "summary": str(
            parsed.get(
                "summary",
                f"Candidate completed {len(evaluations)} turns with an overall rating of {overall_score}/10.",
            )
        ),
        "strengths": parsed.get("strengths") or ["Good foundational knowledge", "Structured answers"],
        "growth_areas": parsed.get("growth_areas") or ["Could explore deeper edge-case details"],
    }

    return {
        "scorecard": scorecard,
        "phase": "completed",
    }
