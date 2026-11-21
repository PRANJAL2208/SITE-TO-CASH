"""Deterministic commercial cost calculation service using pure-Python Decimal math."""

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
import re
from typing import Optional, Sequence, Union

from app.models.schemas import (
    CostLineItem,
    CostLineItemInput,
    CostLineType,
    CostVerificationStatus,
    DeterministicEstimate,
    RoundingMode,
    ValueSource,
)

SUPPORTED_UNITS = {
    "m",
    "m2",
    "m3",
    "mm",
    "km",
    "nr",
    "no",
    "ea",
    "item",
    "ls",
    "lump sum",
    "kg",
    "t",
    "ton",
    "tonne",
    "hr",
    "hrs",
    "hour",
    "hours",
    "day",
    "days",
    "wk",
    "week",
    "weeks",
    "set",
    "pair",
    "lot",
    "pct",
    "%",
}

_CURRENCY_CODE_RE = re.compile(r"^[A-Z]{3}$")


class CostValidationError(ValueError):
    """Raised when financial calculation inputs fail deterministic validation."""


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _validate_currency(currency: Optional[str]) -> Optional[str]:
    cleaned = _normalize_optional_str(currency)
    if cleaned is None:
        return None
    upper = cleaned.upper()
    if not _CURRENCY_CODE_RE.match(upper):
        raise CostValidationError(
            f"Invalid currency code '{currency}'. Expected a 3-letter ISO code such as USD, GBP, EUR, or AED."
        )
    return upper


def _validate_unit(unit: Optional[str]) -> Optional[str]:
    cleaned = _normalize_optional_str(unit)
    if cleaned is None:
        return None
    if cleaned.lower() not in SUPPORTED_UNITS:
        raise CostValidationError(
            f"Unsupported unit '{cleaned}'. Supported units include m, m2, m3, mm, nr, ea, item, ls, kg, t, hr, day, wk, set, lot."
        )
    return cleaned


def _quantizer(decimal_places: int) -> Decimal:
    if not isinstance(decimal_places, int) or isinstance(decimal_places, bool):
        raise CostValidationError("decimal_places must be an integer between 0 and 4.")
    if decimal_places < 0 or decimal_places > 4:
        raise CostValidationError("decimal_places must be between 0 and 4.")
    if decimal_places == 0:
        return Decimal("1")
    return Decimal("0." + "0" * (decimal_places - 1) + "1")


def _decimal_rounding(mode: RoundingMode) -> str:
    return ROUND_HALF_EVEN if mode == RoundingMode.half_even else ROUND_HALF_UP


