"""Deterministic document parsing services for contract PDFs and BOQ Excel workbooks."""

from decimal import Decimal, InvalidOperation
import io
import math
import re
from typing import Any, Optional
from zipfile import BadZipFile

import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.utils.exceptions import InvalidFileException
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.models.schemas import (
    BoqExtractionResult,
    BoqRow,
    BoqSheet,
    ContractExtractionResult,
    ContractPage,
    DocumentProcessingStatus,
    DocumentType,
    SourceReference,
)

MAX_HEADER_SCAN_ROWS = 15
MAX_PDF_PAGES = 500
MAX_BOQ_SCAN_ROWS = 5000
MAX_BOQ_SCAN_COLS = 100

_ITEM_CODE_HEADERS = {
    "item",
    "item no",
    "item #",
    "item ref",
    "ref",
    "code",
    "no",
    "no.",
    "s.no",
    "sr no",
    "sr. no",
    "boq ref",
    "boq item",
}
_DESCRIPTION_HEADERS = {
    "description",
    "item description",
    "work description",
    "particulars",
    "scope",
    "work item",
    "activity",
}
_UNIT_HEADERS = {"unit", "uom", "u/m", "units"}
_QUANTITY_HEADERS = {
    "qty",
    "qty.",
    "quantity",
    "est qty",
    "est. qty",
    "estimated qty",
    "estimated quantity",
    "boq qty",
}
_RATE_HEADERS = {"rate", "unit rate", "unit price", "price", "rate/unit"}
_AMOUNT_HEADERS = {
    "amount",
    "total",
    "total amount",
    "line total",
    "extended",
    "cost",
}
_NUMERIC_FIELDS = {"quantity", "rate", "amount"}
_NULL_TEXT_TOKENS = {
    "",
    "-",
    "--",
    "—",
    "n/a",
    "na",
    "tbd",
    "tba",
    "nil",
    "none",
    "rate only",
    "included",
    "incl.",
    "incl",
}
_CURRENCY_RE = re.compile(
    r"^(?:[$£€₹]|USD|GBP|EUR|AED|SAR|AUD|CAD)\s*|\s*(?:[$£€₹]|USD|GBP|EUR|AED|SAR|AUD|CAD)$",
    re.IGNORECASE,
)


class DocumentParseError(ValueError):
    """Raised when an uploaded file is empty, corrupted, encrypted, or unreadable."""


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).replace("\r\n", "\n").strip()
    return text if text else None


