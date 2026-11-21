"""FastAPI application entrypoint for Site-to-Cash."""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import assessments, cases, documents, health, reports, reviews
from app.config import get_settings


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Commercial change intelligence API for construction subcontractors.",
    )

    @application.exception_handler(Exception)
    async def _unhandled_exception_handler(
        _request: Request, _exc: Exception
    ) -> JSONResponse:
        # Never expose raw tracebacks, filesystem paths, or env secrets in HTTP responses.
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error."},
        )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(health.router, prefix="/api")
    application.include_router(documents.router, prefix="/api")
    application.include_router(cases.router, prefix="/api")
    application.include_router(assessments.router, prefix="/api")
    application.include_router(reviews.router, prefix="/api")
    application.include_router(reports.router, prefix="/api")

    return application


app = create_app()
