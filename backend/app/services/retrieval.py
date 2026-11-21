"""Project-scoped deterministic retrieval over ingested contract PDFs and BOQ Excel rows."""

import re
from typing import Optional

from app.models.schemas import (
    BoqRow,
    ChangeEventFields,
    DocumentType,
    RetrievedBoqItem,
    RetrievedContractClause,
    SourceReference,
)
from app.storage.base import CaseRepository

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_CLAUSE_HEADING_RE = re.compile(
    r"^\s*(?:(?P<label>Clause|Section|Article)\s+(?P<labeled_num>\d+(?:\.\d+)*)|(?P<bare_num>\d+\.\d+(?:\.\d+)*))\b(?P<rest>.*)$",
    re.IGNORECASE,
)

_STANDARD_STOPWORDS = {
    "a",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "into",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "per",
    "shall",
    "should",
    "that",
    "the",
    "their",
    "this",
    "to",
    "under",
    "was",
    "were",
    "which",
    "with",
    "within",
}

_GENERIC_CONSTRUCTION_STOPWORDS = {
    "add",
    "additional",
    "allowance",
    "area",
    "building",
    "complete",
    "confirmed",
    "day",
    "days",
    "demo",
    "data",
    "due",
    "extra",
    "floor",
    "general",
    "including",
    "install",
    "installation",
    "instruction",
    "item",
    "items",
    "level",
    "new",
    "please",
    "project",
    "provide",
    "required",
    "site",
    "supply",
    "team",
    "unspecified",
    "work",
    "works",
}

_COMMERCIAL_GOVERNANCE_TERMS = {
    "approval",
    "approve",
    "approved",
    "authority",
    "bill",
    "boq",
    "change",
    "claim",
    "confirm",
    "confirmed",
    "deadline",
    "entitlement",
    "exclude",
    "excluded",
    "exclusion",
    "include",
    "included",
    "inclusion",
    "instruction",
    "notice",
    "notify",
    "order",
    "quantities",
    "quantity",
    "rate",
    "scope",
    "valuation",
    "variation",
    "verbal",
    "written",
}


def _normalize_token(token: str) -> str:
    lowered = token.lower().strip()
    if len(lowered) > 4 and lowered.endswith("ies"):
        return lowered[:-3] + "y"
    if len(lowered) > 3 and lowered.endswith("s") and not lowered.endswith("ss"):
        return lowered[:-1]
    return lowered


def _tokenize_specific(text: Optional[str]) -> list[str]:
    if not text:
        return []
    tokens: list[str] = []
    seen: set[str] = set()
    for raw in _TOKEN_RE.findall(text.lower()):
        norm = _normalize_token(raw)
        has_digit = any(ch.isdigit() for ch in norm)
        if len(norm) < 3 and not has_digit:
            continue
        if norm in _STANDARD_STOPWORDS or norm in _GENERIC_CONSTRUCTION_STOPWORDS:
            continue
        if norm not in seen:
            seen.add(norm)
            tokens.append(norm)
    return tokens


def _tokenize_all_normalized(text: Optional[str]) -> set[str]:
    if not text:
        return set()
    return {_normalize_token(raw) for raw in _TOKEN_RE.findall(text.lower())}


def _extract_query_terms(fields: ChangeEventFields) -> tuple[list[str], list[str]]:
    """Return deduplicated specific terms and key phrases from confirmed fields."""
    candidate_texts: list[str] = []
    for single in (
        fields.requested_work,
        fields.instruction_description,
        fields.affected_activity,
        fields.project_site_location,
        fields.issuer_role,
    ):
        if single.value:
            candidate_texts.append(single.value)

    for qty in fields.mentioned_quantities:
        if qty.item_or_material:
            candidate_texts.append(qty.item_or_material)

    for item in fields.mentioned_materials + fields.scope_change_indicators:
        if item.value:
            candidate_texts.append(item.value)

    terms: list[str] = []
    seen_terms: set[str] = set()
    for text in candidate_texts:
        for tok in _tokenize_specific(text):
            if tok not in seen_terms:
                seen_terms.add(tok)
                terms.append(tok)

    phrases: list[str] = []
    for qty in fields.mentioned_quantities:
        if qty.item_or_material and len(qty.item_or_material.strip()) >= 4:
            phrases.append(qty.item_or_material.strip().lower())
    for item in fields.mentioned_materials:
        if item.value and len(item.value.strip()) >= 4:
            phrases.append(item.value.strip().lower())
    if fields.requested_work.value and len(fields.requested_work.value.strip()) >= 5:
        phrases.append(fields.requested_work.value.strip().lower())

    return terms, phrases


