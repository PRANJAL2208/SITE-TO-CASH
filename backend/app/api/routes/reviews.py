"""QS human review workbench, deterministic cost calculation, and audit history routes (Phase 5)."""

from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas import (
    AssessmentOutcome,
    CommercialAssessmentRecord,
    CostEstimateResponse,
    CostEstimateUpdateRequest,
    DeterministicEstimate,
    PreliminaryAssessmentCategory,
    QsDecision,
    QsDecisionAction,
    QsReviewRequest,
    QsReviewResponse,
    ReviewHistoryEntry,
    ReviewStatus,
    VariationCase,
)
from app.services.calculator import CostValidationError, calculate_deterministic_estimate
from app.services.grounding import validate_source_reference
from app.storage import get_case_repository
from app.storage.base import CaseRepository

router = APIRouter(tags=["reviews"])

_CATEGORY_TO_OUTCOME = {
    PreliminaryAssessmentCategory.existing_scope: AssessmentOutcome.existing_scope,
    PreliminaryAssessmentCategory.potential_variation: AssessmentOutcome.potential_variation,
    PreliminaryAssessmentCategory.approval_or_notice_missing: AssessmentOutcome.missing_approval,
    PreliminaryAssessmentCategory.insufficient_evidence: AssessmentOutcome.insufficient_evidence,
    PreliminaryAssessmentCategory.ambiguous: AssessmentOutcome.insufficient_evidence,
}


def _get_scoped_case(
    repo: CaseRepository, case_id: str, project_id: Optional[str]
) -> VariationCase:
    case = repo.get_case(case_id)
    if case is None or (project_id is not None and case.project_id != project_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' was not found.",
        )
    return case


def _validate_cost_boq_references(
    repo: CaseRepository, project_id: str, line_items: list
) -> None:
    for item in line_items:
        if item.boq_reference is not None:
            ref_errors = validate_source_reference(
                repo, project_id, item.boq_reference
            )
            if ref_errors:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="; ".join(ref_errors),
                )


@router.get("/cases/{case_id}/cost-estimate", response_model=DeterministicEstimate)
def get_case_cost_estimate(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
) -> DeterministicEstimate:
    """Retrieve the current deterministic cost build-up for a variation case."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    return case.deterministic_estimate or DeterministicEstimate()


@router.post(
    "/cases/{case_id}/cost-estimate/calculate",
    response_model=DeterministicEstimate,
)
def preview_cost_estimate(
    case_id: str,
    payload: CostEstimateUpdateRequest,
    project_id: Optional[str] = Query(default=None),
) -> DeterministicEstimate:
    """Calculate deterministic cost totals server-side without persisting."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    _validate_cost_boq_references(repo, case.project_id, payload.line_items)
    try:
        return calculate_deterministic_estimate(
            payload.line_items,
            currency=payload.currency,
            decimal_places=payload.decimal_places,
            rounding_mode=payload.rounding_mode,
            tax_rate_percent=payload.tax_rate_percent,
        )
    except CostValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.put("/cases/{case_id}/cost-estimate", response_model=CostEstimateResponse)
def save_case_cost_estimate(
    case_id: str,
    payload: CostEstimateUpdateRequest,
    project_id: Optional[str] = Query(default=None),
) -> CostEstimateResponse:
    """Validate, recalculate server-side, persist cost build-up, and log history."""
    reviewer_name = payload.reviewer_name.strip() if payload.reviewer_name else ""
    if not reviewer_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reviewer_name is required to save a cost estimate.",
        )

    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    _validate_cost_boq_references(repo, case.project_id, payload.line_items)

    try:
        estimate = calculate_deterministic_estimate(
            payload.line_items,
            currency=payload.currency,
            decimal_places=payload.decimal_places,
            rounding_mode=payload.rounding_mode,
            tax_rate_percent=payload.tax_rate_percent,
        )
    except CostValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    now = datetime.now(timezone.utc)
    previous_snapshot = (
        case.deterministic_estimate.model_dump(mode="json")
        if case.deterministic_estimate is not None
        else {}
    )
    updated_snapshot = estimate.model_dump(mode="json")

    updated_case = case.model_copy(
        update={
            "deterministic_estimate": estimate,
            "updated_at": now,
        }
    )
    repo.save_case(updated_case)

    entry = ReviewHistoryEntry(
        id=f"hist-{uuid.uuid4().hex[:12]}",
        project_id=case.project_id,
        case_id=case.id,
        entry_type="cost_update",
        reviewer_name=reviewer_name,
        timestamp=now,
        assessment_id=case.latest_assessment_id,
        decision_action=None,
        review_status=case.qs_decision.review_status,
        reason=(
            payload.reason.strip()
            if payload.reason and payload.reason.strip()
            else None
        ),
        previous_snapshot=previous_snapshot,
        updated_snapshot=updated_snapshot,
        cost_estimate_snapshot=estimate,
    )
    repo.append_review_history(entry)

    return CostEstimateResponse(
        case_id=case.id,
        project_id=case.project_id,
        deterministic_estimate=estimate,
        history_entry=entry,
    )


