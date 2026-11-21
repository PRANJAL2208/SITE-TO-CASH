"""Project document routes (contract PDFs and BOQ Excel workbooks)."""

from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
from typing import Optional
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status

from app.config import get_settings
from app.models.schemas import (
    DocumentExtractionRecord,
    DocumentIngestResponse,
    DocumentMetadata,
    DocumentType,
)
from app.services.document_parser import (
    DocumentParseError,
    parse_boq_excel,
    parse_contract_pdf,
)
from app.services.security import (
    SecurityValidationError,
    read_upload_bounded,
    sanitize_filename,
    validate_file_signature,
    validate_project_id,
)
from app.storage import get_case_repository, get_file_store

router = APIRouter(tags=["documents"])


def _safe_slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._")
    return cleaned or fallback


def _validate_project_and_filename(
    file: UploadFile, project_id: str, expected_ext: str
) -> tuple[str, str]:
    try:
        clean_project_id = validate_project_id(project_id)
        filename = sanitize_filename(file.filename)
    except SecurityValidationError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from exc
    if not filename.lower().endswith(expected_ext):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type for '{filename}'. Expected a {expected_ext} file.",
        )
    return clean_project_id, filename


@router.get("/documents", response_model=list[DocumentMetadata])
def list_documents(
    project_id: Optional[str] = Query(default=None),
) -> list[DocumentMetadata]:
    """List uploaded contract and BOQ documents from the configured repository."""
    repo = get_case_repository()
    clean_project = project_id.strip() if project_id and project_id.strip() else None
    return repo.list_documents(project_id=clean_project)


@router.get("/documents/{document_id}", response_model=DocumentIngestResponse)
def get_document_detail(
    document_id: str,
    project_id: Optional[str] = Query(default=None),
) -> DocumentIngestResponse:
    """Retrieve a single uploaded document's metadata and persisted extraction payload."""
    clean_project = project_id.strip() if project_id and project_id.strip() else None
    repo = get_case_repository()
    doc = repo.get_document(document_id)
    if doc is None or (clean_project is not None and doc.project_id != clean_project):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document '{document_id}' was not found.",
        )
    extraction = repo.get_document_extraction(document_id)
    return DocumentIngestResponse(
        document=doc,
        contract_extraction=extraction.contract_extraction if extraction else None,
        boq_extraction=extraction.boq_extraction if extraction else None,
    )


@router.post(
    "/documents/contract",
    response_model=DocumentIngestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_contract_pdf(
    file: UploadFile = File(...),
    project_id: str = Form("default-project"),
    is_demo: bool = Form(False),
) -> DocumentIngestResponse:
    """Upload a contract PDF, store original bytes, and extract page-level text."""
    settings = get_settings()
    clean_project_id, filename = _validate_project_and_filename(
        file, project_id, ".pdf"
    )
    try:
        data = await read_upload_bounded(
            file, settings.max_document_upload_bytes, "PDF file"
        )
        validate_file_signature(data, ".pdf")
    except SecurityValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    content_sha256 = hashlib.sha256(data).hexdigest()
    repo = get_case_repository()
    duplicate = repo.find_duplicate_document(
        clean_project_id, DocumentType.contract_pdf, filename, content_sha256
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Duplicate contract PDF for project '{clean_project_id}': "
                f"already uploaded as '{duplicate.filename}' (id: {duplicate.id})."
            ),
        )

    doc_id = f"doc-{uuid.uuid4().hex[:12]}"
    try:
        extraction, proc_status, status_message = parse_contract_pdf(
            doc_id, filename, data
        )
    except DocumentParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    file_store = get_file_store()
    relative_path = (
        f"projects/{_safe_slug(clean_project_id, 'default')}/"
        f"contract_pdf/{doc_id}/{_safe_slug(filename, 'contract.pdf')}"
    )
    storage_uri = file_store.save_bytes(relative_path, data)

    metadata = DocumentMetadata(
        id=doc_id,
        filename=filename,
        document_type=DocumentType.contract_pdf,
        storage_uri=storage_uri,
        uploaded_at=datetime.now(timezone.utc),
        is_demo=is_demo,
        project_id=clean_project_id,
        content_sha256=content_sha256,
        processing_status=proc_status,
        status_message=status_message,
        page_count=extraction.page_count,
        readable_page_count=extraction.readable_page_count,
    )
    repo.save_document(metadata)
    repo.save_document_extraction(
        DocumentExtractionRecord(
            document_id=doc_id,
            document_type=DocumentType.contract_pdf,
            contract_extraction=extraction,
        )
    )
    return DocumentIngestResponse(
        document=metadata,
        contract_extraction=extraction,
    )


@router.post(
    "/documents/boq",
    response_model=DocumentIngestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_boq_excel(
    file: UploadFile = File(...),
    project_id: str = Form("default-project"),
    is_demo: bool = Form(False),
) -> DocumentIngestResponse:
    """Upload a BOQ .xlsx workbook, store original bytes, and extract sheets/rows."""
    settings = get_settings()
    clean_project_id, filename = _validate_project_and_filename(
        file, project_id, ".xlsx"
    )
    try:
        data = await read_upload_bounded(
            file, settings.max_document_upload_bytes, "Excel file"
        )
        validate_file_signature(data, ".xlsx")
    except SecurityValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    content_sha256 = hashlib.sha256(data).hexdigest()
    repo = get_case_repository()
    duplicate = repo.find_duplicate_document(
        clean_project_id, DocumentType.boq_excel, filename, content_sha256
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Duplicate BOQ workbook for project '{clean_project_id}': "
                f"already uploaded as '{duplicate.filename}' (id: {duplicate.id})."
            ),
        )

    doc_id = f"doc-{uuid.uuid4().hex[:12]}"
    try:
        extraction, proc_status, status_message = parse_boq_excel(
            doc_id, filename, data
        )
    except DocumentParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    file_store = get_file_store()
    relative_path = (
        f"projects/{_safe_slug(clean_project_id, 'default')}/"
        f"boq_excel/{doc_id}/{_safe_slug(filename, 'boq.xlsx')}"
    )
    storage_uri = file_store.save_bytes(relative_path, data)

    metadata = DocumentMetadata(
        id=doc_id,
        filename=filename,
        document_type=DocumentType.boq_excel,
        storage_uri=storage_uri,
        uploaded_at=datetime.now(timezone.utc),
        is_demo=is_demo,
        project_id=clean_project_id,
        content_sha256=content_sha256,
        processing_status=proc_status,
        status_message=status_message,
        sheet_count=extraction.sheet_count,
        row_count=extraction.total_rows,
    )
    repo.save_document(metadata)
    repo.save_document_extraction(
        DocumentExtractionRecord(
            document_id=doc_id,
            document_type=DocumentType.boq_excel,
            boq_extraction=extraction,
        )
    )
    return DocumentIngestResponse(
        document=metadata,
        boq_extraction=extraction,
    )