def _parse_clause_heading(line: str) -> Optional[tuple[str, Optional[str]]]:
    match = _CLAUSE_HEADING_RE.match(line)
    if not match:
        return None
    clause_num = match.group("labeled_num") or match.group("bare_num")
    if not clause_num:
        return None
    rest = (match.group("rest") or "").lstrip(" :.-\u2013\t").strip()
    clause_title: Optional[str] = None
    if rest:
        if ":" in rest:
            prefix = rest.split(":", 1)[0].strip()
            if prefix and len(prefix) <= 80:
                clause_title = prefix
        elif len(rest) <= 80 and not rest.endswith("."):
            clause_title = rest
    return clause_num, clause_title


def _segment_page_passages(
    page_text: str,
) -> list[tuple[Optional[str], Optional[str], str]]:
    """Split a contract PDF page into verbatim passages preserving explicit clause headers."""
    lines = page_text.splitlines()
    has_explicit_headings = any(_parse_clause_heading(line) is not None for line in lines)

    if not has_explicit_headings:
        passages = []
        for block in re.split(r"\n\s*\n+", page_text.strip()):
            cleaned = block.strip()
            if cleaned:
                passages.append((None, None, cleaned))
        if not passages and page_text.strip():
            passages.append((None, None, page_text.strip()))
        return passages

    segments: list[tuple[Optional[str], Optional[str], str]] = []
    current_num: Optional[str] = None
    current_title: Optional[str] = None
    current_lines: list[str] = []

    for line in lines:
        heading = _parse_clause_heading(line)
        if heading is not None:
            if current_lines:
                body = "\n".join(current_lines).strip()
                if body:
                    segments.append((current_num, current_title, body))
            current_num, current_title = heading
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        body = "\n".join(current_lines).strip()
        if body:
            segments.append((current_num, current_title, body))

    return segments


def retrieve_contract_clauses(
    repo: CaseRepository,
    project_id: str,
    query_terms: list[str],
    phrases: list[str],
    max_clauses: int = 8,
) -> list[RetrievedContractClause]:
    """Retrieve relevant contract PDF passages for the given project."""
    docs = [
        doc
        for doc in repo.list_documents(project_id=project_id)
        if doc.document_type == DocumentType.contract_pdf
    ]

    candidates: list[tuple[tuple[float, int, int], RetrievedContractClause]] = []
    query_term_set = set(query_terms)

    for doc in docs:
        record = repo.get_document_extraction(doc.id)
        if not record or not record.contract_extraction:
            continue
        for page in record.contract_extraction.pages:
            if not page.is_readable or not page.text.strip():
                continue
            for clause_num, clause_title, passage_text in _segment_page_passages(page.text):
                passage_tokens = _tokenize_all_normalized(passage_text)
                passage_lower = passage_text.lower()

                work_matches = sorted(query_term_set & passage_tokens)
                gov_matches = sorted(_COMMERCIAL_GOVERNANCE_TERMS & passage_tokens)
                phrase_hits = [p for p in phrases if p in passage_lower]

                if not work_matches and len(gov_matches) < 2 and not phrase_hits:
                    continue

                score = (
                    len(work_matches) * 3.0
                    + len(phrase_hits) * 4.0
                    + len(gov_matches) * 1.0
                )
                matched_terms = list(dict.fromkeys(work_matches + gov_matches))

                reason_parts: list[str] = []
                if work_matches:
                    reason_parts.append(
                        f"Matched scope/work terms: {', '.join(work_matches[:5])}"
                    )
                if gov_matches:
                    reason_parts.append(
                        f"Contains contract governance terms: {', '.join(gov_matches[:5])}"
                    )
                relevance_reason = "; ".join(reason_parts) or "Matched instruction phrase."

                location = (
                    f"Page {page.page_number}, Clause {clause_num}"
                    if clause_num
                    else f"Page {page.page_number}"
                )
                src_ref = SourceReference(
                    document_id=doc.id,
                    document_name=doc.filename,
                    document_type=DocumentType.contract_pdf,
                    location=location,
                    excerpt=passage_text[:240],
                )
                candidates.append(
                    (
                        (score, len(work_matches), -page.page_number),
                        RetrievedContractClause(
                            ref_id="",
                            document_id=doc.id,
                            document_name=doc.filename,
                            page_number=page.page_number,
                            clause_number=clause_num,
                            clause_title=clause_title,
                            verbatim_text=passage_text,
                            matched_terms=matched_terms,
                            relevance_reason=relevance_reason,
                            source_reference=src_ref,
                        ),
                    )
                )

    candidates.sort(key=lambda pair: pair[0], reverse=True)
    selected: list[RetrievedContractClause] = []
    for idx, (_, clause) in enumerate(candidates[:max_clauses], start=1):
        selected.append(clause.model_copy(update={"ref_id": f"C{idx}"}))
    return selected