@router.patch("/cases/{case_id}/review", response_model=QsReviewResponse)
def review_case(
    case_id: str,
    payload: QsReviewRequest,
    project_id: Optional[str] = Query(default=None),
) -> QsReviewResponse:
    """Save a QS draft or confirmed human decision while keeping AI evidence immutable."""
    reviewer_name = payload.reviewer_name.strip()
    if not reviewer_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reviewer_name is required to record a QS decision.",
        )

    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)

    target_assessment_id = payload.assessment_id or case.latest_assessment_id
    assessment: Optional[CommercialAssessmentRecord] = None
    if target_assessment_id:
        assessment = repo.get_assessment(target_assessment_id)
        if payload.assessment_id and (
            assessment is None or assessment.case_id != case.id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Assessment '{payload.assessment_id}' does not belong to case '{case.id}'.",
            )

    confirmed_category = payload.confirmed_category
    if payload.decision_action == QsDecisionAction.mark_existing_scope:
        confirmed_category = PreliminaryAssessmentCategory.existing_scope
    elif (
        payload.decision_action == QsDecisionAction.accept_assessment
        and confirmed_category is None
        and assessment is not None
    ):
        confirmed_category = assessment.ai_assessment.assessment_category

    clean_reason = (
        payload.reason.strip()
        if payload.reason and payload.reason.strip()
        else None
    )
    is_overriding_ai = (
        assessment is not None
        and confirmed_category is not None
        and confirmed_category != assessment.ai_assessment.assessment_category
    )
    if not payload.is_draft and (
        payload.decision_action
        in (
            QsDecisionAction.reject_assessment,
            QsDecisionAction.mark_existing_scope,
            QsDecisionAction.request_additional_info,
        )
        or is_overriding_ai
    ):
        if not clean_reason:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A written reason is required when rejecting, overriding, marking existing scope, or requesting additional information.",
            )

    if payload.is_draft:
        review_status = ReviewStatus.pending_review
    elif payload.decision_action in (
        QsDecisionAction.accept_assessment,
        QsDecisionAction.mark_existing_scope,
    ):
        review_status = ReviewStatus.confirmed
    elif payload.decision_action == QsDecisionAction.reject_assessment:
        review_status = ReviewStatus.rejected
    else:
        review_status = ReviewStatus.needs_more_info

    now = datetime.now(timezone.utc)
    previous_decision_snapshot = case.qs_decision.model_dump(mode="json")

    new_decision = QsDecision(
        origin="human_qs_decision",
        review_status=review_status,
        decision_action=payload.decision_action,
        confirmed_assessment=(
            _CATEGORY_TO_OUTCOME[confirmed_category]
            if confirmed_category is not None
            else None
        ),
        confirmed_category=confirmed_category,
        assessment_id=target_assessment_id,
        reviewer_name=reviewer_name,
        reviewed_at=now,
        reason=clean_reason,
        notes=(
            payload.notes.strip()
            if payload.notes and payload.notes.strip()
            else None
        ),
        is_draft=payload.is_draft,
    )

    updated_case = case.model_copy(
        update={
            "qs_decision": new_decision,
            "updated_at": now,
        }
    )
    repo.save_case(updated_case)

    updated_assessment: Optional[CommercialAssessmentRecord] = assessment
    if assessment is not None and not payload.is_draft:
        updated_assessment = assessment.model_copy(
            update={"human_review_status": review_status}
        )
        repo.save_assessment(updated_assessment)

    entry = ReviewHistoryEntry(
        id=f"hist-{uuid.uuid4().hex[:12]}",
        project_id=case.project_id,
        case_id=case.id,
        entry_type="qs_decision_draft" if payload.is_draft else "qs_decision_confirmed",
        reviewer_name=reviewer_name,
        timestamp=now,
        assessment_id=target_assessment_id,
        decision_action=payload.decision_action,
        review_status=review_status,
        reason=clean_reason,
        previous_snapshot=previous_decision_snapshot,
        updated_snapshot=new_decision.model_dump(mode="json"),
        cost_estimate_snapshot=case.deterministic_estimate,
    )
    repo.append_review_history(entry)

    return QsReviewResponse(
        case=updated_case,
        assessment=updated_assessment,
        history_entry=entry,
    )


@router.get("/cases/{case_id}/review-history", response_model=list[ReviewHistoryEntry])
def get_case_review_history(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
) -> list[ReviewHistoryEntry]:
    """Return the immutable append-only review & cost calculation audit trail."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    return repo.list_review_history(case_id=case.id, project_id=case.project_id)