def calculate_deterministic_estimate(
    line_items: Sequence[Union[CostLineItemInput, CostLineItem]],
    *,
    currency: Optional[str] = None,
    decimal_places: int = 2,
    rounding_mode: RoundingMode = RoundingMode.half_up,
    tax_rate_percent: Optional[Decimal] = None,
) -> DeterministicEstimate:
    """Compute exact line amounts, subtotals, and optional tax using Decimal arithmetic.

    Never uses binary floats, never invents missing quantities/rates/tax/currency,
    and never substitutes missing values with zero.
    """
    normalized_currency = _validate_currency(currency)
    quant = _quantizer(decimal_places)
    rounding_const = _decimal_rounding(rounding_mode)

    if tax_rate_percent is not None:
        if not isinstance(tax_rate_percent, Decimal) or not tax_rate_percent.is_finite():
            raise CostValidationError("tax_rate_percent must be a finite Decimal.")
        if tax_rate_percent < Decimal("0") or tax_rate_percent > Decimal("100"):
            raise CostValidationError(
                "tax_rate_percent must be between 0 and 100 inclusive."
            )

    computed_lines: list[CostLineItem] = []
    missing_inputs: list[str] = []
    calculation_notes: list[str] = []

    additions_acc = Decimal("0")
    deductions_acc = Decimal("0")
    calculable_count = 0
    incomplete_count = 0
    has_unverified = False

    for idx, item in enumerate(line_items, start=1):
        desc = _normalize_optional_str(item.description)
        if not desc:
            raise CostValidationError(
                f"Cost line {idx} must include a non-empty description."
            )

        unit = _validate_unit(item.unit)
        line_id = _normalize_optional_str(item.id) or f"line-{idx}"

        qty = item.quantity
        if qty is not None:
            if not isinstance(qty, Decimal) or not qty.is_finite():
                raise CostValidationError(f"Line '{desc}': quantity must be a finite Decimal.")
            if qty <= Decimal("0"):
                raise CostValidationError(
                    f"Line '{desc}': quantity must be greater than zero (use line_type='deduction' for deductions)."
                )

        rate = item.rate
        if rate is not None:
            if not isinstance(rate, Decimal) or not rate.is_finite():
                raise CostValidationError(f"Line '{desc}': unit rate must be a finite Decimal.")
            if rate < Decimal("0"):
                raise CostValidationError(
                    f"Line '{desc}': unit rate cannot be negative."
                )

        line_missing: list[str] = []
        qty_source = item.quantity_source
        rate_source = item.rate_source

        if qty is None:
            line_missing.append("quantity")
            qty_source = ValueSource.missing
        elif qty_source == ValueSource.missing:
            qty_source = ValueSource.qs_entered

        if rate is None:
            line_missing.append("rate")
            rate_source = ValueSource.missing
        elif rate_source == ValueSource.missing:
            rate_source = ValueSource.qs_proposed

        if unit is None:
            line_missing.append("unit")

        if qty is None or rate is None:
            amount: Optional[Decimal] = None
            verification_status = CostVerificationStatus.missing_data
            incomplete_count += 1
            missing_inputs.append(
                f"Line '{desc}': missing {', '.join(line_missing)} — excluded from totals (not substituted with zero)."
            )
        else:
            raw_magnitude = (qty * rate).quantize(quant, rounding=rounding_const)
            if item.line_type == CostLineType.deduction:
                amount = -raw_magnitude
                deductions_acc += raw_magnitude
            else:
                amount = raw_magnitude
                additions_acc += raw_magnitude
            calculable_count += 1
            verification_status = (
                CostVerificationStatus.unverified
                if item.verification_status == CostVerificationStatus.missing_data
                else item.verification_status
            )
            if verification_status != CostVerificationStatus.verified:
                has_unverified = True
            if unit is None:
                missing_inputs.append(f"Line '{desc}': unit is unspecified.")

        computed_lines.append(
            CostLineItem(
                id=line_id,
                description=desc,
                category=item.category,
                line_type=item.line_type,
                unit=unit,
                quantity=qty,
                rate=rate,
                amount=amount,
                quantity_source=qty_source,
                quantity_source_note=_normalize_optional_str(item.quantity_source_note),
                rate_source=rate_source,
                rate_basis_note=_normalize_optional_str(item.rate_basis_note),
                verification_status=verification_status,
                boq_reference=item.boq_reference,
                original_boq_item_code=_normalize_optional_str(item.original_boq_item_code),
                original_boq_unit=_normalize_optional_str(item.original_boq_unit),
                original_boq_quantity=item.original_boq_quantity,
                original_boq_rate=item.original_boq_rate,
                missing_fields=line_missing,
                note=_normalize_optional_str(item.note),
            )
        )

    if calculable_count == 0:
        additions_subtotal: Optional[Decimal] = None
        deductions_subtotal: Optional[Decimal] = None
        subtotal: Optional[Decimal] = None
        tax_amount: Optional[Decimal] = None
        total_estimated_amount: Optional[Decimal] = None
        if computed_lines:
            calculation_notes.append(
                "No line items have both quantity and unit rate; totals cannot be calculated."
            )
    else:
        additions_subtotal = additions_acc.quantize(quant, rounding=rounding_const)
        deductions_subtotal = deductions_acc.quantize(quant, rounding=rounding_const)
        subtotal = (additions_subtotal - deductions_subtotal).quantize(
            quant, rounding=rounding_const
        )
        if tax_rate_percent is not None:
            tax_amount = (
                subtotal * tax_rate_percent / Decimal("100")
            ).quantize(quant, rounding=rounding_const)
            total_estimated_amount = (subtotal + tax_amount).quantize(
                quant, rounding=rounding_const
            )
            calculation_notes.append(
                f"Applied explicitly supplied tax rate of {tax_rate_percent}%."
            )
        else:
            tax_amount = None
            total_estimated_amount = subtotal
            calculation_notes.append(
                "No tax applied (tax rate not explicitly supplied)."
            )

    is_partial_estimate = incomplete_count > 0
    if normalized_currency is None and computed_lines:
        missing_inputs.append("Currency is not specified.")
        calculation_notes.append("Currency not specified; figures are unlabelled.")
    if is_partial_estimate:
        calculation_notes.append(
            f"Partial estimate: {incomplete_count} line item(s) missing quantity or rate are excluded from totals."
        )
    if has_unverified:
        calculation_notes.append(
            "Estimate contains unverified or QS-proposed values requiring sign-off."
        )

    return DeterministicEstimate(
        currency=normalized_currency,
        decimal_places=decimal_places,
        rounding_mode=rounding_mode,
        line_items=computed_lines,
        additions_subtotal=additions_subtotal,
        deductions_subtotal=deductions_subtotal,
        subtotal=subtotal,
        tax_rate_percent=tax_rate_percent,
        tax_amount=tax_amount,
        total_estimated_amount=total_estimated_amount,
        calculable_line_count=calculable_count,
        incomplete_line_count=incomplete_count,
        is_partial_estimate=is_partial_estimate,
        has_unverified_inputs=has_unverified,
        missing_inputs=missing_inputs,
        calculation_notes=calculation_notes,
        calculated_at=datetime.now(timezone.utc),
    )
