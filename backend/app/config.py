import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./interview_agent.db"
    DEEPGRAM_API_KEY: Optional[str] = ""
    DEEPGRAM_REGION: str = "global"
    DEEPGRAM_TTS_MODEL: str = "flux-meena-en"
    NVIDIA_API_KEY: Optional[str] = ""
    NVIDIA_MODEL: str = "nvidia/nemotron-3.5-bolt-e4b"
    SECRET_KEY: str = "dev-secret-key"
    FRONTEND_URL: str = "http://localhost:5173"
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = "logs/interview-agent.jsonl"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
