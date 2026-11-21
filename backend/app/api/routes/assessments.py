"""Project-scoped preliminary commercial assessment routes (Phase 4)."""

from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.schemas import CommercialAssessmentRecord, ReviewStatus
from app.services.gemini_client import (
    GeminiClient,
    GeminiMalformedResponseError,
    GeminiNotConfiguredError,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUpstreamError,
    get_gemini_client,
)
from app.services.grounding import validate_assessment_grounding
from app.services.retrieval import retrieve_project_evidence
from app.storage import get_case_repository

router = APIRouter(tags=["assessments"])


@router.get("/assessments", response_model=list[CommercialAssessmentRecord])
def list_assessments(
    project_id: Optional[str] = Query(default=None),
) -> list[CommercialAssessmentRecord]:
    """List persisted preliminary commercial assessments optionally filtered by project."""
    repo = get_case_repository()
    return repo.list_assessments(project_id=project_id)


@router.get("/cases/{case_id}/assessment", response_model=CommercialAssessmentRecord)
def get_case_assessment(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
) -> CommercialAssessmentRecord:
    """Retrieve the latest preliminary commercial assessment for a case."""
    repo = get_case_repository()
    case = repo.get_case(case_id)
    if case is None or (project_id is not None and case.project_id != project_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' was not found.",
        )

    record = repo.get_latest_assessment_for_case(case_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No commercial assessment exists yet for case '{case_id}'.",
        )
    return record


@router.post(
    "/cases/{case_id}/assessment",
    response_model=CommercialAssessmentRecord,
    status_code=status.HTTP_201_CREATED,
)
def create_case_assessment(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
    gemini_client: GeminiClient = Depends(get_gemini_client),
) -> CommercialAssessmentRecord:
    """Retrieve project contract/BOQ evidence and run Gemini preliminary assessment."""
    repo = get_case_repository()
    case = repo.get_case(case_id)
    if case is None or (project_id is not None and case.project_id != project_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' was not found.",
        )

    if (
        case.confirmed_extraction is None
        or case.confirmed_extraction.confirmation_status != "confirmed"
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Case extraction must be confirmed by a human reviewer before running commercial assessment.",
        )

    clauses, boq_items = retrieve_project_evidence(
        repo,
        case.project_id,
        case.confirmed_extraction.fields,
    )

    try:
        assessment = gemini_client.assess_commercial_change(
            case=case,
            retrieved_clauses=clauses,
            retrieved_boq_items=boq_items,
        )
    except GeminiNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except GeminiRateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except GeminiTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(exc),
        ) from exc
    except (GeminiMalformedResponseError, GeminiUpstreamError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    now = datetime.now(timezone.utc)
    record = CommercialAssessmentRecord(
        id=f"assess-{uuid.uuid4().hex[:12]}",
        project_id=case.project_id,
        case_id=case.id,
        is_demo=case.is_demo,
        retrieved_contract_clauses=clauses,
        retrieved_boq_items=boq_items,
        retrieved_source_references=(
            [c.source_reference for c in clauses]
            + [b.source_reference for b in boq_items]
        ),
        ai_assessment=assessment,
        assessed_at=now,
        model_name=gemini_client.model_name,
        human_review_status=ReviewStatus.pending_review,
    )
    grounding = validate_assessment_grounding(repo, case.project_id, record)
    if not grounding.is_valid:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Assessment source-grounding validation failed: "
                + "; ".join(grounding.errors)
            ),
        )
    record = record.model_copy(update={"grounding_validation": grounding})
    repo.save_assessment(record)

    updated_case = case.model_copy(
        update={
            "latest_assessment_id": record.id,
            "updated_at": now,
        }
    )
    repo.save_case(updated_case)
    return record
