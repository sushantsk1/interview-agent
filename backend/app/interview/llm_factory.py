import json
import logging
import os
import re
import time
from typing import Any, List, Optional
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage
from langchain_core.outputs import ChatResult, ChatGeneration
from backend.app.config import settings
from backend.app.observability import log_event

logger = logging.getLogger(__name__)

class MockChatModel(BaseChatModel):
    """
    Deterministic mock LLM for offline testing and graceful degradation (AC-028).
    Responds with valid structured JSON or conversational text tailored to interview prompts.
    """
    temperature: float = 0.3

    @property
    def _llm_type(self) -> str:
        return "mock-chat-model"

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[Any] = None,
        **kwargs: Any,
    ) -> ChatResult:
        full_text = " ".join([m.content if isinstance(m.content, str) else str(m.content) for m in messages])
        response_text = self.generate_deterministic_response(full_text)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=response_text))])

    def generate_deterministic_response(self, prompt: str) -> str:
        prompt_lower = prompt.lower()

        # 1. Topic generation prompt
        if "competency topics" in prompt_lower or "target number of topics" in prompt_lower:
            job_title = "Backend Engineer"
            m = re.search(r'role of "([^"]+)"', prompt)
            if m:
                job_title = m.group(1)

            return json.dumps([
                {
                    "id": 1,
                    "name": "Core Technical Proficiency",
                    "description": f"Core programming languages, frameworks, and architecture relevant to {job_title}.",
                    "type": "technical"
                },
                {
                    "id": 2,
                    "name": "System Design & Data Architecture",
                    "description": "Designing scalable systems, database selection, caching, and APIs.",
                    "type": "technical"
                },
                {
                    "id": 3,
                    "name": "Production Experience & Reliability",
                    "description": "Debugging production outages, observability, testing, and CI/CD.",
                    "type": "experience"
                },
                {
                    "id": 4,
                    "name": "Behavioral & Technical Leadership",
                    "description": "Collaboration, code reviews, handling technical trade-offs and ambiguity.",
                    "type": "behavioral"
                }
            ], indent=2)

        # 2. Anti-drift & steering prompt
        if "conversational guardrail analyzer" in prompt_lower or "is_drift" in prompt_lower:
            drift_patterns = [
                "ignore", "forget", "jailbreak", "bypass", "system prompt",
                "tell me a joke", "sing a song", "recipe", "pizza", "weather",
                "favorite movie", "what is the capital", "drop table", "pretend you are",
                "you are now", "say hire", "hire me", "output 'hire"
            ]

            # Check candidate answer section
            candidate_ans = ""
            m = re.search(r'candidate gave this response:\s*"?([^"\n\r]+(?:\n[^"\n\r]+)*)"?', prompt, re.IGNORECASE)
            if m:
                candidate_ans = m.group(1).lower()
            else:
                candidate_ans = prompt_lower

            is_drift = any(dp in candidate_ans for dp in drift_patterns)
            # Also check if ignore + instruction or forget + interview is present
            if ("ignore" in candidate_ans and "instruction" in candidate_ans) or \
               ("forget" in candidate_ans and ("interview" in candidate_ans or "instruction" in candidate_ans)):
                is_drift = True

            # Check for pure non-answer ramble
            if len(candidate_ans.split()) > 10 and not any(k in candidate_ans for k in ["i", "we", "system", "code", "python", "data", "test", "work", "design", "team", "api", "fastapi", "service"]):
                is_drift = True

            if is_drift:
                return json.dumps({
                    "is_drift": True,
                    "reason": "Input attempts prompt diversion, off-topic rambling, or instruction overriding.",
                    "steering_response": "I appreciate your input, but let's keep our focus on the interview question. Could you please share your technical response to the question?"
                }, indent=2)
            else:
                return json.dumps({
                    "is_drift": False,
                    "reason": "Response directly addresses the interview question or context.",
                    "steering_response": ""
                }, indent=2)

        # 3. Follow-up prompt
        if "adaptive follow-up question is warranted" in prompt_lower or "needs_follow_up" in prompt_lower:
            candidate_ans = ""
            m = re.search(r'Candidate Answer:\s*"([^"]*)"', prompt, re.IGNORECASE | re.DOTALL)
            if m:
                candidate_ans = m.group(1).strip().lower()

            # Handling Short / "I don't know" answers without stalling (AC-018)
            no_knowledge_markers = [
                "don't know", "do not know", "no experience", "haven't used",
                "have not used", "not sure", "no idea", "never worked with", "pass"
            ]
            if any(nkm in candidate_ans for nkm in no_knowledge_markers) or len(candidate_ans) < 15:
                return json.dumps({
                    "needs_follow_up": False,
                    "reason": "Candidate explicitly indicated lack of familiarity or gave minimal input. Moving forward smoothly.",
                    "follow_up_question": ""
                }, indent=2)

            return json.dumps({
                "needs_follow_up": True,
                "reason": "One practical detail in the answer is worth clarifying.",
                "follow_up_question": "What was one step you took to check that it worked?"
            }, indent=2)

        # 4. 4-Dimension Evaluation prompt (AC-020)
        if "score the answer strictly across these 4 dimensions" in prompt_lower or "relevance (0-10)" in prompt_lower:
            candidate_ans = ""
            m = re.search(r'Candidate\'s Answer:\s*"([^"]*)"', prompt, re.IGNORECASE | re.DOTALL)
            if m:
                candidate_ans = m.group(1).strip().lower()

            no_knowledge_markers = [
                "don't know", "do not know", "no experience", "haven't used",
                "have not used", "not sure", "no idea"
            ]
            if any(nkm in candidate_ans for nkm in no_knowledge_markers):
                return json.dumps({
                    "relevance": 4.0,
                    "depth": 2.0,
                    "correctness": 2.0,
                    "communication": 6.5,
                    "feedback": "Candidate honestly acknowledged lack of direct experience with this concept."
                }, indent=2)

            if len(candidate_ans) < 25:
                return json.dumps({
                    "relevance": 5.0,
                    "depth": 3.0,
                    "correctness": 4.0,
                    "communication": 5.0,
                    "feedback": "Answer was overly brief and did not provide sufficient technical context."
                }, indent=2)

            return json.dumps({
                "relevance": 8.5,
                "depth": 8.0,
                "correctness": 8.5,
                "communication": 8.5,
                "feedback": "Thorough, structured explanation demonstrating solid practical knowledge and awareness of trade-offs."
            }, indent=2)

        # 5. Scorecard prompt (AC-021)
        if "synthesize the final candidate evaluation" in prompt_lower or "overall average:" in prompt_lower:
            avg_rel = 8.0
            avg_dep = 7.5
            avg_cor = 8.0
            avg_com = 8.0
            overall = 7.9

            m_rel = re.search(r'Relevance:\s*([0-9.]+)', prompt)
            if m_rel: avg_rel = float(m_rel.group(1))
            m_dep = re.search(r'Depth:\s*([0-9.]+)', prompt)
            if m_dep: avg_dep = float(m_dep.group(1))
            m_cor = re.search(r'Correctness:\s*([0-9.]+)', prompt)
            if m_cor: avg_cor = float(m_cor.group(1))
            m_com = re.search(r'Communication:\s*([0-9.]+)', prompt)
            if m_com: avg_com = float(m_com.group(1))
            m_ov = re.search(r'Overall Average:\s*([0-9.]+)', prompt)
            if m_ov: overall = float(m_ov.group(1))

            if overall >= 8.5:
                rec = "Strong Hire"
            elif overall >= 7.0:
                rec = "Hire"
            elif overall >= 5.0:
                rec = "Borderline"
            else:
                rec = "Do Not Hire"

            return json.dumps({
                "overall_score": overall,
                "dimension_scores": {
                    "relevance": avg_rel,
                    "depth": avg_dep,
                    "correctness": avg_cor,
                    "communication": avg_com
                },
                "recommendation": rec,
                "summary": f"Candidate demonstrated {rec.lower()} potential with consistent technical proficiency and clear structured communication across turns.",
                "strengths": [
                    "Solid technical grasp of backend architecture and distributed systems",
                    "Clear, professional communication and practical trade-off analysis",
                    "Strong problem-solving instincts under production constraints"
                ],
                "growth_areas": [
                    "Could articulate deeper real-time observability metrics",
                    "Opportunity to expand on automated recovery patterns"
                ]
            }, indent=2)

        # 6. Greeting prompt
        if "opening greeting" in prompt_lower:
            job_title = "Technical Role"
            m = re.search(r'role of "([^"]+)"', prompt)
            if m: job_title = m.group(1)
            candidate_name = "Candidate"
            m_c = re.search(r'Candidate name:\s*([^\n\r]+)', prompt)
            if m_c and m_c.group(1).strip():
                candidate_name = m_c.group(1).strip()

            return f"Hello {candidate_name}! Welcome to your technical screening interview for {job_title}. We will cover several core technical competencies, architectural problem-solving, and your past engineering experiences. Whenever you are ready, let's begin!"

        # 7. Closing prompt
        if "concluding a technical interview" in prompt_lower or "closing statement" in prompt_lower:
            job_title = "Technical Role"
            m = re.search(r'role of "([^"]+)"', prompt)
            if m: job_title = m.group(1)
            return f"Thank you very much for your time and thoughtful responses today! That concludes our technical interview for {job_title}. Your responses have been saved and will be reviewed by the hiring team. Have a great day!"

        # 8. Question generation prompt
        if "generate one clear, engaging, open-ended question" in prompt_lower:
            topic_name = "Core Engineering"
            m_t = re.search(r'Current Topic:\s*([^\n\r(]+)', prompt)
            if m_t:
                topic_name = m_t.group(1).strip()

            if "system design" in topic_name.lower() or "data" in topic_name.lower():
                return "How did you use a database in a recent project?"
            elif "production" in topic_name.lower() or "reliability" in topic_name.lower():
                return "What did you do when a recent project had a bug?"
            elif "behavioral" in topic_name.lower() or "leadership" in topic_name.lower():
                return "Tell me about a time you worked with a teammate to solve a problem."
            elif topic_name.lower() in ("role requirements & problem solving", "candidate experience"):
                return "What is one relevant task you worked on recently?"
            else:
                return f"What have you used {topic_name} for in a project?"

        return "What is one project you enjoyed working on?"


