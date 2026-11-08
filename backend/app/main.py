from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.config import settings
from backend.app.database import engine, Base
from backend.app.api.health import router as health_router
from backend.app.api.sessions import router as sessions_router
from backend.app.ws.interview_ws import router as ws_router
import backend.app.models.db_models  # Ensure all models are registered on Base



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables on startup
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="AI Interview Agent API",
    version="1.0.0",
    description="Real-time multi-modal conversational AI interview agent platform",
    lifespan=lifespan,
)

# CORS middleware configuration
origins = [
    settings.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        detail_msg = exc.detail.get("detail", str(exc.detail))
        code_str = exc.detail.get("code", "HTTP_ERROR")
        errors = exc.detail.get("errors", [])
    else:
        detail_msg = str(exc.detail)
        code_str = "HTTP_ERROR"
        errors = []

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": detail_msg,
            "code": code_str,
            "errors": errors,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Request validation failed",
            "code": "VALIDATION_ERROR",
            "errors": exc.errors(),
        },
    )


# Mount routers
app.include_router(health_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(ws_router, prefix="/ws")



@app.get("/")
def root():
    return {
        "service": "AI Interview Agent API",
        "docs_url": "/docs",
        "status": "online",
        "version": "1.0.0",
    }
