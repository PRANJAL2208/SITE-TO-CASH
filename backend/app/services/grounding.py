"""Deterministic source-grounding validation and commercial guardrail checks (Phase 7)."""

import re
from typing import Optional

from app.models.schemas import (
    CitedFinding,
    CommercialAssessmentRecord,
    DocumentType,
    GroundingValidationResult,
    PreliminaryCommercialAssessment,
    SourceReference,
    VariationCase,
)
from app.storage.base import CaseRepository

_PDF_LOCATION_RE = re.compile(r"^Page\s+(\d+)(?:\s*,\s*Clause\s+.+)?$", re.IGNORECASE)
_BOQ_LOCATION_RE = re.compile(r"^Sheet\s+'(.+)'\s*,\s*Row\s+(\d+)$", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"\s+")

_FORBIDDEN_CLAIM_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\bcontractually\s+approved\b", re.IGNORECASE),
        "AI output asserted that a variation is 'contractually approved'. Only human QS/client actions approve variations.",
    ),
    (
        re.compile(r"\bvariation\s+is\s+approved\b", re.IGNORECASE),
        "AI output stated 'variation is approved'. AI cannot approve variations.",
    ),
    (
        re.compile(r"\bapproved\s+variation\b", re.IGNORECASE),
        "AI output referred to an unconfirmed case as an 'approved variation'.",
    ),
    (
        re.compile(r"\bapproved\s+for\s+payment\b", re.IGNORECASE),
        "AI output asserted work is 'approved for payment'.",
    ),
    (
        re.compile(r"\blegally\s+payable\b", re.IGNORECASE),
        "AI output asserted that a claim is 'legally payable'.",
    ),
    (
        re.compile(r"\bguaranteed\s+(?:to\s+be\s+)?recoverable\b", re.IGNORECASE),
        "AI output asserted recovery is 'guaranteed'.",
    ),
    (
        re.compile(r"\bguaranteed\s+payment\b", re.IGNORECASE),
        "AI output asserted 'guaranteed payment'.",
    ),
    (
        re.compile(r"\bentitlement\s+is\s+(?:confirmed|established)\b", re.IGNORECASE),
        "AI output asserted that contractual entitlement is confirmed/established.",
    ),
    (
        re.compile(r"\bautomatically\s+approved\b", re.IGNORECASE),
        "AI output asserted automatic variation approval.",
    ),
]

_NEGATION_WINDOW_RE = re.compile(
    r"(?:\b(?:not|no|never|cannot|can't|does\s+not|doesn't|do\s+not|is\s+not|isn't|without|nor|neither|unapproved)\s+(?:\w+\s+){0,2})$",
    re.IGNORECASE,
)


class GroundingValidationError(ValueError):
    """Raised when source citations or BOQ/contract references fail verification."""


def _norm_ws(text: Optional[str]) -> str:
    if not text:
        return ""
    return _WHITESPACE_RE.sub(" ", text).strip().lower()


def _strip_ellipsis(text: str) -> str:
    return text[:-3].strip() if text.endswith("...") else text


