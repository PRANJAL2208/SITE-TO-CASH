"""Deterministic variation lifecycle state machine and commercial dashboard calculations."""

from datetime import date, datetime, timezone
from decimal import Decimal
import re
from typing import Optional
import uuid

from app.models.schemas import (
    CommercialAssessmentRecord,
    CommercialTracking,
    CommercialTrackingUpdateRequest,
    CurrencyCommercialSummary,
    DashboardMetricsResponse,
    LifecycleHistoryEntry,
    LifecycleTransitionRequest,
    PreliminaryAssessmentCategory,
    ReviewStatus,
    VariationCase,
    VariationLifecycleStatus,
)

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

ALLOWED_TRANSITIONS: dict[VariationLifecycleStatus, set[VariationLifecycleStatus]] = {
    VariationLifecycleStatus.detected: {
        VariationLifecycleStatus.under_review,
        VariationLifecycleStatus.rejected,
    },
    VariationLifecycleStatus.under_review: {
        VariationLifecycleStatus.drafted,
        VariationLifecycleStatus.rejected,
    },
    VariationLifecycleStatus.drafted: {
        VariationLifecycleStatus.under_review,
        VariationLifecycleStatus.submitted,
        VariationLifecycleStatus.rejected,
    },
    VariationLifecycleStatus.submitted: {
        VariationLifecycleStatus.approved,
        VariationLifecycleStatus.rejected,
        VariationLifecycleStatus.under_review,
    },
    VariationLifecycleStatus.approved: {
        VariationLifecycleStatus.executed,
        VariationLifecycleStatus.billed,
    },
    VariationLifecycleStatus.executed: {
        VariationLifecycleStatus.billed,
    },
    VariationLifecycleStatus.billed: {
        VariationLifecycleStatus.paid,
    },
    VariationLifecycleStatus.rejected: {
        VariationLifecycleStatus.under_review,
    },
    VariationLifecycleStatus.paid: set(),
}

APPROVED_OR_LATER_STATUSES: set[VariationLifecycleStatus] = {
    VariationLifecycleStatus.approved,
    VariationLifecycleStatus.executed,
    VariationLifecycleStatus.billed,
    VariationLifecycleStatus.paid,
}

BILLED_OR_PAID_STATUSES: set[VariationLifecycleStatus] = {
    VariationLifecycleStatus.billed,
    VariationLifecycleStatus.paid,
}

PRE_APPROVAL_OPEN_STATUSES: set[VariationLifecycleStatus] = {
    VariationLifecycleStatus.detected,
    VariationLifecycleStatus.under_review,
    VariationLifecycleStatus.drafted,
    VariationLifecycleStatus.submitted,
}


class LifecycleValidationError(ValueError):
    """Raised when a lifecycle transition or commercial tracking update is invalid."""


def get_allowed_transitions(
    current: VariationLifecycleStatus,
) -> list[VariationLifecycleStatus]:
    """Return allowed next lifecycle statuses in deterministic order."""
    order = list(VariationLifecycleStatus)
    allowed = ALLOWED_TRANSITIONS.get(current, set())
    return [status for status in order if status in allowed]


def _clean_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _validate_iso_date(value: Optional[str], field_name: str) -> Optional[str]:
    cleaned = _clean_optional(value)
    if cleaned is None:
        return None
    if not _ISO_DATE_RE.match(cleaned):
        raise LifecycleValidationError(
            f"{field_name} must use YYYY-MM-DD format (received '{cleaned}')."
        )
    try:
        date.fromisoformat(cleaned)
    except ValueError as exc:
        raise LifecycleValidationError(
            f"{field_name} is not a valid calendar date: '{cleaned}'."
        ) from exc
    return cleaned


def _validate_non_negative(
    value: Optional[Decimal], field_name: str
) -> Optional[Decimal]:
    if value is None:
        return None
    if value < Decimal("0"):
        raise LifecycleValidationError(f"{field_name} cannot be negative.")
    return value


