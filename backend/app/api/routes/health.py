"""Health check endpoint reporting storage and Gemini readiness."""

from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import HealthResponse
from app.storage import get_case_repository, get_file_store

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Return service status, storage readiness, and Gemini configuration flag."""
    settings = get_settings()
    file_store = get_file_store(settings)
    repo = get_case_repository(settings)
    return HealthResponse(
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
        storage_backend=settings.storage_backend,
        storage_ready=file_store.is_ready() and repo.is_ready(),
        gemini_configured=settings.gemini_configured,
    )