def validate_source_reference(
    repo: CaseRepository,
    expected_project_id: str,
    ref: SourceReference,
) -> list[str]:
    """Independently verify a SourceReference against stored project documents and extractions."""
    errors: list[str] = []
    doc = repo.get_document(ref.document_id)
    if doc is None:
        return [
            f"Referenced document '{ref.document_id}' ({ref.document_name}) was not found."
        ]

    if doc.project_id != expected_project_id:
        return [
            f"Cross-project source reference rejected: document '{ref.document_id}' "
            f"belongs to project '{doc.project_id}', not '{expected_project_id}'."
        ]

    if doc.document_type != ref.document_type:
        errors.append(
            f"Document '{ref.document_id}' type mismatch: expected '{doc.document_type.value}', got '{ref.document_type.value}'."
        )
    if doc.filename != ref.document_name:
        errors.append(
            f"Document '{ref.document_id}' filename mismatch: stored '{doc.filename}', cited '{ref.document_name}'."
        )

    extraction = repo.get_document_extraction(doc.id)
    if extraction is None:
        errors.append(
            f"Stored extraction payload missing for document '{ref.document_id}'."
        )
        return errors

    excerpt_norm = _strip_ellipsis(_norm_ws(ref.excerpt))

    if doc.document_type == DocumentType.contract_pdf:
        if extraction.contract_extraction is None:
            errors.append(f"Document '{doc.id}' has no contract PDF extraction.")
            return errors
        match = _PDF_LOCATION_RE.match(ref.location.strip())
        if not match:
            errors.append(
                f"Invalid contract PDF location format '{ref.location}' for document '{doc.id}'."
            )
            return errors
        page_num = int(match.group(1))
        if page_num < 1 or page_num > extraction.contract_extraction.page_count:
            errors.append(
                f"Contract PDF '{doc.filename}' does not have Page {page_num} "
                f"(page count: {extraction.contract_extraction.page_count})."
            )
            return errors

        page = next(
            (p for p in extraction.contract_extraction.pages if p.page_number == page_num),
            None,
        )
        if page is None or not page.is_readable:
            errors.append(
                f"Contract PDF '{doc.filename}' Page {page_num} has no readable text."
            )
            return errors

        page_norm = _norm_ws(page.text)
        if not excerpt_norm or excerpt_norm not in page_norm:
            errors.append(
                f"Quoted excerpt does not match stored text on Page {page_num} of '{doc.filename}'."
            )
        return errors

    if doc.document_type == DocumentType.boq_excel:
        if extraction.boq_extraction is None:
            errors.append(f"Document '{doc.id}' has no BOQ Excel extraction.")
            return errors
        match = _BOQ_LOCATION_RE.match(ref.location.strip())
        if not match:
            errors.append(
                f"Invalid BOQ location format '{ref.location}' for document '{doc.id}'."
            )
            return errors
        sheet_name = match.group(1)
        row_num = int(match.group(2))

        sheet = next(
            (s for s in extraction.boq_extraction.sheets if s.sheet_name == sheet_name),
            None,
        )
        if sheet is None:
            errors.append(
                f"BOQ workbook '{doc.filename}' does not contain sheet '{sheet_name}'."
            )
            return errors

        row = next((r for r in sheet.rows if r.row_number == row_num), None)
        if row is None:
            errors.append(
                f"BOQ workbook '{doc.filename}' sheet '{sheet_name}' does not contain extracted Row {row_num}."
            )
            return errors

        stored_excerpt_norm = _norm_ws(row.source_reference.excerpt)
        raw_vals_norm = _norm_ws(
            " ".join(v for v in row.raw_values.values() if v is not None)
        )
        if stored_excerpt_norm:
            if not excerpt_norm or (
                excerpt_norm not in stored_excerpt_norm
                and excerpt_norm not in raw_vals_norm
            ):
                errors.append(
                    f"Quoted excerpt does not match stored BOQ row at Sheet '{sheet_name}', Row {row_num} of '{doc.filename}'."
                )
        return errors

    errors.append(
        f"Source references cannot be verified against unsupported document type '{doc.document_type.value}'."
    )
    return errors


def validate_instruction_evidence_references(case: VariationCase) -> list[str]:
    """Validate that instruction extraction evidence references match stored input/attachments."""
    issues: list[str] = []
    if case.ai_extraction is None:
        return issues

    raw_text_norm = _norm_ws(
        case.original_input.raw_text if case.original_input else case.instruction_text
    )
    attachment_id = (
        case.original_input.attachment_id if case.original_input else None
    )

    for ref in case.ai_extraction.evidence_references:
        if ref.source_id not in {case.id, attachment_id}:
            issues.append(
                f"Instruction evidence ref points to unexpected source_id '{ref.source_id}'."
            )
            continue
        if ref.source_id == case.id and "verbatim match" in ref.location.lower():
            excerpt_norm = _norm_ws(ref.excerpt)
            if not excerpt_norm or excerpt_norm not in raw_text_norm:
                issues.append(
                    f"Verbatim instruction quote not found in stored original instruction text: '{ref.excerpt[:60]}'."
                )
        elif "verify against original" in ref.location.lower():
            issues.append(
                f"Unverified instruction excerpt requires human inspection: '{ref.excerpt[:60]}'."
            )
    return issues


def detect_unsupported_commercial_claims(
    assessment: PreliminaryCommercialAssessment,
) -> list[str]:
    """Flag forbidden AI statements asserting contractual approval, legal payability, or guaranteed recovery."""
    texts: list[str] = [
        assessment.scope_comparison,
        assessment.ai_interpretation_summary,
    ]
    for lst in (
        assessment.documented_facts,
        assessment.explicit_inclusions,
        assessment.explicit_exclusions,
        assessment.potential_scope_overlap,
        assessment.written_approval_requirements,
        assessment.issuer_authority_requirements,
        assessment.notice_requirements_and_deadlines,
        assessment.conflicting_or_ambiguous_evidence,
    ):
        for finding in lst:
            texts.append(finding.statement)

    warnings: list[str] = []
    seen: set[str] = set()
    for text in texts:
        if not text:
            continue
        for pattern, warning_msg in _FORBIDDEN_CLAIM_PATTERNS:
            for match in pattern.finditer(text):
                prefix = text[max(0, match.start() - 40) : match.start()]
                if _NEGATION_WINDOW_RE.search(prefix):
                    continue
                if warning_msg not in seen:
                    seen.add(warning_msg)
                    warnings.append(warning_msg)
    return warnings