def _dedupe_ids(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    cleaned: list[str] = []
    for item in values:
        stripped = item.strip()
        if stripped and stripped not in seen:
            seen.add(stripped)
            cleaned.append(stripped)
    return cleaned


def effective_variation_reference(case: VariationCase) -> str:
    """Return assigned variation reference or deterministic non-empty fallback."""
    if case.variation_reference and case.variation_reference.strip():
        return case.variation_reference.strip()
    return f"VAR-{case.id[-6:].upper()}"


def resolve_proposed_amount(case: VariationCase) -> Optional[Decimal]:
    """Return explicit claimed amount if set, otherwise deterministic estimate total."""
    if case.commercial_tracking.claimed_amount is not None:
        return case.commercial_tracking.claimed_amount
    if case.deterministic_estimate is not None:
        return case.deterministic_estimate.total_estimated_amount
    return None


def is_evidence_incomplete(
    case: VariationCase,
    assessment: Optional[CommercialAssessmentRecord],
) -> bool:
    """Return True when a non-rejected case still has missing evidence or incomplete costing."""
    if case.lifecycle_status == VariationLifecycleStatus.rejected:
        return False
    if (
        case.confirmed_extraction is None
        or case.confirmed_extraction.confirmation_status != "confirmed"
    ):
        return True
    if assessment is None:
        return True
    if assessment.ai_assessment.assessment_category in {
        PreliminaryAssessmentCategory.insufficient_evidence,
        PreliminaryAssessmentCategory.approval_or_notice_missing,
        PreliminaryAssessmentCategory.ambiguous,
    }:
        return True
    if len(assessment.ai_assessment.missing_evidence_and_information) > 0:
        return True
    estimate = case.deterministic_estimate
    if estimate is None or estimate.total_estimated_amount is None:
        return True
    if estimate.is_partial_estimate or estimate.has_unverified_inputs:
        return True
    return False


def compute_outstanding_action(
    case: VariationCase,
    assessment: Optional[CommercialAssessmentRecord],
) -> str:
    """Determine the next commercial/QS action purely from persisted case state."""
    status = case.lifecycle_status
    if status == VariationLifecycleStatus.paid:
        return "Closed — Payment recorded"
    if status == VariationLifecycleStatus.billed:
        if case.commercial_tracking.payment_date:
            return "Confirm payment receipt & move to Paid"
        return f"Follow up payment (Invoice {case.commercial_tracking.invoice_reference or 'pending'})"
    if status == VariationLifecycleStatus.executed:
        return "Issue variation invoice / running bill"
    if status == VariationLifecycleStatus.approved:
        return "Record site execution or raise variation invoice"
    if status == VariationLifecycleStatus.submitted:
        if case.commercial_tracking.submission_reference:
            return f"Await client approval (Ref: {case.commercial_tracking.submission_reference})"
        return "Await client approval / response"
    if status == VariationLifecycleStatus.rejected:
        return "Closed — Rejected (reopen to Under Review if appealed)"
    if status == VariationLifecycleStatus.drafted:
        if not case.latest_report_id:
            return "Generate draft evidence pack PDF, then submit to client"
        return "Review draft pack & record formal client submission"
    if case.confirmed_extraction is None or case.confirmed_extraction.confirmation_status != "confirmed":
        return "Confirm extracted site instruction fields"
    if assessment is None:
        return "Run contract & BOQ commercial assessment"
    if (
        case.deterministic_estimate is None
        or case.deterministic_estimate.total_estimated_amount is None
        or case.deterministic_estimate.is_partial_estimate
    ):
        return "Complete deterministic cost build-up (rates/quantities)"
    if case.qs_decision.review_status in {
        ReviewStatus.pending_review,
        ReviewStatus.needs_more_info,
    }:
        return "Complete QS commercial decision"
    return "Advance to Drafted & generate evidence pack"


def _merge_tracking(
    existing: CommercialTracking,
    payload: LifecycleTransitionRequest | CommercialTrackingUpdateRequest,
    responsible_person: str,
) -> CommercialTracking:
    return CommercialTracking(
        project_name=(
            _clean_optional(payload.project_name)
            if payload.project_name is not None
            else existing.project_name
        ),
        subcontractor_name=(
            _clean_optional(payload.subcontractor_name)
            if payload.subcontractor_name is not None
            else existing.subcontractor_name
        ),
        responsible_person=responsible_person,
        submission_reference=(
            _clean_optional(payload.submission_reference)
            if payload.submission_reference is not None
            else existing.submission_reference
        ),
        submission_date=(
            _validate_iso_date(payload.submission_date, "submission_date")
            if payload.submission_date is not None
            else existing.submission_date
        ),
        recipient=(
            _clean_optional(payload.recipient)
            if payload.recipient is not None
            else existing.recipient
        ),
        claimed_amount=(
            _validate_non_negative(payload.claimed_amount, "claimed_amount")
            if payload.claimed_amount is not None
            else existing.claimed_amount
        ),
        approved_amount=(
            _validate_non_negative(payload.approved_amount, "approved_amount")
            if payload.approved_amount is not None
            else existing.approved_amount
        ),
        billed_amount=(
            _validate_non_negative(payload.billed_amount, "billed_amount")
            if payload.billed_amount is not None
            else existing.billed_amount
        ),
        paid_amount=(
            _validate_non_negative(payload.paid_amount, "paid_amount")
            if payload.paid_amount is not None
            else existing.paid_amount
        ),
        execution_status=(
            _clean_optional(payload.execution_status)
            if payload.execution_status is not None
            else existing.execution_status
        ),
        invoice_reference=(
            _clean_optional(payload.invoice_reference)
            if payload.invoice_reference is not None
            else existing.invoice_reference
        ),
        payment_status=(
            _clean_optional(payload.payment_status)
            if payload.payment_status is not None
            else existing.payment_status
        ),
        payment_date=(
            _validate_iso_date(payload.payment_date, "payment_date")
            if payload.payment_date is not None
            else existing.payment_date
        ),
        notes=(
            _clean_optional(payload.notes)
            if payload.notes is not None
            else existing.notes
        ),
        supporting_document_ids=(
            _dedupe_ids(payload.supporting_document_ids)
            if payload.supporting_document_ids is not None
            else list(existing.supporting_document_ids)
        ),
    )


def apply_lifecycle_transition(
    case: VariationCase,
    payload: LifecycleTransitionRequest,
    now: Optional[datetime] = None,
) -> tuple[VariationCase, LifecycleHistoryEntry]:
    """Validate and apply an explicit human lifecycle status transition."""
    responsible = _clean_optional(payload.responsible_person)
    if not responsible:
        raise LifecycleValidationError(
            "responsible_person is required to update lifecycle status."
        )

    current = case.lifecycle_status
    target = payload.target_status
    if target == current:
        raise LifecycleValidationError(
            f"Variation is already in status '{current.value}'. Use tracking update to modify metadata without changing status."
        )

    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if target not in allowed:
        allowed_labels = ", ".join(s.value for s in get_allowed_transitions(current)) or "none (terminal state)"
        raise LifecycleValidationError(
            f"Invalid lifecycle transition from '{current.value}' to '{target.value}'. Allowed transitions: {allowed_labels}."
        )

    if payload.approved_amount is not None and target not in APPROVED_OR_LATER_STATUSES:
        raise LifecycleValidationError(
            "approved_amount can only be recorded when transitioning to or past 'approved'."
        )
    if payload.billed_amount is not None and target not in BILLED_OR_PAID_STATUSES:
        raise LifecycleValidationError(
            "billed_amount can only be recorded when transitioning to 'billed' or 'paid'."
        )
    if payload.paid_amount is not None and target != VariationLifecycleStatus.paid:
        raise LifecycleValidationError(
            "paid_amount can only be recorded when transitioning to 'paid'."
        )

    clean_reason = _clean_optional(payload.reason)
    merged_tracking = _merge_tracking(case.commercial_tracking, payload, responsible)

    if target == VariationLifecycleStatus.submitted:
        if not merged_tracking.submission_reference or not merged_tracking.submission_date:
            raise LifecycleValidationError(
                "Transition to 'submitted' requires both submission_reference and submission_date (YYYY-MM-DD)."
            )

    if target == VariationLifecycleStatus.rejected and not clean_reason:
        raise LifecycleValidationError(
            "Transition to 'rejected' requires a written reason."
        )

    if target == VariationLifecycleStatus.billed and not merged_tracking.invoice_reference:
        raise LifecycleValidationError(
            "Transition to 'billed' requires an invoice_reference (running-bill or invoice number)."
        )

    if target == VariationLifecycleStatus.paid and not merged_tracking.payment_date:
        raise LifecycleValidationError(
            "Transition to 'paid' requires a payment_date (YYYY-MM-DD)."
        )

    timestamp = now or datetime.now(timezone.utc)
    updated_ref = (
        _clean_optional(payload.variation_reference)
        if payload.variation_reference is not None
        else case.variation_reference
    )

    updated_case = case.model_copy(
        update={
            "variation_reference": updated_ref,
            "lifecycle_status": target,
            "commercial_tracking": merged_tracking,
            "updated_at": timestamp,
        }
    )

    history_entry = LifecycleHistoryEntry(
        id=f"lhist-{uuid.uuid4().hex[:12]}",
        project_id=case.project_id,
        case_id=case.id,
        from_status=current,
        to_status=target,
        changed_by=responsible,
        changed_at=timestamp,
        reason=clean_reason,
        notes=merged_tracking.notes,
        tracking_snapshot=merged_tracking.model_dump(mode="json"),
    )
    return updated_case, history_entry


def apply_tracking_update(
    case: VariationCase,
    payload: CommercialTrackingUpdateRequest,
    now: Optional[datetime] = None,
) -> VariationCase:
    """Update commercial tracking metadata without altering lifecycle_status."""
    updater = _clean_optional(payload.updated_by)
    if not updater:
        raise LifecycleValidationError(
            "updated_by is required to update commercial tracking details."
        )

    status = case.lifecycle_status
    if payload.approved_amount is not None and status not in APPROVED_OR_LATER_STATUSES:
        raise LifecycleValidationError(
            f"Cannot record approved_amount while variation status is '{status.value}'."
        )
    if (
        payload.execution_status is not None
        and status not in APPROVED_OR_LATER_STATUSES
    ):
        raise LifecycleValidationError(
            f"Cannot record execution_status while variation status is '{status.value}'."
        )
    if (
        payload.billed_amount is not None or payload.invoice_reference is not None
    ) and status not in BILLED_OR_PAID_STATUSES:
        raise LifecycleValidationError(
            f"Cannot record invoice/billed details while variation status is '{status.value}'."
        )
    if (
        payload.paid_amount is not None
        or payload.payment_status is not None
        or payload.payment_date is not None
    ) and status != VariationLifecycleStatus.paid:
        raise LifecycleValidationError(
            f"Cannot record payment details while variation status is '{status.value}'."
        )

    responsible = _clean_optional(payload.responsible_person) or case.commercial_tracking.responsible_person or updater
    merged_tracking = _merge_tracking(case.commercial_tracking, payload, responsible)
    updated_ref = (
        _clean_optional(payload.variation_reference)
        if payload.variation_reference is not None
        else case.variation_reference
    )
    timestamp = now or datetime.now(timezone.utc)
    return case.model_copy(
        update={
            "variation_reference": updated_ref,
            "commercial_tracking": merged_tracking,
            "updated_at": timestamp,
        }
    )


def compute_dashboard_metrics(
    cases: list[VariationCase],
    assessments_by_case: dict[str, CommercialAssessmentRecord],
    project_id: Optional[str] = None,
) -> DashboardMetricsResponse:
    """Compute commercial register metrics purely from persisted case data using Decimal."""
    status_counts = {status.value: 0 for status in VariationLifecycleStatus}
    awaiting_qs_review = 0
    drafted_not_submitted = 0
    submitted_awaiting_response = 0
    approved_not_billed = 0
    billed_unpaid = 0
    incomplete_evidence = 0
    demo_count = 0

    currency_buckets: dict[str, dict[str, Decimal | int]] = {}

    def _bucket_for(currency_code: str) -> dict[str, Decimal | int]:
        if currency_code not in currency_buckets:
            currency_buckets[currency_code] = {
                "potential_variation_value": Decimal("0.00"),
                "proposed_total": Decimal("0.00"),
                "approved_total": Decimal("0.00"),
                "approved_unbilled_total": Decimal("0.00"),
                "billed_total": Decimal("0.00"),
                "billed_unpaid_total": Decimal("0.00"),
                "paid_total": Decimal("0.00"),
                "proposed_case_count": 0,
                "approved_case_count": 0,
                "billed_case_count": 0,
                "paid_case_count": 0,
                "unpriced_case_count": 0,
            }
        return currency_buckets[currency_code]

    for case in cases:
        status = case.lifecycle_status
        status_counts[status.value] = status_counts.get(status.value, 0) + 1
        if case.is_demo:
            demo_count += 1

        if status in {
            VariationLifecycleStatus.detected,
            VariationLifecycleStatus.under_review,
        } or (
            status == VariationLifecycleStatus.drafted
            and case.qs_decision.review_status
            in {ReviewStatus.pending_review, ReviewStatus.needs_more_info}
        ):
            awaiting_qs_review += 1
        if status == VariationLifecycleStatus.drafted:
            drafted_not_submitted += 1
        elif status == VariationLifecycleStatus.submitted:
            submitted_awaiting_response += 1
        elif status in {
            VariationLifecycleStatus.approved,
            VariationLifecycleStatus.executed,
        }:
            approved_not_billed += 1
        elif status == VariationLifecycleStatus.billed:
            billed_unpaid += 1

        assessment = assessments_by_case.get(case.id)
        if is_evidence_incomplete(case, assessment):
            incomplete_evidence += 1

        raw_currency = (
            case.deterministic_estimate.currency.strip().upper()
            if case.deterministic_estimate and case.deterministic_estimate.currency
            else "UNSPECIFIED"
        )
        bucket = _bucket_for(raw_currency)

        proposed = resolve_proposed_amount(case)
        approved = (
            case.commercial_tracking.approved_amount
            if status in APPROVED_OR_LATER_STATUSES
            else None
        )

        if (
            proposed is None
            and approved is None
            and status != VariationLifecycleStatus.rejected
        ):
            bucket["unpriced_case_count"] = int(bucket["unpriced_case_count"]) + 1

        if proposed is not None and status != VariationLifecycleStatus.rejected:
            bucket["proposed_total"] = Decimal(bucket["proposed_total"]) + proposed
            bucket["proposed_case_count"] = int(bucket["proposed_case_count"]) + 1
            if status in PRE_APPROVAL_OPEN_STATUSES:
                bucket["potential_variation_value"] = (
                    Decimal(bucket["potential_variation_value"]) + proposed
                )

        if approved is not None:
            bucket["approved_total"] = Decimal(bucket["approved_total"]) + approved
            bucket["approved_case_count"] = int(bucket["approved_case_count"]) + 1
            if status in {
                VariationLifecycleStatus.approved,
                VariationLifecycleStatus.executed,
            }:
                bucket["approved_unbilled_total"] = (
                    Decimal(bucket["approved_unbilled_total"]) + approved
                )

        if status in BILLED_OR_PAID_STATUSES:
            billed = (
                case.commercial_tracking.billed_amount
                if case.commercial_tracking.billed_amount is not None
                else approved
            )
            if billed is not None:
                bucket["billed_total"] = Decimal(bucket["billed_total"]) + billed
                bucket["billed_case_count"] = int(bucket["billed_case_count"]) + 1
                if status == VariationLifecycleStatus.billed:
                    bucket["billed_unpaid_total"] = (
                        Decimal(bucket["billed_unpaid_total"]) + billed
                    )

        if status == VariationLifecycleStatus.paid:
            paid = (
                case.commercial_tracking.paid_amount
                if case.commercial_tracking.paid_amount is not None
                else (
                    case.commercial_tracking.billed_amount
                    if case.commercial_tracking.billed_amount is not None
                    else approved
                )
            )
            if paid is not None:
                bucket["paid_total"] = Decimal(bucket["paid_total"]) + paid
                bucket["paid_case_count"] = int(bucket["paid_case_count"]) + 1

    summaries = [
        CurrencyCommercialSummary(
            currency=code,
            potential_variation_value=Decimal(vals["potential_variation_value"]),
            proposed_total=Decimal(vals["proposed_total"]),
            approved_total=Decimal(vals["approved_total"]),
            approved_unbilled_total=Decimal(vals["approved_unbilled_total"]),
            billed_total=Decimal(vals["billed_total"]),
            billed_unpaid_total=Decimal(vals["billed_unpaid_total"]),
            paid_total=Decimal(vals["paid_total"]),
            proposed_case_count=int(vals["proposed_case_count"]),
            approved_case_count=int(vals["approved_case_count"]),
            billed_case_count=int(vals["billed_case_count"]),
            paid_case_count=int(vals["paid_case_count"]),
            unpriced_case_count=int(vals["unpriced_case_count"]),
        )
        for code, vals in sorted(currency_buckets.items())
    ]

    total_cases = len(cases)
    contains_demo = demo_count > 0
    return DashboardMetricsResponse(
        project_id=project_id,
        total_cases=total_cases,
        live_case_count=total_cases - demo_count,
        demo_case_count=demo_count,
        contains_demo_data=contains_demo,
        demo_label=(
            "DEMO DATA — INCLUDES SYNTHETIC SAMPLE RECORDS" if contains_demo else None
        ),
        status_counts=status_counts,
        awaiting_qs_review_count=awaiting_qs_review,
        drafted_not_submitted_count=drafted_not_submitted,
        submitted_awaiting_response_count=submitted_awaiting_response,
        approved_not_billed_count=approved_not_billed,
        billed_unpaid_count=billed_unpaid,
        incomplete_evidence_count=incomplete_evidence,
        amounts_by_currency=summaries,
    )
