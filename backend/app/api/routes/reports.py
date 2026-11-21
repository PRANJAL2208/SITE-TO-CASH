"""Evidence pack PDF generation, variation lifecycle tracking, and dashboard routes (Phase 6)."""

from datetime import datetime, timezone
import hashlib
import re
from typing import Optional
import uuid

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.models.schemas import (
    CommercialAssessmentRecord,
    CommercialTracking,
    CommercialTrackingUpdateRequest,
    DashboardMetricsResponse,
    DocumentMetadata,
    EvidencePackRecord,
    GenerateReportRequest,
    LifecycleHistoryEntry,
    LifecycleTransitionRequest,
    LifecycleTransitionResponse,
    VariationCase,
)
from app.services.lifecycle import (
    LifecycleValidationError,
    apply_lifecycle_transition,
    apply_tracking_update,
    compute_dashboard_metrics,
    effective_variation_reference,
)
from app.services.report_generator import generate_evidence_pack_pdf
from app.storage import get_case_repository, get_file_store
from app.storage.base import CaseRepository

router = APIRouter(tags=["reports-and-register"])


def _safe_slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._")
    return cleaned or fallback


def _get_scoped_case(
    repo: CaseRepository, case_id: str, project_id: Optional[str]
) -> VariationCase:
    clean_project = project_id.strip() if project_id and project_id.strip() else None
    case = repo.get_case(case_id)
    if case is None or (clean_project is not None and case.project_id != clean_project):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' was not found.",
        )
    return case


def _validate_supporting_documents(
    repo: CaseRepository, doc_ids: Optional[list[str]], project_id: str
) -> None:
    if not doc_ids:
        return
    for raw_id in doc_ids:
        doc_id = raw_id.strip()
        if not doc_id:
            continue
        doc = repo.get_document(doc_id)
        if doc is None or doc.project_id != project_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Supporting document '{doc_id}' does not exist in project '{project_id}'.",
            )


@router.post(
    "/cases/{case_id}/report",
    response_model=EvidencePackRecord,
    status_code=status.HTTP_201_CREATED,
)
def generate_case_evidence_pack(
    case_id: str,
    payload: GenerateReportRequest,
    project_id: Optional[str] = Query(default=None),
) -> EvidencePackRecord:
    """Generate and persist a structured PDF variation evidence pack."""
    prepared_by = payload.prepared_by.strip()
    if not prepared_by:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prepared_by is required to generate an evidence pack.",
        )

    repo = get_case_repository()
    file_store = get_file_store()
    case = _get_scoped_case(repo, case_id, project_id)

    assessment: Optional[CommercialAssessmentRecord] = None
    if case.latest_assessment_id:
        candidate = repo.get_assessment(case.latest_assessment_id)
        if candidate and candidate.project_id == case.project_id:
            assessment = candidate
    if assessment is None:
        latest = repo.get_latest_assessment_for_case(case.id)
        if latest and latest.project_id == case.project_id:
            assessment = latest

    orig_attachment_id = (
        case.original_input.attachment_id if case.original_input else None
    )
    supporting_docs: list[DocumentMetadata] = []
    seen_doc_ids: set[str] = set()
    for doc_id in [*case.commercial_tracking.supporting_document_ids, *case.attachment_ids]:
        if doc_id == orig_attachment_id or doc_id in seen_doc_ids:
            continue
        doc = repo.get_document(doc_id)
        if doc is not None and doc.project_id == case.project_id:
            supporting_docs.append(doc)
            seen_doc_ids.add(doc_id)

    review_history = repo.list_review_history(
        case_id=case.id, project_id=case.project_id
    )
    lifecycle_history = repo.list_lifecycle_history(
        case_id=case.id, project_id=case.project_id
    )

    now = datetime.now(timezone.utc)
    report_id = f"rep-{uuid.uuid4().hex[:12]}"
    var_ref = (
        payload.variation_reference.strip()
        if payload.variation_reference and payload.variation_reference.strip()
        else effective_variation_reference(case)
    )
    eff_project_name = (
        payload.project_name.strip()
        if payload.project_name and payload.project_name.strip()
        else case.commercial_tracking.project_name
    )
    eff_subcontractor = (
        payload.subcontractor_name.strip()
        if payload.subcontractor_name and payload.subcontractor_name.strip()
        else case.commercial_tracking.subcontractor_name
    )

    pdf_bytes, page_count, status_label, is_draft = generate_evidence_pack_pdf(
        case=case,
        assessment=assessment,
        supporting_documents=supporting_docs,
        review_history=review_history,
        lifecycle_history=lifecycle_history,
        report_id=report_id,
        prepared_by=prepared_by,
        generated_at=now,
        project_name=eff_project_name,
        subcontractor_name=eff_subcontractor,
        variation_reference=var_ref,
    )

    safe_proj = _safe_slug(case.project_id, "default")
    safe_ref = _safe_slug(var_ref, case.id)
    filename = f"{safe_ref}_{report_id}.pdf"
    relative_path = f"projects/{safe_proj}/reports/{case.id}/{report_id}.pdf"
    storage_uri = file_store.save_bytes(relative_path, pdf_bytes)
    content_sha256 = hashlib.sha256(pdf_bytes).hexdigest()

    record = EvidencePackRecord(
        id=report_id,
        project_id=case.project_id,
        case_id=case.id,
        variation_reference=var_ref,
        title=case.title,
        filename=filename,
        storage_uri=storage_uri,
        storage_relative_path=relative_path,
        content_sha256=content_sha256,
        size_bytes=len(pdf_bytes),
        page_count=page_count,
        is_draft=is_draft,
        status_label=status_label,
        lifecycle_status_at_generation=case.lifecycle_status,
        qs_review_status_at_generation=case.qs_decision.review_status,
        assessment_id=assessment.id if assessment else None,
        prepared_by=prepared_by,
        project_name=eff_project_name,
        subcontractor_name=eff_subcontractor,
        is_demo=case.is_demo,
        generated_at=now,
    )
    repo.save_report(record)

    # Record latest report ID and optional metadata ONLY; never auto-advance lifecycle status.
    updated_tracking = CommercialTracking(
        **{
            **case.commercial_tracking.model_dump(),
            "project_name": eff_project_name,
            "subcontractor_name": eff_subcontractor,
        }
    )
    updated_case = case.model_copy(
        update={
            "variation_reference": var_ref,
            "commercial_tracking": updated_tracking,
            "latest_report_id": report_id,
            "updated_at": now,
        }
    )
    repo.save_case(updated_case)
    return record


