"""Storage interfaces designed for local development and GCP Cloud Storage / Firestore."""

from abc import ABC, abstractmethod
from typing import Optional

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


class FileStore(ABC):
    """Binary object store abstraction (local filesystem now; GCS in Phase 8)."""

    @abstractmethod
    def save_bytes(self, relative_path: str, data: bytes) -> str:
        """Persist raw bytes and return a storage URI."""

    @abstractmethod
    def read_bytes(self, relative_path: str) -> bytes:
        """Read raw bytes from storage."""

    @abstractmethod
    def exists(self, relative_path: str) -> bool:
        """Return whether an object exists at relative_path."""

    @abstractmethod
    def is_ready(self) -> bool:
        """Return whether the backing store is accessible."""


class CaseRepository(ABC):
    """Structured metadata & variation register store (local JSON now; Firestore in Phase 8)."""

    @abstractmethod
    def list_documents(
        self, project_id: Optional[str] = None
    ) -> list[DocumentMetadata]:
        """List uploaded project/instruction documents, optionally filtered by project."""

    @abstractmethod
    def get_document(self, document_id: str) -> Optional[DocumentMetadata]:
        """Retrieve a single document metadata record by ID."""

    @abstractmethod
    def find_duplicate_document(
        self,
        project_id: str,
        document_type: DocumentType,
        filename: str,
        content_sha256: str,
    ) -> Optional[DocumentMetadata]:
        """Find an existing document in the same project matching filename or content hash."""

    @abstractmethod
    def save_document(self, doc: DocumentMetadata) -> DocumentMetadata:
        """Create or update a document metadata record."""

    @abstractmethod
    def save_document_extraction(
        self, record: DocumentExtractionRecord
    ) -> DocumentExtractionRecord:
        """Persist extracted structure for a document."""

    @abstractmethod
    def get_document_extraction(
        self, document_id: str
    ) -> Optional[DocumentExtractionRecord]:
        """Retrieve persisted extracted structure for a document."""

    @abstractmethod
    def list_cases(
        self, project_id: Optional[str] = None
    ) -> list[VariationCase]:
        """List cases in the variation register, optionally filtered by project."""

    @abstractmethod
    def get_case(self, case_id: str) -> Optional[VariationCase]:
        """Retrieve a single variation case by ID."""

    @abstractmethod
    def save_case(self, case: VariationCase) -> VariationCase:
        """Create or update a variation case."""

    @abstractmethod
    def list_assessments(
        self,
        project_id: Optional[str] = None,
        case_id: Optional[str] = None,
    ) -> list[CommercialAssessmentRecord]:
        """List saved preliminary commercial assessments filtered by project/case."""

    @abstractmethod
    def get_assessment(
        self, assessment_id: str
    ) -> Optional[CommercialAssessmentRecord]:
        """Retrieve a single commercial assessment record by ID."""

    @abstractmethod
    def get_latest_assessment_for_case(
        self, case_id: str
    ) -> Optional[CommercialAssessmentRecord]:
        """Retrieve the most recent commercial assessment for a given case ID."""

    @abstractmethod
    def save_assessment(
        self, record: CommercialAssessmentRecord
    ) -> CommercialAssessmentRecord:
        """Create or update a preliminary commercial assessment record."""

    @abstractmethod
    def append_review_history(
        self, entry: ReviewHistoryEntry
    ) -> ReviewHistoryEntry:
        """Append an immutable review/cost audit trail entry."""

    @abstractmethod
    def list_review_history(
        self,
        case_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> list[ReviewHistoryEntry]:
        """List append-only review history entries filtered by case/project."""

    @abstractmethod
    def save_report(self, record: EvidencePackRecord) -> EvidencePackRecord:
        """Create or update a generated PDF evidence pack metadata record."""

    @abstractmethod
    def get_report(self, report_id: str) -> Optional[EvidencePackRecord]:
        """Retrieve a single evidence pack metadata record by ID."""

    @abstractmethod
    def list_reports(
        self,
        case_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> list[EvidencePackRecord]:
        """List evidence pack metadata records filtered by case/project."""

    @abstractmethod
    def append_lifecycle_history(
        self, entry: LifecycleHistoryEntry
    ) -> LifecycleHistoryEntry:
        """Append an immutable variation lifecycle status transition entry."""

    @abstractmethod
    def list_lifecycle_history(
        self,
        case_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> list[LifecycleHistoryEntry]:
        """List append-only lifecycle history entries filtered by case/project."""

    @abstractmethod
    def is_ready(self) -> bool:
        """Return whether the repository is initialized and writable/readable."""
