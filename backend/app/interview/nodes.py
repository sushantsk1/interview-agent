import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.interview.llm_factory import get_llm, safe_llm_invoke
from backend.app.config import settings
from backend.app.observability import log_event
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


def is_no_knowledge_answer(answer: str) -> bool:
    lower = answer.lower()
    markers = (
        "don't know", "do not know", "no experience", "haven't used",
        "have not used", "not sure", "no idea",
    )
    return any(marker in lower for marker in markers) or bool(re.search(r"\bpass\b", lower))


def effective_difficulty(resume_text: str, configured: str, job_title: str = "", jd_text: str = "") -> str:
    """Use explicit resume experience as evidence, capped by recruiter difficulty."""
    ceiling = {"Junior": 0, "Mid-level": 1, "Senior": 2, "Lead": 2}.get(configured, 0)
    title_terms = {
        term.lower() for term in re.findall(r"[A-Za-z]{4,}", job_title)
        if term.lower() not in {"junior", "senior", "staff", "lead", "principal", "engineer", "developer", "analyst", "scientist", "manager", "role"}
    }
    skill_terms = {
        skill.lower() for skill in ("Python", "FastAPI", "Java", "JavaScript", "TypeScript", "React", "PostgreSQL", "Redis", "Kafka", "Kubernetes", "Docker", "AWS", "Azure", "Django", "Go", "Rust")
        if re.search(r"(?<!\w)" + re.escape(skill) + r"(?!\w)", jd_text, re.IGNORECASE)
    }
    relevant_terms = title_terms | skill_terms

    def relevant(line: str) -> bool:
        if not relevant_terms:
            return not job_title.strip() and not jd_text.strip()
        return any(re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", line, re.IGNORECASE) for term in relevant_terms)

    years = []
    for line in resume_text.splitlines():
        if not relevant(line):
            continue
        if not re.search(r"\b(?:experience|worked|working|engineer|developer|analyst|scientist|designer|manager|architect)\b", line, re.IGNORECASE):
            continue
        for match in re.finditer(r"\b(\d{1,2})\+?\s*(?:years?|yrs?)\b", line, re.IGNORECASE):
            if re.search(r"\b(?:projects?|project duration|ago)\b", line[max(0, match.start()-24):match.end()+24], re.IGNORECASE):
                continue
            years.append(int(match.group(1)))
    if years:
        observed = 2 if max(years) >= 6 else 1 if max(years) >= 3 else 0
    elif any(re.search(r"\b(?:senior|staff|principal|lead)\s+(?:\w+\s+){0,3}(?:engineer|developer|analyst|scientist|designer|manager)\b", line, re.IGNORECASE) and relevant(line) for line in resume_text.splitlines()):
        observed = 2
    else:
        observed = 0
    return ("Junior", "Mid-level", "Senior")[min(ceiling, observed)]


def quick_question_for_topic(topic: Topic, job_title: str, resume_text: str = "") -> str:
    """Form a short, speakable question from the actual topic context."""
    name = topic.get("name", job_title)
    if name == "Role Requirements & Problem Solving":
        requirement = topic.get("description", "").strip().rstrip(".?!")
        requirement = re.sub(r"^\d+\+?\s+years?\s+(?:of\s+)?", "", requirement, flags=re.IGNORECASE)
        requirement = re.sub(r"^(?:deep|strong|proven|hands-on)\s+", "", requirement, flags=re.IGNORECASE)
        requirement = re.sub(r"^(?:experience|expertise|knowledge|familiarity)\s+(?:with|in|of)\s+", "", requirement, flags=re.IGNORECASE)
        requirement = re.sub(r"^experience\s+", "", requirement, flags=re.IGNORECASE)
        requirement = re.sub(r"^(?:build|building|design|designing|lead|leading|develop|developing|create|creating|manage|managing|implement|implementing)\s+", "", requirement, flags=re.IGNORECASE)
        focus = re.split(r",|\band\b|\bincluding\b|\busing\b", requirement, maxsplit=1, flags=re.IGNORECASE)[0].strip()
        focus = " ".join(focus.split()[:6]).strip()
        if focus:
            matched = bool(re.search(r"(?<!\w)" + re.escape(focus) + r"(?!\w)", resume_text, re.IGNORECASE))
            return f"What have you done with {focus}?" if matched else f"What do you know about {focus}?"
        return f"What interests you about the {job_title} role?"
    if topic.get("type") == "behavioral":
        return "Tell me about a time you worked with someone to solve a problem."
    if name == "Candidate Experience":
        return "What did you do in one project from your resume?" if resume_text.strip() else "What relevant project would you like to discuss?"
    if topic.get("type") == "experience":
        focus = " ".join(name.split()[:6])
        matched = bool(re.search(r"(?<!\w)" + re.escape(focus) + r"(?!\w)", resume_text, re.IGNORECASE))
        return f"What did you do in a project involving {focus}?" if matched else f"What do you know about {focus}?"
    if name.startswith("Core Skills for "):
        return f"Which part of your experience fits the {job_title} role?" if resume_text.strip() else f"What interests you about the {job_title} role?"
    matched_skill = next((skill.strip() for skill in name.split(",") if re.search(r"(?<!\w)" + re.escape(skill.strip()) + r"(?!\w)", resume_text, re.IGNORECASE)), None)
    focus = matched_skill or name.split(",")[0].strip()
    focus = " ".join(focus.split()[:6])
    return f"What have you used {focus} for?" if matched_skill else f"What have you learned about {focus}?"


def concise_question(raw: str, fallback: str) -> str:
    """Reject long or multi-part model challenges instead of cutting speech mid-sentence."""
    question = raw.strip().strip('"“”').removeprefix("Question:").strip()
    words = re.findall(r"\b[\w'-]+\b", question)
    if not question or len(words) > 20 or "\n" in question or question.count("?") > 1 or ";" in question:
        return fallback
    if re.search(r"[.!?]\s+\S|\b(?:including|as well as|in addition|also explain|then explain|and how|and why|and what)\b", question, re.IGNORECASE):
        return fallback
    return question


def topic_generation_node(state: InterviewState) -> Dict[str, Any]:
    """
    Extracts competency topics without an extra model round trip on room entry.
    The question model still receives the job description and resume for grounding.
    """
    existing_topics = state.get("topics")
    if existing_topics and len(existing_topics) >= 2:
        return {"topics": existing_topics, "current_topic_index": 0}

    job_title = state.get("job_title", "Software Engineer")
    jd_text = state.get("jd_text", "")
    resume_text = state.get("resume_text") or ""
    skills = [
        "Python", "FastAPI", "Java", "JavaScript", "TypeScript", "React", "Node.js",
        "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "Kubernetes",
        "Docker", "AWS", "Azure", "GCP", "GraphQL", "Django", "Go", "Rust",
    ]
    required = [skill for skill in skills if re.search(r"(?<!\w)" + re.escape(skill) + r"(?!\w)", jd_text, re.IGNORECASE)]
    experience = [skill for skill in skills if re.search(r"(?<!\w)" + re.escape(skill) + r"(?!\w)", resume_text, re.IGNORECASE)]
    priority = required[:3]
    if not priority:
        priority = experience[:2]
    primary_name = ", ".join(priority) if priority else f"Core Skills for {job_title}"
    primary_description = (
        f"Discuss practical experience with {', '.join(priority)} in the {job_title} role."
        if priority else f"Discuss the primary technical requirements for the {job_title} role."
    )
    jd_requirements = [
        re.sub(r"^\s*[-*\u2022\d.)]+\s*", "", line).strip()
        for line in jd_text.splitlines()
        if line.strip().startswith(("-", "*", "\u2022"))
    ]
    jd_requirements = [line for line in jd_requirements if len(line) >= 12]
    role_requirement = jd_requirements[0] if jd_requirements else jd_text.strip()[:180]
    resume_lines = [line.strip(" -\u2022\t") for line in resume_text.splitlines() if len(line.strip()) >= 18]
    relevant_experience = resume_lines[0] if resume_lines else "Relevant production work, debugging, testing, and delivery experience."
    topics: List[Topic] = [
        Topic(id=1, name=primary_name, description=primary_description, type="technical"),
        Topic(id=2, name="Role Requirements & Problem Solving", description=role_requirement or f"Core requirements for {job_title}.", type="technical"),
        Topic(id=3, name="Candidate Experience", description=relevant_experience, type="experience"),
        Topic(id=4, name="Behavioral & Collaboration", description="Collaboration, trade-offs, communication, and leadership.", type="behavioral"),
    ]

    return {"topics": topics, "current_topic_index": 0}


def refine_topics_with_llm(state: InterviewState) -> Optional[List[Topic]]:
    """Refine later topics while the candidate hears and answers the first question."""
    if os.getenv("INTERVIEW_MOCK_LLM", "").lower() in ("1", "true", "yes") or not settings.NVIDIA_API_KEY:
        return None
    existing = list(state.get("topics", []))
    if not existing:
        return None
    prompt = TOPIC_GENERATION_PROMPT.format(
        job_title=state.get("job_title", "Software Engineer"),
        jd_text=state.get("jd_text", "")[:3000],
        resume_text=(state.get("resume_text") or "No resume provided.")[:1500],
        topic_count=4,
    )
    try:
        started = time.perf_counter()
        log_event(logger, logging.INFO, "model_started", stage="topic_refinement", model=settings.NVIDIA_MODEL)
        response = get_llm(temperature=0.2, max_tokens=450).invoke(prompt)
        log_event(logger, logging.INFO, "model_completed", stage="topic_refinement", duration_ms=round((time.perf_counter() - started) * 1000, 1))
        raw = parse_json_from_llm(str(response.content), [])
    except Exception as exc:
        log_event(logger, logging.WARNING, "model_fallback", stage="topic_refinement", error_type=type(exc).__name__)
        return None
    if not isinstance(raw, list):
        return None
    topics = [existing[0]]
    seen = {existing[0]["name"].casefold()}
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()[:100]
        if len(name) < 4 or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        topic_type = item.get("type", "technical")
        if topic_type not in ("technical", "experience", "behavioral"):
            topic_type = "technical"
        topics.append(Topic(
            id=len(topics) + 1,
            name=name,
            description=str(item.get("description", ""))[:240] or name,
            type=topic_type,
        ))
        if len(topics) == 4:
            break
    if len(topics) < 3:
        return None
    if not any(topic["type"] == "behavioral" for topic in topics):
        topics.append(existing[-1])
    return topics[:5]


def merge_refined_topics(current: List[Topic], refined: List[Topic], current_index: int) -> List[Topic]:
    """Keep topics already asked in place while improving the remaining plan."""
    preserved = list(current[:max(0, current_index + 1)])
    names = {topic["name"].casefold() for topic in preserved}
    merged = list(preserved)
    for topic in refined:
        if topic["name"].casefold() not in names and len(merged) < 5:
            merged.append(topic)
            names.add(topic["name"].casefold())
    if not any(topic["type"] == "behavioral" for topic in merged):
        behavioral = next((topic for topic in refined if topic["type"] == "behavioral"), None)
        if behavioral and len(preserved) < 5:
            if len(merged) == 5:
                merged[-1] = behavioral
            else:
                merged.append(behavioral)
    return [Topic(id=i + 1, name=topic["name"], description=topic["description"], type=topic["type"]) for i, topic in enumerate(merged)]


def greeting_node(state: InterviewState) -> Dict[str, Any]:
    """
    Welcomes candidate, explains the interview structure (AC-010).
    Uses a responsive, instant greeting to eliminate startup latency.
    """
    job_title = state.get("job_title", "Technical Position")
    candidate_name = state.get("candidate_name") or "Candidate"

    greeting_text = f"Hi {candidate_name}."

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
    difficulty = effective_difficulty(state.get("resume_text") or "", state.get("config", {}).get("difficulty", "Mid-level"), job_title, state.get("jd_text", ""))
    if state.get("current_turn_index", 0) == 0:
        # The opening turn is ready immediately from JD-ranked competencies.
        # Later turns use the lightweight NVIDIA model for adaptation.
        question_text = quick_question_for_topic(current_topic, job_title, state.get("resume_text") or "")
        log_event(logger, logging.INFO, "question_generated", question_source="opening_template", difficulty=difficulty)
        messages = list(state.get("messages", []))
        messages.append(Message(
            role="interviewer",
            content=question_text,
            type="question",
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
        return {
            "current_question": question_text,
            "current_turn_index": 1,
            "follow_up_count": 0,
            "is_follow_up": False,
            "needs_steering": False,
            "steering_message": None,
            "phase": "questioning",
            "messages": messages,
        }
    if is_no_knowledge_answer(state.get("last_candidate_answer", "")):
        question_text = quick_question_for_topic(current_topic, job_title, state.get("resume_text") or "")
        log_event(logger, logging.INFO, "question_generated", question_source="no_knowledge_template", difficulty=difficulty)
        messages = list(state.get("messages", []))
        messages.append(Message(
            role="interviewer", content=question_text, type="question",
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
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
    config = state.get("config", {})
    jd_text = state.get("jd_text", "")[:2500]
    resume_text = (state.get("resume_text") or "None")[:1200]

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

    llm = get_llm(temperature=0.4, max_tokens=160)
    raw_question = safe_llm_invoke(llm, prompt, stage="question")
    fallback_question = quick_question_for_topic(current_topic, job_title, state.get("resume_text") or "")
    question_text = concise_question(raw_question, fallback_question)
    source = "simplified_fallback" if question_text == fallback_question and raw_question.strip() != fallback_question else "model"
    log_event(logger, logging.INFO, "question_generated", question_source=source, difficulty=difficulty)

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
    response_text = safe_llm_invoke(llm, prompt, stage="steering")
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

    difficulty = effective_difficulty(state.get("resume_text") or "", state.get("config", {}).get("difficulty", "Mid-level"), job_title, jd_text)
    prompt = EVALUATION_PROMPT.format(
        job_title=job_title,
        difficulty=difficulty,
        topic_name=topic_name,
        question=question,
        candidate_answer=candidate_answer,
        jd_text=jd_text,
    )

    if is_no_knowledge_answer(candidate_answer):
        parsed = {
            "relevance": 4.0,
            "depth": 1.0,
            "correctness": 1.0,
            "communication": 6.0,
            "feedback": "Candidate stated they did not have direct experience with this concept.",
        }
    else:
        llm = get_llm(temperature=0.2, max_tokens=220)
        response_text = safe_llm_invoke(llm, prompt, stage="evaluation")
        parsed = parse_json_from_llm(response_text, {})

    # Defaults
    rel = clamp(parsed.get("relevance", 7.0))
    dep = clamp(parsed.get("depth", 6.5))
    cor = clamp(parsed.get("correctness", 7.0))
    com = clamp(parsed.get("communication", 7.5))
    feedback = str(parsed.get("feedback", "Answer demonstrated basic competency.")).strip()

    # Handling short / 'I don't know' answers (AC-018)
    if is_no_knowledge_answer(candidate_answer):
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
    if is_no_knowledge_answer(candidate_answer):
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
        question = state.get("current_question", "")
        jd_text = state.get("jd_text", "")
        difficulty = effective_difficulty(state.get("resume_text") or "", config.get("difficulty", "Mid-level"), job_title, jd_text)

        prompt = FOLLOW_UP_PROMPT.format(
            job_title=job_title,
            topic_name=topic_name,
            difficulty=difficulty,
            question=question,
            candidate_answer=state.get("last_candidate_answer", ""),
            jd_text=jd_text,
            resume_text=(state.get("resume_text") or "No resume provided.")[:1200],
        )

        llm = get_llm(temperature=0.3)
        response_text = safe_llm_invoke(llm, prompt, stage="followup")
        parsed = parse_json_from_llm(response_text, {})

        needs_follow_up = bool(parsed.get("needs_follow_up", False))
        raw_follow_up = str(parsed.get("follow_up_question", ""))
        follow_up_q = concise_question(
            raw_follow_up,
            "What was one step you took to check your work?",
        ) if needs_follow_up else ""

        if needs_follow_up and follow_up_q:
            source = "simplified_fallback" if follow_up_q != raw_follow_up.strip() else "model"
            log_event(logger, logging.INFO, "question_generated", question_source=source, difficulty=difficulty)
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
    closing_text = safe_llm_invoke(llm, prompt, stage="closing").strip()

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
    response_text = safe_llm_invoke(llm, prompt, stage="scorecard")
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
