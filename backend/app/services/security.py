"""Security validation, filename sanitization, upload bounds, and secret redaction utilities."""

from pathlib import Path
import re
from typing import Optional, Sequence

from fastapi import UploadFile

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
_PROJECT_ID_MAX_LEN = 120
_FILENAME_MAX_LEN = 180


class SecurityValidationError(ValueError):
    """Raised when user/file input violates safety, path, size, or signature checks."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def validate_project_id(raw_project_id: Optional[str]) -> str:
    """Validate and normalize project_id against traversal, control chars, and path separators."""
    if raw_project_id is None:
        raise SecurityValidationError("project_id cannot be empty.")
    cleaned = raw_project_id.strip()
    if not cleaned:
        raise SecurityValidationError("project_id cannot be empty.")
    if len(cleaned) > _PROJECT_ID_MAX_LEN:
        raise SecurityValidationError(
            f"project_id cannot exceed {_PROJECT_ID_MAX_LEN} characters."
        )
    if _CONTROL_CHARS_RE.search(cleaned):
        raise SecurityValidationError(
            "project_id contains invalid control characters."
        )
    if "/" in cleaned or "\\" in cleaned or ".." in cleaned:
        raise SecurityValidationError(
            "project_id cannot contain path separators or traversal segments ('/', '\\', '..')."
        )
    return cleaned


def sanitize_filename(raw_filename: Optional[str]) -> str:
    """Extract a safe basename free of traversal segments, quotes, and control characters."""
    if not raw_filename:
        raise SecurityValidationError("Uploaded file must include a filename.")
    # Handle both Windows and POSIX separators regardless of host OS
    normalized = raw_filename.replace("\\", "/")
    basename = Path(normalized).name
    cleaned = _CONTROL_CHARS_RE.sub("", basename)
    cleaned = cleaned.replace('"', "").replace("'", "").replace("\x00", "")
    cleaned = cleaned.lstrip(".").strip()
    if not cleaned:
        raise SecurityValidationError("Uploaded file has an invalid or empty filename.")
    if len(cleaned) > _FILENAME_MAX_LEN:
        stem = Path(cleaned).stem[: _FILENAME_MAX_LEN - 20]
        suffix = Path(cleaned).suffix[:16]
        cleaned = f"{stem}{suffix}"
    return cleaned


async def read_upload_bounded(
    upload: UploadFile, max_bytes: int, label: str
) -> bytes:
    """Read uploaded bytes up to max_bytes + 1, rejecting empty or oversized payloads."""
    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive.")
    data = await upload.read(max_bytes + 1)
    if not data:
        raise SecurityValidationError(f"Uploaded {label} is empty.", status_code=400)
    if len(data) > max_bytes:
        raise SecurityValidationError(
            f"Uploaded {label} exceeds maximum allowed size of {max_bytes} bytes.",
            status_code=413,
        )
    return data


def validate_file_signature(data: bytes, ext: str) -> None:
    """Verify binary file magic bytes match the declared extension."""
    ext_lower = ext.lower().strip()
    if ext_lower == ".pdf":
        head = data[:64].lstrip(b"\xef\xbb\xbf\r\n\t ")
        if not head.startswith(b"%PDF-"):
            raise SecurityValidationError(
                "File content does not match a valid PDF header (%PDF-)."
            )
        return

    if ext_lower == ".xlsx":
        if not data.startswith(b"PK\x03\x04"):
            raise SecurityValidationError(
                "File content does not match a valid .xlsx OOXML archive signature."
            )
        return

    if ext_lower == ".png":
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SecurityValidationError(
                "File content does not match a valid PNG image signature."
            )
        return

    if ext_lower in {".jpg", ".jpeg"}:
        if not data.startswith(b"\xff\xd8\xff"):
            raise SecurityValidationError(
                "File content does not match a valid JPEG image signature."
            )
        return

    if ext_lower == ".webp":
        if len(data) < 12 or not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
            raise SecurityValidationError(
                "File content does not match a valid WEBP image signature."
            )
        return

    if ext_lower == ".wav":
        if len(data) < 12 or not (data[:4] == b"RIFF" and data[8:12] == b"WAVE"):
            raise SecurityValidationError(
                "File content does not match a valid WAV audio signature."
            )
        return

    if ext_lower == ".ogg":
        if not data.startswith(b"OggS"):
            raise SecurityValidationError(
                "File content does not match a valid OGG audio signature."
            )
        return

    if ext_lower == ".mp3":
        if data.startswith(b"ID3"):
            return
        if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
            return
        raise SecurityValidationError(
            "File content does not match a valid MP3 audio signature."
        )

    if ext_lower == ".m4a":
        if len(data) < 12 or data[4:8] != b"ftyp":
            raise SecurityValidationError(
                "File content does not match a valid M4A audio signature."
            )
        return

    if ext_lower == ".webm":
        if not data.startswith(b"\x1a\x45\xdf\xa3"):
            raise SecurityValidationError(
                "File content does not match a valid WebM media signature."
            )
        return

    raise SecurityValidationError(f"Unsupported file extension '{ext_lower}'.")


def redact_secrets(text: str, secrets: Sequence[str]) -> str:
    """Replace any configured secret strings in text with '[REDACTED]'."""
    redacted = text
    for secret in secrets:
        cleaned = (secret or "").strip()
        if len(cleaned) >= 6:
            redacted = redacted.replace(cleaned, "[REDACTED]")
    return redacted


def sanitize_untrusted_delimiter(text: str, tag_name: str) -> str:
    """Neutralize closing XML-like fence tags inside untrusted user/document content."""
    pattern = re.compile(rf"</\s*{re.escape(tag_name)}\s*>", re.IGNORECASE)
    return pattern.sub(f"[/{tag_name}]", text)