def _normalize_header(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _canonical_boq_field(header_text: str) -> Optional[str]:
    norm = _normalize_header(header_text)
    if not norm:
        return None
    if norm in _ITEM_CODE_HEADERS:
        return "item_code"
    if norm in _DESCRIPTION_HEADERS:
        return "description"
    if norm in _UNIT_HEADERS:
        return "unit"
    if norm in _QUANTITY_HEADERS:
        return "quantity"
    if norm in _RATE_HEADERS or norm.startswith(("rate (", "unit rate (")):
        return "rate"
    if norm in _AMOUNT_HEADERS or norm.startswith(("amount (", "total (")):
        return "amount"
    return None


def _parse_decimal_or_none(value: Any) -> Optional[Decimal]:
    """Parse an exact Decimal from a cell value, returning None if absent or non-numeric."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return Decimal(str(value))

    raw = str(value).strip()
    if raw.lower() in _NULL_TEXT_TOKENS:
        return None

    cleaned = _CURRENCY_RE.sub("", raw).replace(",", "").strip()
    if not cleaned:
        return None
    try:
        parsed = Decimal(cleaned)
    except InvalidOperation:
        return None
    return parsed if parsed.is_finite() else None


def _is_numeric_like(value: Any) -> bool:
    return _parse_decimal_or_none(value) is not None


def _dedupe_column_names(raw_headers: list[Optional[str]]) -> list[str]:
    seen: dict[str, int] = {}
    columns: list[str] = []
    for col_idx, header in enumerate(raw_headers, start=1):
        base = header if header else f"Column {get_column_letter(col_idx)}"
        count = seen.get(base, 0) + 1
        seen[base] = count
        columns.append(base if count == 1 else f"{base} ({count})")
    return columns


def parse_contract_pdf(
    document_id: str, document_name: str, pdf_bytes: bytes
) -> tuple[ContractExtractionResult, DocumentProcessingStatus, str]:
    """Extract page-level text from a contract PDF while preserving exact page numbers."""
    if not pdf_bytes:
        raise DocumentParseError("Uploaded PDF file is empty.")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except (PdfReadError, Exception) as exc:
        raise DocumentParseError(f"Invalid or corrupted PDF file: {exc}") from exc

    if reader.is_encrypted:
        try:
            decrypted = reader.decrypt("")
        except Exception as exc:
            raise DocumentParseError(
                "PDF is password-protected/encrypted and cannot be extracted."
            ) from exc
        if not decrypted:
            raise DocumentParseError(
                "PDF is password-protected/encrypted and cannot be extracted."
            )

    page_count = len(reader.pages)
    if page_count == 0:
        raise DocumentParseError("PDF contains 0 pages.")
    if page_count > MAX_PDF_PAGES:
        raise DocumentParseError(
            f"PDF has {page_count} pages, exceeding the safety limit of {MAX_PDF_PAGES} pages."
        )

    pages: list[ContractPage] = []
    unreadable_pages: list[int] = []

    for page_number, page in enumerate(reader.pages, start=1):
        try:
            raw_text = page.extract_text() or ""
        except Exception as exc:
            raise DocumentParseError(
                f"Failed to read text on Page {page_number}: {exc}"
            ) from exc

        normalized_text = raw_text.replace("\r\n", "\n").strip()
        is_readable = bool(normalized_text)
        if not is_readable:
            unreadable_pages.append(page_number)

        source_ref = SourceReference(
            document_id=document_id,
            document_name=document_name,
            document_type=DocumentType.contract_pdf,
            location=f"Page {page_number}",
            excerpt=normalized_text[:240]
            if normalized_text
            else "[No extractable text on this page]",
        )
        pages.append(
            ContractPage(
                page_number=page_number,
                text=normalized_text,
                character_count=len(normalized_text),
                is_readable=is_readable,
                source_reference=source_ref,
            )
        )

    readable_page_count = page_count - len(unreadable_pages)
    warnings: list[str] = []

    if readable_page_count == 0:
        status = DocumentProcessingStatus.unreadable
        status_message = (
            f"No extractable text found across {page_count} page(s). "
            "The PDF appears to be scanned or image-only; OCR is not enabled in Phase 2."
        )
        warnings.append(status_message)
    elif unreadable_pages:
        status = DocumentProcessingStatus.partial
        missing_list = ", ".join(str(p) for p in unreadable_pages)
        status_message = (
            f"Extracted text from {readable_page_count} of {page_count} page(s). "
            f"Page(s) {missing_list} had no extractable text (possibly blank or scanned)."
        )
        warnings.append(status_message)
    else:
        status = DocumentProcessingStatus.extracted
        status_message = f"Extracted text from {page_count} of {page_count} page(s)."

    result = ContractExtractionResult(
        page_count=page_count,
        readable_page_count=readable_page_count,
        unreadable_pages=unreadable_pages,
        pages=pages,
        warnings=warnings,
    )
    return result, status, status_message


def parse_boq_excel(
    document_id: str, document_name: str, excel_bytes: bytes
) -> tuple[BoqExtractionResult, DocumentProcessingStatus, str]:
    """Extract sheets and rows from a BOQ .xlsx workbook with exact sheet/row references."""
    if not excel_bytes:
        raise DocumentParseError("Uploaded Excel file is empty.")

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(excel_bytes), data_only=True)
    except (InvalidFileException, BadZipFile, KeyError, ValueError, OSError) as exc:
        raise DocumentParseError(f"Invalid or corrupted .xlsx file: {exc}") from exc

    try:
        if not workbook.worksheets:
            raise DocumentParseError("Excel workbook contains no worksheets.")

        sheets: list[BoqSheet] = []
        workbook_warnings: list[str] = []

        for ws in workbook.worksheets:
            sheet_warnings: list[str] = []
            merged_ranges = [str(rng) for rng in ws.merged_cells.ranges]

            # Build safe merged-cell rules:
            # - Non-anchor cells in horizontal/rectangular merges stay None.
            # - Vertical single-column merges retain anchor metadata so text fields
            #   can carry down safely without duplicating numeric quantities/rates.
            non_anchor_merged_cells: set[tuple[int, int]] = set()
            vertical_merge_anchors: dict[tuple[int, int], tuple[Any, str]] = {}
            rect_merge_warnings: set[str] = set()

            for rng in ws.merged_cells.ranges:
                anchor_value = ws.cell(rng.min_row, rng.min_col).value
                is_vertical_single_col = (
                    rng.min_col == rng.max_col and rng.max_row > rng.min_row
                )
                is_multi_col_multi_row = (
                    rng.max_col > rng.min_col and rng.max_row > rng.min_row
                )
                for row_i in range(rng.min_row, rng.max_row + 1):
                    for col_i in range(rng.min_col, rng.max_col + 1):
                        if row_i == rng.min_row and col_i == rng.min_col:
                            continue
                        non_anchor_merged_cells.add((row_i, col_i))
                        if is_vertical_single_col:
                            vertical_merge_anchors[(row_i, col_i)] = (
                                anchor_value,
                                str(rng),
                            )
                if is_multi_col_multi_row:
                    rect_merge_warnings.add(str(rng))

            for rng_str in sorted(rect_merge_warnings):
                sheet_warnings.append(
                    f"Multi-column merged range {rng_str} kept only its top-left cell value."
                )

            raw_max_row = ws.max_row or 0
            raw_max_col = ws.max_column or 0
            max_row = min(raw_max_row, MAX_BOQ_SCAN_ROWS)
            max_col = min(raw_max_col, MAX_BOQ_SCAN_COLS)
            if raw_max_row > MAX_BOQ_SCAN_ROWS or raw_max_col > MAX_BOQ_SCAN_COLS:
                sheet_warnings.append(
                    f"Sheet '{ws.title}' formatted dimensions ({raw_max_row}x{raw_max_col}) exceeded "
                    f"scan cap and were safely bounded to {MAX_BOQ_SCAN_ROWS}x{MAX_BOQ_SCAN_COLS}."
                )
            if max_row == 0 or max_col == 0:
                sheet_warnings.append(f"Sheet '{ws.title}' is empty.")
                sheets.append(
                    BoqSheet(
                        sheet_name=ws.title,
                        merged_ranges=merged_ranges,
                        warnings=sheet_warnings,
                    )
                )
                continue

            raw_grid: list[list[Any]] = []
            last_non_empty_row = 0
            for r in range(1, max_row + 1):
                row_vals: list[Any] = []
                row_has_data = False
                for c in range(1, max_col + 1):
                    if (r, c) in non_anchor_merged_cells:
                        row_vals.append(None)
                    else:
                        cell_val = ws.cell(r, c).value
                        row_vals.append(cell_val)
                        if _clean_text(cell_val) is not None:
                            row_has_data = True
                if row_has_data:
                    last_non_empty_row = r
                raw_grid.append(row_vals)

            if last_non_empty_row == 0:
                sheet_warnings.append(f"Sheet '{ws.title}' contains no non-empty cells.")
                sheets.append(
                    BoqSheet(
                        sheet_name=ws.title,
                        merged_ranges=merged_ranges,
                        warnings=sheet_warnings,
                    )
                )
                workbook_warnings.extend(f"{ws.title}: {msg}" for msg in sheet_warnings)
                continue

            raw_grid = raw_grid[:last_non_empty_row]

            # Detect BOQ header row among the first MAX_HEADER_SCAN_ROWS non-blank rows.
            header_row_number: Optional[int] = None
            non_blank_scanned = 0
            for idx, raw_vals in enumerate(raw_grid, start=1):
                # Resolve vertical merge values when checking potential header rows.
                candidate_vals = [
                    vertical_merge_anchors[(idx, c)][0]
                    if (idx, c) in vertical_merge_anchors and val is None
                    else val
                    for c, val in enumerate(raw_vals, start=1)
                ]
                if all(_clean_text(v) is None for v in candidate_vals):
                    continue
                non_blank_scanned += 1
                matched_fields = {
                    field
                    for val in candidate_vals
                    if (cleaned := _clean_text(val)) is not None
                    and (field := _canonical_boq_field(cleaned)) is not None
                }
                if len(matched_fields) >= 2:
                    header_row_number = idx
                    break
                if non_blank_scanned >= MAX_HEADER_SCAN_ROWS:
                    break

            if header_row_number is not None:
                header_raw = [
                    _clean_text(
                        vertical_merge_anchors[(header_row_number, c)][0]
                        if (header_row_number, c) in vertical_merge_anchors and val is None
                        else val
                    )
                    for c, val in enumerate(raw_grid[header_row_number - 1], start=1)
                ]
                columns = _dedupe_column_names(header_raw)
                field_by_col: dict[int, str] = {}
                for c_idx, header_text in enumerate(header_raw):
                    if header_text is not None:
                        canonical = _canonical_boq_field(header_text)
                        if canonical and canonical not in field_by_col.values():
                            field_by_col[c_idx] = canonical
                data_start_row = header_row_number + 1
            else:
                columns = [f"Column {get_column_letter(c)}" for c in range(1, max_col + 1)]
                field_by_col = {}
                data_start_row = 1
                sheet_warnings.append(
                    "Standard BOQ column headers were not detected; raw cell values preserved with sheet/row references."
                )

            rows: list[BoqRow] = []
            blank_rows_skipped = 0
            warned_numeric_merges: set[str] = set()

            for row_idx in range(data_start_row, last_non_empty_row + 1):
                own_cells = raw_grid[row_idx - 1]
                # Skip rows whose own cells are all blank (never fabricate rows from vertical merges).
                if all(_clean_text(val) is None for val in own_cells):
                    blank_rows_skipped += 1
                    continue

                resolved_cells: list[Any] = []
                for c_zero, own_val in enumerate(own_cells):
                    col_num = c_zero + 1
                    if own_val is not None:
                        resolved_cells.append(own_val)
                        continue
                    merge_info = vertical_merge_anchors.get((row_idx, col_num))
                    if not merge_info:
                        resolved_cells.append(None)
                        continue
                    anchor_val, rng_str = merge_info
                    mapped_field = field_by_col.get(c_zero)
                    if mapped_field in _NUMERIC_FIELDS or _is_numeric_like(anchor_val):
                        resolved_cells.append(None)
                        if rng_str not in warned_numeric_merges:
                            warned_numeric_merges.add(rng_str)
                            sheet_warnings.append(
                                f"Merged cells {rng_str} in column '{columns[c_zero]}' were not duplicated across rows to avoid double-counting."
                            )
                    else:
                        resolved_cells.append(anchor_val)

                raw_values: dict[str, Optional[str]] = {}
                for col_name, cell_val in zip(columns, resolved_cells):
                    raw_values[col_name] = _clean_text(cell_val)

                item_code: Optional[str] = None
                description: Optional[str] = None
                unit: Optional[str] = None
                quantity: Optional[Decimal] = None
                rate: Optional[Decimal] = None
                amount: Optional[Decimal] = None

                for c_zero, field_name in field_by_col.items():
                    val = resolved_cells[c_zero]
                    if field_name == "item_code":
                        item_code = _clean_text(val)
                    elif field_name == "description":
                        description = _clean_text(val)
                    elif field_name == "unit":
                        unit = _clean_text(val)
                    elif field_name == "quantity":
                        quantity = _parse_decimal_or_none(val)
                    elif field_name == "rate":
                        rate = _parse_decimal_or_none(val)
                    elif field_name == "amount":
                        amount = _parse_decimal_or_none(val)

                excerpt_parts = [
                    f"{k}: {v}" for k, v in raw_values.items() if v is not None
                ]
                excerpt = " | ".join(excerpt_parts)[:240]

                rows.append(
                    BoqRow(
                        sheet_name=ws.title,
                        row_number=row_idx,
                        item_code=item_code,
                        description=description,
                        unit=unit,
                        quantity=quantity,
                        rate=rate,
                        amount=amount,
                        raw_values=raw_values,
                        source_reference=SourceReference(
                            document_id=document_id,
                            document_name=document_name,
                            document_type=DocumentType.boq_excel,
                            location=f"Sheet '{ws.title}', Row {row_idx}",
                            excerpt=excerpt,
                        ),
                    )
                )

            if not rows and not sheet_warnings:
                sheet_warnings.append(f"Sheet '{ws.title}' contained no non-blank BOQ rows.")

            sheets.append(
                BoqSheet(
                    sheet_name=ws.title,
                    header_row_number=header_row_number,
                    columns=columns,
                    merged_ranges=merged_ranges,
                    blank_rows_skipped=blank_rows_skipped,
                    rows=rows,
                    warnings=sheet_warnings,
                )
            )
            workbook_warnings.extend(
                f"{ws.title}: {msg}" for msg in sheet_warnings
            )

        sheet_count = len(sheets)
        total_rows = sum(len(sheet.rows) for sheet in sheets)

        if total_rows == 0:
            status = DocumentProcessingStatus.unreadable
            status_message = (
                f"Workbook contains no extractable BOQ rows across {sheet_count} sheet(s)."
            )
            workbook_warnings.append(status_message)
        else:
            status = DocumentProcessingStatus.extracted
            status_message = (
                f"Extracted {total_rows} BOQ row(s) across {sheet_count} sheet(s)."
            )

        result = BoqExtractionResult(
            sheet_count=sheet_count,
            total_rows=total_rows,
            sheets=sheets,
            warnings=workbook_warnings,
        )
        return result, status, status_message
    finally:
        workbook.close()
