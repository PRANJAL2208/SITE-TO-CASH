"""Variation register and site instruction case routes."""

from datetime import date, datetime, timezone
from pathlib import Path
import re
from typing import Optional
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status as http_status,
)

from app.config import get_settings
from app.models.schemas import (
    ConfirmExtractionRequest,
    ConfirmedChangeEvent,
    DocumentMetadata,
    DocumentProcessingStatus,
    DocumentType,
    InstructionSourceType,
    LifecycleHistoryEntry,
    OriginalInstructionInput,
    VariationCase,
    VariationLifecycleStatus,
)
from app.services.gemini_client import (
    GeminiClient,
    GeminiMalformedResponseError,
    GeminiNotConfiguredError,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUpstreamError,
    get_gemini_client,
)
from app.services.security import (
    SecurityValidationError,
    read_upload_bounded,
    sanitize_filename,
    validate_file_signature,
    validate_project_id,
)
from app.storage import get_case_repository, get_file_store

router = APIRouter(tags=["cases"])

_AUDIO_MIME_BY_EXT = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
}
_IMAGE_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _safe_slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._")
    return cleaned or fallback


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_VAR_REF_NUM_RE = re.compile(r"^VAR-(\d+)$", re.IGNORECASE)


def _derive_case_title(
    case_id: str, raw_text: str, description: Optional[str], requested_work: Optional[str]
) -> str:
    candidate = (description or requested_work or raw_text.strip() or "").strip()
    if not candidate:
        return f"Site Instruction ({case_id})"
    first_line = candidate.splitlines()[0].strip()
    return first_line[:96] + ("..." if len(first_line) > 96 else "")


def _next_variation_reference(existing_cases: list[VariationCase]) -> str:
    max_num = 0
    for item in existing_cases:
        if item.variation_reference:
            match = _VAR_REF_NUM_RE.match(item.variation_reference.strip())
            if match:
                max_num = max(max_num, int(match.group(1)))
    next_num = max(max_num, len(existing_cases)) + 1
    return f"VAR-{next_num:03d}"


def _parse_filter_date(raw_value: Optional[str], param_name: str) -> Optional[date]:
    if raw_value is None:
        return None
    cleaned = raw_value.strip()
    if not cleaned:
        return None
    if not _ISO_DATE_RE.match(cleaned):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"{param_name} must be YYYY-MM-DD (received '{cleaned}').",
        )
    try:
        return date.fromisoformat(cleaned)
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"{param_name} is not a valid date: '{cleaned}'.",
        ) from exc


@router.get("/cases", response_model=list[VariationCase])
def list_cases(
    project_id: Optional[str] = Query(default=None),
    status: Optional[VariationLifecycleStatus] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
) -> list[VariationCase]:
    """List saved variation cases with optional project, lifecycle status, and date filters."""
    parsed_from = _parse_filter_date(date_from, "date_from")
    parsed_to = _parse_filter_date(date_to, "date_to")
    if parsed_from and parsed_to and parsed_from > parsed_to:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="date_from cannot be later than date_to.",
        )

    clean_project = project_id.strip() if project_id and project_id.strip() else None
    repo = get_case_repository()
    cases = repo.list_cases(project_id=clean_project)
    if status is not None:
        cases = [c for c in cases if c.lifecycle_status == status]
    if parsed_from is not None:
        cases = [
            c
            for c in cases
            if c.created_at.astimezone(timezone.utc).date() >= parsed_from
        ]
    if parsed_to is not None:
        cases = [
            c
            for c in cases
            if c.created_at.astimezone(timezone.utc).date() <= parsed_to
        ]
    return cases


@router.get("/cases/{case_id}", response_model=VariationCase)
def get_case_detail(
    case_id: str,
    project_id: Optional[str] = Query(default=None),
) -> VariationCase:
    """Retrieve a single variation case / site-change event by ID."""
    repo = get_case_repository()
    case = repo.get_case(case_id)
    if case is None or (project_id is not None and case.project_id != project_id):
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' was not found.",
        )
    return case