def validate_assessment_grounding(
    repo: CaseRepository,
    expected_project_id: str,
    record: CommercialAssessmentRecord,
) -> GroundingValidationResult:
    """Validate all citations in a CommercialAssessmentRecord against stored project documents."""
    errors: list[str] = []
    warnings: list[str] = []
    checked = 0
    verified = 0
    unsupported = 0

    if record.project_id != expected_project_id:
        errors.append(
            f"Assessment project_id '{record.project_id}' does not match '{expected_project_id}'."
        )

    valid_ref_map: dict[str, SourceReference] = {}

    for clause in record.retrieved_contract_clauses:
        checked += 1
        ref_errs = validate_source_reference(
            repo, expected_project_id, clause.source_reference
        )
        if clause.document_id != clause.source_reference.document_id:
            ref_errs.append(
                f"Clause {clause.ref_id} document_id '{clause.document_id}' mismatches source_reference."
            )
        if not ref_errs:
            extraction = repo.get_document_extraction(clause.document_id)
            if extraction and extraction.contract_extraction:
                page = next(
                    (
                        p
                        for p in extraction.contract_extraction.pages
                        if p.page_number == clause.page_number
                    ),
                    None,
                )
                if page is None or _norm_ws(clause.verbatim_text) not in _norm_ws(
                    page.text
                ):
                    ref_errs.append(
                        f"Clause {clause.ref_id} verbatim_text not found on Page {clause.page_number}."
                    )
        if ref_errs:
            errors.extend(ref_errs)
        else:
            verified += 1
            valid_ref_map[clause.ref_id] = clause.source_reference

    for item in record.retrieved_boq_items:
        checked += 1
        ref_errs = validate_source_reference(
            repo, expected_project_id, item.source_reference
        )
        if item.document_id != item.source_reference.document_id:
            ref_errs.append(
                f"BOQ item {item.ref_id} document_id '{item.document_id}' mismatches source_reference."
            )
        if ref_errs:
            errors.extend(ref_errs)
        else:
            verified += 1
            valid_ref_map[item.ref_id] = item.source_reference

    for ref in record.retrieved_source_references:
        checked += 1
        ref_errs = validate_source_reference(repo, expected_project_id, ref)
        if ref_errs:
            errors.extend(ref_errs)
        else:
            verified += 1

    ai_assess = record.ai_assessment
    required_lists: tuple[list[CitedFinding], ...] = (
        ai_assess.documented_facts,
        ai_assess.explicit_inclusions,
        ai_assess.explicit_exclusions,
        ai_assess.written_approval_requirements,
        ai_assess.issuer_authority_requirements,
        ai_assess.notice_requirements_and_deadlines,
    )
    optional_lists: tuple[list[CitedFinding], ...] = (
        ai_assess.potential_scope_overlap,
        ai_assess.conflicting_or_ambiguous_evidence,
    )

    for finding_list, require_non_empty in [
        *[(lst, True) for lst in required_lists],
        *[(lst, False) for lst in optional_lists],
    ]:
        for finding in finding_list:
            if not finding.source_references:
                finding.grounding_status = "unsupported"
                finding.grounding_note = (
                    "Unsupported AI claim: no verified contract clause or BOQ source reference."
                )
                unsupported += 1
                msg = f"Unsupported AI finding (no citation): '{finding.statement[:80]}'"
                if require_non_empty:
                    errors.append(msg)
                else:
                    warnings.append(msg)
                continue

            finding_errs: list[str] = []
            for idx, ref in enumerate(finding.source_references):
                checked += 1
                ref_errs = validate_source_reference(repo, expected_project_id, ref)
                if idx < len(finding.source_ref_ids):
                    rid = finding.source_ref_ids[idx]
                    expected_ref = valid_ref_map.get(rid)
                    if expected_ref is None or expected_ref != ref:
                        ref_errs.append(
                            f"Finding ref '{rid}' does not match retrieved evidence."
                        )
                if ref_errs:
                    finding_errs.extend(ref_errs)
                else:
                    verified += 1

            if finding_errs:
                finding.grounding_status = "unverified"
                finding.grounding_note = "; ".join(finding_errs)
                errors.extend(finding_errs)
            else:
                finding.grounding_status = "verified"
                finding.grounding_note = None

    claim_warnings = detect_unsupported_commercial_claims(ai_assess)
    for w in claim_warnings:
        if w not in ai_assess.guardrail_warnings:
            ai_assess.guardrail_warnings.append(w)
        if w not in warnings:
            warnings.append(w)

    return GroundingValidationResult(
        is_valid=len(errors) == 0,
        checked_reference_count=checked,
        verified_reference_count=verified,
        unsupported_claim_count=unsupported,
        errors=errors,
        warnings=warnings,
    )
