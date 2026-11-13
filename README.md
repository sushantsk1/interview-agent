# AI Interview Agent 🎙️🤖

An intelligent, autonomous AI technical screening platform that conducts multi-modal candidate interviews in real-time. Features live webcam previews, voice interaction (Deepgram Nova-3 STT & Aura-2 TTS), adaptive conversational questioning powered by LangChain & LangGraph, and a comprehensive recruiter dashboard with multi-dimensional candidate evaluation scorecards.

---

## 🌟 Key Features

### 1. Multi-Modal Candidate Interview Room
* **Split-Screen Interface**: Left pane shows the candidate's live webcam feed (with Fit / Fill camera framing toggle); right pane shows the real-time transcript stream.
* **Animated AI Interviewer Avatar**: Real-time state indicator reflecting whether the AI interviewer is *idle*, *listening*, *thinking*, or *speaking*.
* **Real-Time Voice Pipeline**:
  * **Text-to-Speech (TTS)**: Spoken questions using Deepgram Aura-2.
  * **Speech-to-Text (STT)**: Low-latency candidate audio transcription using Deepgram Nova-3 with client-side Web Speech recognition fallback for instant visual feedback.
* **Hybrid Turn-Taking Detection**: Automatically detects when the candidate finishes speaking using silence duration detection (2.75s threshold) alongside an explicit manual **Done Answering** button.
* **Text Fallback**: Candidates can seamlessly type their responses if their microphone or audio device experiences issues.
* **Question and Audio Together**: The room holds the next question while speech is being prepared, then displays it when matching audio arrives and starts playback. If synthesis fails, use **Play Question** to retry or **Read question instead** to continue with text.

### 2. Adaptive Conversational Brain (LangGraph + LangChain)
* **Grounding in Job Descriptions & Resumes**: Extracts 3–5 core competency topics tailored directly to the JD requirements and the candidate's parsed PDF/DOCX resume.
* **Practical Questions**: Starts with one simple concept matched to the JD and explicit resume experience. Missing or ambiguous experience starts at Junior; recruiter difficulty is a ceiling. Long or multipart model questions use a short practical fallback.
* **Adaptive Follow-Up Questions**: Clarifies one practical detail at the candidate's level, with a strict cap of two follow-ups per topic. Questions do not automatically escalate to architecture or edge cases.
* **Anti-Drift & Injection Guardrails**: Fast-path detection against prompt injection ("ignore previous instructions") or off-topic rambling, politely steering candidates back to the core question.
* **Smooth Non-Answer Handling**: If a candidate states "I don't know" or "No experience", the interviewer smoothly transitions forward without stalling or penalizing unnecessarily.

### 3. Recruiter Dashboard & Scorecards
* **Session Management**: Create customized interview sessions with job title, JD text, resume file upload (PDF/DOCX), difficulty level, duration cap, and question quotas.
* **Shareable Links**: Copy unique tokenized interview invitations for candidates.
* **Detailed Analytics & Scorecards**:
  * 4-Dimension scoring per answer: **Relevance**, **Depth**, **Correctness**, and **Communication** (0–10 scale).
  * Aggregated overall rating, hiring recommendation (*Strong Hire*, *Hire*, *Borderline*, *Do Not Hire*).
  * Concrete candidate strengths, identified growth areas, and full timestamped turn-by-turn transcripts.

---

## 🛠️ Architecture & Tech Stack

```mermaid
graph TD
    Client[Candidate / Recruiter Browser] -->|HTTP / REST| API[FastAPI Server]
    Client -->|Full-Duplex Audio & Events| WS[FastAPI WebSocket]
    WS -->|Live Streaming STT| DG_STT[Deepgram Nova-3]
    WS -->|Audio Synthesis TTS| DG_TTS[Deepgram Aura-2]
    WS -->|State Machine| LG[LangGraph Interview Engine]
    LG -->|Chat Completions| NIM[NVIDIA NIM LLM Endpoints]
    API -->|Persistence| DB[(SQLAlchemy / SQLite or PostgreSQL)]
```

* **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons.
* **Backend**: FastAPI, LangChain, LangGraph, Pydantic, SQLAlchemy.
* **Voice Services**: Deepgram SDK (Nova-3 STT & Aura-2 TTS).
* **LLM Endpoints**: NVIDIA NIM API (`nvidia/nemotron-3.5-bolt-e4b` by default; configurable with `NVIDIA_MODEL`). Question requests disable model thinking for lower latency.
* **Database**: Zero-config SQLite default for development; PostgreSQL-ready for production.

---

## 🚀 Quick Start

### 1. Clone & Setup Repository
```bash
git clone https://github.com/sushantsk1/interview-agent.git
cd interview-agent
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your API credentials:
```bash
cp .env.example .env
```
Contents of `.env`:
```env
DEEPGRAM_API_KEY=your_deepgram_api_key
DEEPGRAM_REGION=global
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_MODEL=nvidia/nemotron-3.5-bolt-e4b
DATABASE_URL=sqlite:///./interview_agent.db
FRONTEND_URL=http://localhost:5173
```

Set `DEEPGRAM_REGION` to `in`, `eu`, or `au` when the matching regional endpoint is closer to the server. Keep `global` otherwise. A valid Deepgram key is required for an audible interviewer; if synthesis or browser autoplay fails, the interview room keeps the question visible and offers **Play Question**.

For offline automated tests, set `MOCK_DEEPGRAM=true` to use synthetic silent audio. That mock is for protocol testing and does not produce an audible interviewer.

### Application logs

After restarting the backend, server events appear in its terminal and `logs/interview-agent.jsonl`. Files rotate at 5 MB with three backups. Configure the root `.env` with `LOG_LEVEL=DEBUG` for more detail; levels include `DEBUG`, `INFO`, `WARNING`, `ERROR`, and `CRITICAL`. Set `LOG_FILE=` for console-only logging or choose another file path.

Watch recent server events from the repository root:

```powershell
Get-Content .\logs\interview-agent.jsonl -Tail 50 -Wait
```

Look for `model_started`, `model_completed` or `model_fallback`, followed by `tts_started`, `tts_completed` or `tts_failed`, and `ws_audio_sent`. `duration_ms` reports time spent in each stage. Startup logs show whether NVIDIA and Deepgram are configured and which model/region is selected.

In the browser developer console, filter for `interview_agent_frontend`. Events show the question waiting, its reveal when audio arrives, playback attempts, successful starts, autoplay blocks, failures, and retries. Set `VITE_LOG_LEVEL=debug` in `frontend/.env.local` and restart Vite for more detail; supported levels are `debug`, `info`, `warn`, `error`, and `off`.

Search the same `connection_id` in browser and server logs to follow an interview connection. HTTP logs use `request_id`, also returned in the `X-Request-ID` response header. Application diagnostics record metadata and timings, not invitation tokens, credentials, question/answer text, resume content, or audio payloads. High-frequency microphone transport details stay at debug level.

### 3. Backend Setup
```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .\.venv\Scripts\Activate.ps1

# Install backend dependencies
pip install -r backend/requirements.txt

# Start backend server
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## 🧪 Testing

### Backend Test Suite (Pytest)
```bash
pytest backend/tests/ -v
```
*Covers REST APIs, WebSocket protocols, LangGraph transitions, resume parsing, and mock offline voice services.*

### Frontend Test Suite (Vitest)
```bash
cd frontend
npm test -- --run
npm run build
```
*Covers webcam previews, audio playback and recovery, recording, silence timers, chat transcripts, and recruiter dashboard views.*

---

## 📄 License
MIT License. Built with ❤️ for automated, objective, and empathetic technical hiring.