@router.post(
    "/cases/instructions",
    response_model=VariationCase,
    status_code=http_status.HTTP_201_CREATED,
)
async def submit_site_instruction(
    project_id: str = Form("default-project"),
    instruction_text: str = Form(""),
    is_demo: bool = Form(False),
    attachment: Optional[UploadFile] = File(default=None),
    gemini_client: GeminiClient = Depends(get_gemini_client),
) -> VariationCase:
    """Submit an informal site instruction and extract a structured change event via Gemini."""
    settings = get_settings()
    try:
        clean_project_id = validate_project_id(project_id)
    except SecurityValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if len(instruction_text) > settings.max_instruction_text_chars:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=(
                f"instruction_text exceeds maximum length of "
                f"{settings.max_instruction_text_chars} characters."
            ),
        )

    has_text = bool(instruction_text.strip())
    attachment_bytes: Optional[bytes] = None
    attachment_filename: Optional[str] = None
    attachment_mime_type: Optional[str] = None
    attachment_doc_type: Optional[DocumentType] = None

    if attachment is not None and attachment.filename:
        try:
            attachment_filename = sanitize_filename(attachment.filename)
        except SecurityValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        ext = Path(attachment_filename).suffix.lower()
        if ext in _AUDIO_MIME_BY_EXT:
            attachment_doc_type = DocumentType.site_audio
            fallback_mime = _AUDIO_MIME_BY_EXT[ext]
        elif ext in _IMAGE_MIME_BY_EXT:
            attachment_doc_type = DocumentType.site_photo
            fallback_mime = _IMAGE_MIME_BY_EXT[ext]
        else:
            allowed = ", ".join(sorted({*_AUDIO_MIME_BY_EXT, *_IMAGE_MIME_BY_EXT}))
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unsupported attachment extension '{ext or 'none'}'. "
                    f"Supported formats: {allowed}."
                ),
            )

        try:
            attachment_bytes = await read_upload_bounded(
                attachment, settings.max_attachment_upload_bytes, "attachment file"
            )
            validate_file_signature(attachment_bytes, ext)
        except SecurityValidationError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        raw_ct = (attachment.content_type or "").strip().lower()
        attachment_mime_type = (
            raw_ct
            if raw_ct and raw_ct != "application/octet-stream"
            else fallback_mime
        )

    if not has_text and attachment_bytes is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Provide site instruction text (or attach a supported audio/image file).",
        )

    if has_text and attachment_doc_type == DocumentType.site_audio:
        source_type = InstructionSourceType.text_and_audio
    elif has_text and attachment_doc_type == DocumentType.site_photo:
        source_type = InstructionSourceType.text_and_image
    elif attachment_doc_type == DocumentType.site_audio:
        source_type = InstructionSourceType.audio
    elif attachment_doc_type == DocumentType.site_photo:
        source_type = InstructionSourceType.image
    else:
        source_type = InstructionSourceType.text

    case_id = f"case-{uuid.uuid4().hex[:12]}"
    attachment_doc_id = (
        f"doc-{uuid.uuid4().hex[:12]}" if attachment_bytes is not None else None
    )

    try:
        ai_extraction = gemini_client.extract_change_event(
            case_id=case_id,
            project_id=clean_project_id,
            instruction_text=instruction_text if has_text else None,
            source_type=source_type,
            attachment_bytes=attachment_bytes,
            attachment_mime_type=attachment_mime_type,
            attachment_id=attachment_doc_id,
            attachment_filename=attachment_filename,
        )
    except GeminiNotConfiguredError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except GeminiRateLimitError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except GeminiTimeoutError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(exc),
        ) from exc
    except (GeminiMalformedResponseError, GeminiUpstreamError) as exc:
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    now = datetime.now(timezone.utc)
    repo = get_case_repository()
    attachment_storage_uri: Optional[str] = None
    attachment_ids: list[str] = []

    if (
        attachment_bytes is not None
        and attachment_doc_id is not None
        and attachment_doc_type is not None
        and attachment_filename is not None
    ):
        file_store = get_file_store()
        relative_path = (
            f"projects/{_safe_slug(clean_project_id, 'default')}/"
            f"{attachment_doc_type.value}/{attachment_doc_id}/"
            f"{_safe_slug(attachment_filename, 'attachment')}"
        )
        attachment_storage_uri = file_store.save_bytes(relative_path, attachment_bytes)
        repo.save_document(
            DocumentMetadata(
                id=attachment_doc_id,
                filename=attachment_filename,
                document_type=attachment_doc_type,
                storage_uri=attachment_storage_uri,
                uploaded_at=now,
                is_demo=is_demo,
                project_id=clean_project_id,
                processing_status=DocumentProcessingStatus.extracted,
                status_message=f"Preserved site instruction attachment for {case_id}.",
            )
        )
        attachment_ids.append(attachment_doc_id)

    title = _derive_case_title(
        case_id,
        instruction_text,
        ai_extraction.fields.instruction_description.value,
        ai_extraction.fields.requested_work.value,
    )
    variation_reference = _next_variation_reference(
        repo.list_cases(project_id=clean_project_id)
    )

    case = VariationCase(
        id=case_id,
        title=title,
        project_id=clean_project_id,
        variation_reference=variation_reference,
        lifecycle_status=VariationLifecycleStatus.detected,
        instruction_text=instruction_text if has_text else None,
        original_input=OriginalInstructionInput(
            raw_text=instruction_text if has_text else None,
            source_type=source_type,
            submitted_at=now,
            attachment_id=attachment_doc_id,
            attachment_filename=attachment_filename,
            attachment_mime_type=attachment_mime_type,
            attachment_storage_uri=attachment_storage_uri,
        ),
        attachment_ids=attachment_ids,
        ai_extraction=ai_extraction,
        confirmed_extraction=None,
        ai_suggestion=None,
        deterministic_estimate=None,
        is_demo=is_demo,
        created_at=now,
        updated_at=now,
    )
    saved_case = repo.save_case(case)
    repo.append_lifecycle_history(
        LifecycleHistoryEntry(
            id=f"lhist-{uuid.uuid4().hex[:12]}",
            project_id=clean_project_id,
            case_id=case_id,
            from_status=None,
            to_status=VariationLifecycleStatus.detected,
            changed_by="system:intake",
            changed_at=now,
            reason="Initial site instruction recorded",
            tracking_snapshot=saved_case.commercial_tracking.model_dump(mode="json"),
        )
    )
    return saved_case