@router.get(
    "/cases/{case_id}/reports",
    response_model=list[EvidencePackRecord],
)
def list_case_reports(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
) -> list[EvidencePackRecord]:
    """List generated PDF evidence packs for a variation case."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    return repo.list_reports(case_id=case.id, project_id=case.project_id)


@router.get(
    "/cases/{case_id}/reports/{report_id}",
    response_model=EvidencePackRecord,
)
def get_case_report_metadata(
    case_id: str,
    report_id: str,
    project_id: Optional[str] = Query(default=None),
) -> EvidencePackRecord:
    """Retrieve metadata for a specific generated PDF evidence pack."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    record = repo.get_report(report_id)
    if (
        record is None
        or record.case_id != case.id
        or record.project_id != case.project_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evidence pack '{report_id}' was not found for case '{case_id}'.",
        )
    return record


@router.get("/cases/{case_id}/reports/{report_id}/download")
def download_case_report(
    case_id: str,
    report_id: str,
    project_id: str = Query(..., description="Owning project ID required to authorize download."),
) -> Response:
    """Download a generated PDF evidence pack with strict project and case ownership checks."""
    clean_project = project_id.strip()
    if not clean_project:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id is required to download an evidence pack.",
        )

    repo = get_case_repository()
    case = repo.get_case(case_id)
    record = repo.get_report(report_id)
    if case is None or record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Evidence pack '{report_id}' was not found.",
        )

    if (
        case.project_id != clean_project
        or record.project_id != clean_project
        or record.case_id != case_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to download this evidence pack under the requested project or case.",
        )

    file_store = get_file_store()
    if not file_store.exists(record.storage_relative_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stored PDF file for report '{report_id}' is missing.",
        )

    pdf_bytes = file_store.read_bytes(record.storage_relative_path)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{record.filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch(
    "/cases/{case_id}/lifecycle",
    response_model=LifecycleTransitionResponse,
)
def transition_case_lifecycle(
    case_id: str,
    payload: LifecycleTransitionRequest,
    project_id: Optional[str] = Query(default=None),
) -> LifecycleTransitionResponse:
    """Validate and apply an explicit human variation lifecycle status transition."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    _validate_supporting_documents(
        repo, payload.supporting_document_ids, case.project_id
    )

    try:
        updated_case, history_entry = apply_lifecycle_transition(case, payload)
    except LifecycleValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    saved_case = repo.save_case(updated_case)
    repo.append_lifecycle_history(history_entry)
    return LifecycleTransitionResponse(case=saved_case, history_entry=history_entry)


@router.patch("/cases/{case_id}/tracking", response_model=VariationCase)
def update_case_commercial_tracking(
    case_id: str,
    payload: CommercialTrackingUpdateRequest,
    project_id: Optional[str] = Query(default=None),
) -> VariationCase:
    """Update commercial tracking details without advancing lifecycle status."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    _validate_supporting_documents(
        repo, payload.supporting_document_ids, case.project_id
    )

    try:
        updated_case = apply_tracking_update(case, payload)
    except LifecycleValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return repo.save_case(updated_case)


@router.get(
    "/cases/{case_id}/lifecycle-history",
    response_model=list[LifecycleHistoryEntry],
)
def get_case_lifecycle_history(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
) -> list[LifecycleHistoryEntry]:
    """Return chronological append-only lifecycle status history for a variation case."""
    repo = get_case_repository()
    case = _get_scoped_case(repo, case_id, project_id)
    return repo.list_lifecycle_history(case_id=case.id, project_id=case.project_id)


@router.get("/dashboard/metrics", response_model=DashboardMetricsResponse)
def get_dashboard_metrics(
    project_id: Optional[str] = Query(default=None),
) -> DashboardMetricsResponse:
    """Compute commercial dashboard summary metrics strictly from persisted case records."""
    clean_project = project_id.strip() if project_id and project_id.strip() else None
    repo = get_case_repository()
    cases = repo.list_cases(project_id=clean_project)
    assessments_by_case: dict[str, CommercialAssessmentRecord] = {}
    for item in cases:
        assessment = None
        if item.latest_assessment_id:
            candidate = repo.get_assessment(item.latest_assessment_id)
            if candidate and candidate.project_id == item.project_id:
                assessment = candidate
        if assessment is None:
            latest = repo.get_latest_assessment_for_case(item.id)
            if latest and latest.project_id == item.project_id:
                assessment = latest
        if assessment is not None:
            assessments_by_case[item.id] = assessment

    return compute_dashboard_metrics(
        cases=cases,
        assessments_by_case=assessments_by_case,
        project_id=clean_project,
    )