def get_llm(temperature: float = 0.3, max_tokens: int = 400):
    """
    Returns ChatOpenAI pointed to NVIDIA NIM if NVIDIA_API_KEY is configured.
    Otherwise returns MockChatModel for offline, zero-key development & testing (AC-028).
    """
    force_mock = os.getenv("INTERVIEW_MOCK_LLM", "").lower() in ["1", "true", "yes"]
    api_key = settings.NVIDIA_API_KEY

    if not force_mock and api_key and api_key.strip():
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                api_key=api_key,
                base_url="https://integrate.api.nvidia.com/v1",
                model=settings.NVIDIA_MODEL,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=10.0,
                max_retries=0,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        except Exception as e:
            log_event(logger, logging.WARNING, "model_init_failed", stage="init", model=settings.NVIDIA_MODEL, error_type=type(e).__name__)
            return MockChatModel(temperature=temperature)

    return MockChatModel(temperature=temperature)


def safe_llm_invoke(llm: Any, prompt: str, stage: str = "unknown") -> str:
    """
    Safely invokes LLM with automatic fallback to MockChatModel if network/API fails (AC-028).
    """
    started = time.perf_counter()
    mock_mode = isinstance(llm, MockChatModel)
    log_event(logger, logging.INFO, "model_started", stage=stage, model=settings.NVIDIA_MODEL, mock_mode=mock_mode)
    try:
        response = llm.invoke(prompt)
        log_event(logger, logging.INFO, "model_completed", stage=stage, duration_ms=round((time.perf_counter() - started) * 1000, 1), mock_mode=mock_mode)
        if isinstance(response, str):
            return response
        if hasattr(response, "content"):
            return str(response.content)
        return str(response)
    except Exception as e:
        log_event(logger, logging.WARNING, "model_fallback", stage=stage, model=settings.NVIDIA_MODEL, error_type=type(e).__name__, duration_ms=round((time.perf_counter() - started) * 1000, 1))
        mock = MockChatModel()
        return mock.generate_deterministic_response(prompt)