def _boq_row_search_text(row: BoqRow) -> str:
    parts: list[str] = []
    if row.item_code:
        parts.append(row.item_code)
    if row.description:
        parts.append(row.description)
    for val in row.raw_values.values():
        if val:
            parts.append(val)
    return " ".join(parts)


def retrieve_boq_items(
    repo: CaseRepository,
    project_id: str,
    query_terms: list[str],
    phrases: list[str],
    max_boq_rows: int = 8,
) -> list[RetrievedBoqItem]:
    """Retrieve relevant BOQ rows for the given project without inventing missing values."""
    docs = [
        doc
        for doc in repo.list_documents(project_id=project_id)
        if doc.document_type == DocumentType.boq_excel
    ]

    candidates: list[tuple[tuple[float, int, int], RetrievedBoqItem]] = []
    query_term_set = set(query_terms)

    for doc in docs:
        record = repo.get_document_extraction(doc.id)
        if not record or not record.boq_extraction:
            continue
        for sheet in record.boq_extraction.sheets:
            for row in sheet.rows:
                # Skip section-only banner rows that have no item description/unit/pricing fields.
                if (
                    row.description is None
                    and row.unit is None
                    and row.quantity is None
                    and row.rate is None
                    and row.amount is None
                ):
                    continue

                row_text = _boq_row_search_text(row)
                row_tokens = set(_tokenize_specific(row_text))
                row_lower = row_text.lower()

                matched_terms = sorted(query_term_set & row_tokens)
                phrase_hits = [p for p in phrases if p in row_lower]

                if not matched_terms and not phrase_hits:
                    continue

                score = len(matched_terms) * 2.0 + len(phrase_hits) * 4.0
                candidates.append(
                    (
                        (score, len(matched_terms), -row.row_number),
                        RetrievedBoqItem(
                            ref_id="",
                            document_id=doc.id,
                            workbook_name=doc.filename,
                            sheet_name=row.sheet_name,
                            row_number=row.row_number,
                            item_code=row.item_code,
                            description=row.description,
                            unit=row.unit,
                            quantity=row.quantity,
                            rate=row.rate,
                            amount=row.amount,
                            matched_terms=matched_terms,
                            source_reference=row.source_reference,
                        ),
                    )
                )

    candidates.sort(key=lambda pair: pair[0], reverse=True)
    selected: list[RetrievedBoqItem] = []
    for idx, (_, item) in enumerate(candidates[:max_boq_rows], start=1):
        selected.append(item.model_copy(update={"ref_id": f"B{idx}"}))
    return selected


def retrieve_project_evidence(
    repo: CaseRepository,
    project_id: str,
    confirmed_fields: ChangeEventFields,
    max_clauses: int = 8,
    max_boq_rows: int = 8,
) -> tuple[list[RetrievedContractClause], list[RetrievedBoqItem]]:
    """Retrieve project-scoped contract clauses and BOQ rows for a confirmed event."""
    query_terms, phrases = _extract_query_terms(confirmed_fields)
    clauses = retrieve_contract_clauses(
        repo,
        project_id,
        query_terms,
        phrases,
        max_clauses=max_clauses,
    )
    boq_items = retrieve_boq_items(
        repo,
        project_id,
        query_terms,
        phrases,
        max_boq_rows=max_boq_rows,
    )
    return clauses, boq_items
