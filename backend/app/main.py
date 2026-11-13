from contextlib import asynccontextmanager
import logging
import time
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.config import settings
from backend.app.observability import configure_logging, log_event, new_id, request_id_var
from backend.app.database import engine, Base
from backend.app.api.health import router as health_router
from backend.app.api.sessions import router as sessions_router
from backend.app.ws.interview_ws import router as ws_router
import backend.app.models.db_models  # Ensure all models are registered on Base

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.LOG_LEVEL, settings.LOG_FILE)
    log_event(
        logger, logging.INFO, "app_startup",
        model=settings.NVIDIA_MODEL,
        region=settings.DEEPGRAM_REGION,
        nvidia_configured=bool(settings.NVIDIA_API_KEY),
        deepgram_configured=bool(settings.DEEPGRAM_API_KEY),
        database_backend=settings.DATABASE_URL.split(":", 1)[0],
    )
    # Initialize database tables on startup
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        log_event(logger, logging.ERROR, "app_startup_failed", stage="database", error_type=type(exc).__name__)
        raise
    try:
        yield
    finally:
        log_event(logger, logging.INFO, "app_shutdown")


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
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_diagnostics(request: Request, call_next):
    request_id = new_id()
    context_token = request_id_var.set(request_id)
    started = time.perf_counter()
    try:
        try:
            response = await call_next(request)
        except Exception as exc:
            log_event(logger, logging.ERROR, "http_error", error_type=type(exc).__name__)
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal server error", "code": "INTERNAL_ERROR", "errors": []},
            )
        response.headers["X-Request-ID"] = request_id
        route = request.scope.get("route")
        route_template = getattr(route, "path", "unmatched")
        root_path = request.scope.get("root_path", "")
        if root_path and route_template != "unmatched":
            route_template = root_path.rstrip("/") + route_template
        elif request.scope.get("path", "").startswith("/api/") and route_template != "unmatched" and not route_template.startswith("/api/"):
            route_template = "/api" + route_template
        log_event(
            logger, logging.INFO, "http_request",
            route=route_template, method=request.method, status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
        )
        return response
    finally:
        request_id_var.reset(context_token)


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
