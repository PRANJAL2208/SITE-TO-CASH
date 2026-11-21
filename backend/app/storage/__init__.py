"""Storage backend factories selecting local or GCP implementations."""

from typing import Optional

from app.config import Settings, get_settings
from app.storage.base import CaseRepository, FileStore
from app.storage.local import LocalCaseRepository, LocalFileStore


def get_file_store(settings: Optional[Settings] = None) -> FileStore:
    """Instantiate the configured FileStore implementation."""
    cfg = settings or get_settings()
    if cfg.storage_backend == "local":
        return LocalFileStore(cfg.local_data_dir)
    if cfg.storage_backend == "gcp":
        raise NotImplementedError(
            "GCP Cloud Storage adapter is scheduled for Phase 8 (see CHECKLIST.md)."
        )
    raise ValueError(f"Unsupported STORAGE_BACKEND: {cfg.storage_backend}")


def get_case_repository(settings: Optional[Settings] = None) -> CaseRepository:
    """Instantiate the configured CaseRepository implementation."""
    cfg = settings or get_settings()
    if cfg.storage_backend == "local":
        return LocalCaseRepository(cfg.local_data_dir)
    if cfg.storage_backend == "gcp":
        raise NotImplementedError(
            "GCP Firestore repository adapter is scheduled for Phase 8 (see CHECKLIST.md)."
        )
    raise ValueError(f"Unsupported STORAGE_BACKEND: {cfg.storage_backend}")
