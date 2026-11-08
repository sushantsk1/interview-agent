from fastapi import APIRouter
from backend.app.config import settings
from backend.app.models.schemas import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def get_health():
    return HealthResponse(
        status="ok",
        service="interview-agent-api",
        version="1.0.0",
        deepgram_configured=bool(settings.DEEPGRAM_API_KEY and settings.DEEPGRAM_API_KEY.strip()),
        nvidia_configured=bool(settings.NVIDIA_API_KEY and settings.NVIDIA_API_KEY.strip()),
    )