@router.patch("/cases/{case_id}/extraction", response_model=VariationCase)
def confirm_case_extraction(
    case_id: str,
    payload: ConfirmExtractionRequest,
    project_id: Optional[str] = Query(default=None),
) -> VariationCase:
    """Save QS/user edits and optionally confirm a site-change event extraction."""
    clean_project = project_id.strip() if project_id and project_id.strip() else None
    repo = get_case_repository()
    existing = repo.get_case(case_id)
    if existing is None or (clean_project is not None and existing.project_id != clean_project):
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' was not found.",
        )

    reviewer_name = payload.confirmed_by.strip() if payload.confirmed_by else None
    if payload.confirm and not reviewer_name:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="confirmed_by (reviewer name) is required to confirm an extraction.",
        )

    now = datetime.now(timezone.utc)
    confirmed_event = ConfirmedChangeEvent(
        origin="human_confirmed",
        confirmation_status="confirmed" if payload.confirm else "pending_review",
        confirmed_by=reviewer_name,
        confirmed_at=now if payload.confirm else None,
        reviewer_notes=(
            payload.reviewer_notes.strip()
            if payload.reviewer_notes and payload.reviewer_notes.strip()
            else None
        ),
        fields=payload.fields,
    )

    updated_title = _derive_case_title(
        existing.id,
        existing.instruction_text or "",
        payload.fields.instruction_description.value,
        payload.fields.requested_work.value,
    )

    updated = existing.model_copy(
        update={
            "title": updated_title,
            "confirmed_extraction": confirmed_event,
            "updated_at": now,
        }
    )
    return repo.save_case(updated)
