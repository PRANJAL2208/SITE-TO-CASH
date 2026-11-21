"""Local filesystem and JSON implementation of storage abstractions."""

from pathlib import Path
from typing import Optional, TypeVar

from pydantic import BaseModel, TypeAdapter

from app.models.schemas import (
    CommercialAssessmentRecord,
    DocumentExtractionRecord,
    DocumentMetadata,
    DocumentType,
    EvidencePackRecord,
    LifecycleHistoryEntry,
    ReviewHistoryEntry,
    VariationCase,
)
from app.storage.base import CaseRepository, FileStore

ModelT = TypeVar("ModelT", bound=BaseModel)

_DOCS_ADAPTER = TypeAdapter(list[DocumentMetadata])
_CASES_ADAPTER = TypeAdapter(list[VariationCase])
_ASSESSMENTS_ADAPTER = TypeAdapter(list[CommercialAssessmentRecord])
_HISTORY_ADAPTER = TypeAdapter(list[ReviewHistoryEntry])
_REPORTS_ADAPTER = TypeAdapter(list[EvidencePackRecord])
_LIFECYCLE_HISTORY_ADAPTER = TypeAdapter(list[LifecycleHistoryEntry])


class LocalFileStore(FileStore):
    """Stores uploaded files on the local filesystem under `<local_data_dir>/files`."""

    def __init__(self, data_dir: Path) -> None:
        self.root = (data_dir / "files").resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve_safe(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        if not candidate.is_relative_to(self.root):
            raise ValueError(f"Unsafe relative storage path: {relative_path}")
        return candidate

    def save_bytes(self, relative_path: str, data: bytes) -> str:
        target = self._resolve_safe(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return f"local://files/{relative_path.lstrip('/')}"

    def read_bytes(self, relative_path: str) -> bytes:
        target = self._resolve_safe(relative_path)
        return target.read_bytes()

    def exists(self, relative_path: str) -> bool:
        return self._resolve_safe(relative_path).is_file()

    def is_ready(self) -> bool:
        return self.root.is_dir()


class LocalCaseRepository(CaseRepository):
    """Stores document metadata and variation cases as JSON under `<local_data_dir>/db`."""

    def __init__(self, data_dir: Path) -> None:
        self.db_dir = (data_dir / "db").resolve()
        self.extractions_dir = (self.db_dir / "extractions").resolve()
        self.db_dir.mkdir(parents=True, exist_ok=True)
        self.extractions_dir.mkdir(parents=True, exist_ok=True)
        self.documents_file = self.db_dir / "documents.json"
        self.cases_file = self.db_dir / "cases.json"
        self.assessments_file = self.db_dir / "assessments.json"
        self.history_file = self.db_dir / "review_history.json"
        self.reports_file = self.db_dir / "reports.json"
        self.lifecycle_history_file = self.db_dir / "lifecycle_history.json"

    def _extraction_path(self, document_id: str) -> Path:
        candidate = (self.extractions_dir / f"{document_id}.json").resolve()
        if not candidate.is_relative_to(self.extractions_dir):
            raise ValueError(f"Unsafe document_id: {document_id}")
        return candidate

    def _read_list(self, path: Path, adapter: TypeAdapter[list[ModelT]]) -> list[ModelT]:
        if not path.exists():
            return []
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        return adapter.validate_json(raw)

    def _write_list(
        self, path: Path, adapter: TypeAdapter[list[ModelT]], items: list[ModelT]
    ) -> None:
        payload = adapter.dump_json(items, indent=2).decode("utf-8")
        path.write_text(payload, encoding="utf-8")

    def list_documents(
        self, project_id: Optional[str] = None
    ) -> list[DocumentMetadata]:
        docs = self._read_list(self.documents_file, _DOCS_ADAPTER)
        if project_id is None:
            return docs
        return [doc for doc in docs if doc.project_id == project_id]

    def get_document(self, document_id: str) -> Optional[DocumentMetadata]:
        for doc in self.list_documents():
            if doc.id == document_id:
                return doc
        return None

    def find_duplicate_document(
        self,
        project_id: str,
        document_type: DocumentType,
        filename: str,
        content_sha256: str,
    ) -> Optional[DocumentMetadata]:
        normalized_name = filename.strip().lower()
        for doc in self.list_documents(project_id=project_id):
            if doc.document_type != document_type:
                continue
            if doc.content_sha256 and doc.content_sha256 == content_sha256:
                return doc
            if doc.filename.strip().lower() == normalized_name:
                return doc
        return None

    def save_document(self, doc: DocumentMetadata) -> DocumentMetadata:
        docs = self.list_documents()
        updated = [d for d in docs if d.id != doc.id]
        updated.append(doc)
        self._write_list(self.documents_file, _DOCS_ADAPTER, updated)
        return doc

    def save_document_extraction(
        self, record: DocumentExtractionRecord
    ) -> DocumentExtractionRecord:
        target = self._extraction_path(record.document_id)
        target.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        return record

    def get_document_extraction(
        self, document_id: str
    ) -> Optional[DocumentExtractionRecord]:
        target = self._extraction_path(document_id)
        if not target.is_file():
            return None
        return DocumentExtractionRecord.model_validate_json(
            target.read_text(encoding="utf-8")
        )

    def list_cases(
        self, project_id: Optional[str] = None
    ) -> list[VariationCase]:
        cases = self._read_list(self.cases_file, _CASES_ADAPTER)
        if project_id is None:
            return cases
        return [item for item in cases if item.project_id == project_id]

    def get_case(self, case_id: str) -> Optional[VariationCase]:
        for item in self.list_cases():
            if item.id == case_id:
                return item
        return None

    def save_case(self, case: VariationCase) -> VariationCase:
        cases = self.list_cases()
        updated = [c for c in cases if c.id != case.id]
        updated.append(case)
        self._write_list(self.cases_file, _CASES_ADAPTER, updated)
        return case

    def list_assessments(
        self,
        project_id: Optional[str] = None,
        case_id: Optional[str] = None,
    ) -> list[CommercialAssessmentRecord]:
        records = self._read_list(self.assessments_file, _ASSESSMENTS_ADAPTER)
        if project_id is not None:
            records = [r for r in records if r.project_id == project_id]
        if case_id is not None:
            records = [r for r in records if r.case_id == case_id]
        return records

    def get_assessment(
        self, assessment_id: str
    ) -> Optional[CommercialAssessmentRecord]:
        for record in self.list_assessments():
            if record.id == assessment_id:
                return record
        return None

    def get_latest_assessment_for_case(
        self, case_id: str
    ) -> Optional[CommercialAssessmentRecord]:
        matches = self.list_assessments(case_id=case_id)
        if not matches:
            return None
        return max(matches, key=lambda item: item.assessed_at)

    def save_assessment(
        self, record: CommercialAssessmentRecord
    ) -> CommercialAssessmentRecord:
        records = self.list_assessments()
        updated = [r for r in records if r.id != record.id]
        updated.append(record)
        self._write_list(self.assessments_file, _ASSESSMENTS_ADAPTER, updated)
        return record

    def append_review_history(
        self, entry: ReviewHistoryEntry
    ) -> ReviewHistoryEntry:
        entries = self._read_list(self.history_file, _HISTORY_ADAPTER)
        entries.append(entry)
        self._write_list(self.history_file, _HISTORY_ADAPTER, entries)
        return entry

    def list_review_history(
        self,
        case_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> list[ReviewHistoryEntry]:
        entries = self._read_list(self.history_file, _HISTORY_ADAPTER)
        if case_id is not None:
            entries = [e for e in entries if e.case_id == case_id]
        if project_id is not None:
            entries = [e for e in entries if e.project_id == project_id]
        return sorted(entries, key=lambda e: e.timestamp)

    def save_report(self, record: EvidencePackRecord) -> EvidencePackRecord:
        records = self._read_list(self.reports_file, _REPORTS_ADAPTER)
        updated = [r for r in records if r.id != record.id]
        updated.append(record)
        self._write_list(self.reports_file, _REPORTS_ADAPTER, updated)
        return record

    def get_report(self, report_id: str) -> Optional[EvidencePackRecord]:
        for record in self._read_list(self.reports_file, _REPORTS_ADAPTER):
            if record.id == report_id:
                return record
        return None

    def list_reports(
        self,
        case_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> list[EvidencePackRecord]:
        records = self._read_list(self.reports_file, _REPORTS_ADAPTER)
        if case_id is not None:
            records = [r for r in records if r.case_id == case_id]
        if project_id is not None:
            records = [r for r in records if r.project_id == project_id]
        return sorted(records, key=lambda r: r.generated_at, reverse=True)

    def append_lifecycle_history(
        self, entry: LifecycleHistoryEntry
    ) -> LifecycleHistoryEntry:
        entries = self._read_list(
            self.lifecycle_history_file, _LIFECYCLE_HISTORY_ADAPTER
        )
        entries.append(entry)
        self._write_list(
            self.lifecycle_history_file, _LIFECYCLE_HISTORY_ADAPTER, entries
        )
        return entry

    def list_lifecycle_history(
        self,
        case_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> list[LifecycleHistoryEntry]:
        entries = self._read_list(
            self.lifecycle_history_file, _LIFECYCLE_HISTORY_ADAPTER
        )
        if case_id is not None:
            entries = [e for e in entries if e.case_id == case_id]
        if project_id is not None:
            entries = [e for e in entries if e.project_id == project_id]
        return sorted(entries, key=lambda e: e.changed_at)

    def is_ready(self) -> bool:
        return self.db_dir.is_dir()
