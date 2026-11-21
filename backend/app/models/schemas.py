"""Domain schemas enforcing source attribution and AI-vs-human separation."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


class DocumentType(str, Enum):
    """Supported project and site instruction document types."""

    contract_pdf = "contract_pdf"
    boq_excel = "boq_excel"
    site_audio = "site_audio"
    site_photo = "site_photo"


class AssessmentOutcome(str, Enum):
    """Commercial assessment categories for a site instruction."""

    potential_variation = "potential_variation"
    existing_scope = "existing_scope"
    missing_approval = "missing_approval"
    insufficient_evidence = "insufficient_evidence"


class ReviewStatus(str, Enum):
    """Human Quantity Surveyor (QS) review states."""

    pending_review = "pending_review"
    confirmed = "confirmed"
    needs_more_info = "needs_more_info"
    rejected = "rejected"


class DocumentProcessingStatus(str, Enum):
    """Processing status for ingested contract PDF and BOQ Excel documents."""

    extracted = "extracted"
    partial = "partial"
    unreadable = "unreadable"


class InstructionSourceType(str, Enum):
    """Input source channel for an informal construction site instruction."""

    text = "text"
    audio = "audio"
    image = "image"
    text_and_audio = "text_and_audio"
    text_and_image = "text_and_image"


class ExtractionFieldStatus(str, Enum):
    """Explicit certainty state distinguishing extracted facts from gaps."""

    extracted = "extracted"
    uncertain = "uncertain"
    missing = "missing"


class PreliminaryAssessmentCategory(str, Enum):
    """AI preliminary commercial assessment categories (Phase 4)."""

    existing_scope = "existing_scope"
    potential_variation = "potential_variation"
    approval_or_notice_missing = "approval_or_notice_missing"
    insufficient_evidence = "insufficient_evidence"
    ambiguous = "ambiguous"


class CostCategory(str, Enum):
    """Supported cost build-up categories for variation line items."""

    labour = "labour"
    material = "material"
    equipment = "equipment"
    subcontract = "subcontract"
    other = "other"


class CostLineType(str, Enum):
    """Explicit sign convention for cost line items."""

    addition = "addition"
    deduction = "deduction"


class RoundingMode(str, Enum):
    """Explicit deterministic financial rounding modes."""

    half_up = "HALF_UP"
    half_even = "HALF_EVEN"


class ValueSource(str, Enum):
    """Recorded provenance of each quantity or unit rate."""

    confirmed_instruction = "confirmed_instruction"
    boq_reference = "boq_reference"
    qs_entered = "qs_entered"
    qs_proposed = "qs_proposed"
    site_measurement = "site_measurement"
    subcontractor_quote = "subcontractor_quote"
    contract_schedule = "contract_schedule"
    missing = "missing"


class CostVerificationStatus(str, Enum):
    """Verification state of a cost line item's inputs."""

    verified = "verified"
    unverified = "unverified"
    missing_data = "missing_data"


class QsDecisionAction(str, Enum):
    """Explicit human Quantity Surveyor review actions."""

    accept_assessment = "accept_assessment"
    reject_assessment = "reject_assessment"
    mark_existing_scope = "mark_existing_scope"
    request_additional_info = "request_additional_info"


class VariationLifecycleStatus(str, Enum):
    """Commercial lifecycle statuses for a tracked variation case (Phase 6)."""

    detected = "detected"
    under_review = "under_review"
    drafted = "drafted"
    submitted = "submitted"
    approved = "approved"
    rejected = "rejected"
    executed = "executed"
    billed = "billed"
    paid = "paid"


def _clean_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


class ExtractedField(BaseModel):
    """Single extracted field preserving certainty and verbatim input evidence."""

    value: Optional[str] = None
    status: ExtractionFieldStatus = ExtractionFieldStatus.missing
    note: Optional[str] = None
    evidence_quote: Optional[str] = None

    @model_validator(mode="after")
    def _enforce_honesty_invariants(self) -> "ExtractedField":
        self.value = _clean_optional_str(self.value)
        self.note = _clean_optional_str(self.note)
        self.evidence_quote = _clean_optional_str(self.evidence_quote)
        if self.value is None:
            self.status = ExtractionFieldStatus.missing
        elif self.status == ExtractionFieldStatus.missing:
            self.value = None
        return self


class ExtractedQuantityMention(BaseModel):
    """Quantity/unit/material mention explicitly stated in the site instruction."""

    item_or_material: Optional[str] = None
    quantity: Optional[str] = None
    unit: Optional[str] = None
    status: ExtractionFieldStatus = ExtractionFieldStatus.extracted
    note: Optional[str] = None
    evidence_quote: Optional[str] = None

    @model_validator(mode="after")
    def _enforce_honesty_invariants(self) -> "ExtractedQuantityMention":
        self.item_or_material = _clean_optional_str(self.item_or_material)
        self.quantity = _clean_optional_str(self.quantity)
        self.unit = _clean_optional_str(self.unit)
        self.note = _clean_optional_str(self.note)
        self.evidence_quote = _clean_optional_str(self.evidence_quote)
        if (
            self.item_or_material is None
            and self.quantity is None
            and self.unit is None
        ):
            self.status = ExtractionFieldStatus.missing
        return self


class InstructionEvidenceReference(BaseModel):
    """Traceable link back to the submitted instruction text or attachment."""

    source_id: str
    source_type: InstructionSourceType
    location: str
    excerpt: str


class ChangeEventFields(BaseModel):
    """Structured site-change event fields shared by AI suggestion and human review."""

    instruction_description: ExtractedField = Field(default_factory=ExtractedField)
    issuer_name: ExtractedField = Field(default_factory=ExtractedField)
    issuer_role: ExtractedField = Field(default_factory=ExtractedField)
    recipient: ExtractedField = Field(default_factory=ExtractedField)
    project_site_location: ExtractedField = Field(default_factory=ExtractedField)
    communication_date: ExtractedField = Field(default_factory=ExtractedField)
    requested_work: ExtractedField = Field(default_factory=ExtractedField)
    affected_activity: ExtractedField = Field(default_factory=ExtractedField)
    mentioned_quantities: list[ExtractedQuantityMention] = Field(default_factory=list)
    mentioned_materials: list[ExtractedField] = Field(default_factory=list)
    mentioned_deadlines: list[ExtractedField] = Field(default_factory=list)
    scope_change_indicators: list[ExtractedField] = Field(default_factory=list)
    missing_or_ambiguous_information: list[str] = Field(default_factory=list)


class OriginalInstructionInput(BaseModel):
    """Immutable record of the original submitted site instruction."""

    raw_text: Optional[str] = None
    source_type: InstructionSourceType
    submitted_at: datetime
    attachment_id: Optional[str] = None
    attachment_filename: Optional[str] = None
    attachment_mime_type: Optional[str] = None
    attachment_storage_uri: Optional[str] = None


class AiChangeEventExtraction(BaseModel):
    """AI-extracted structured event clearly separated from human confirmation."""

    origin: Literal["ai_suggestion"] = "ai_suggestion"
    model_name: str
    extracted_at: datetime
    fields: ChangeEventFields
    evidence_references: list[InstructionEvidenceReference] = Field(
        default_factory=list
    )
    disclaimer: str = (
        "AI-generated suggestion from informal site instruction. "
        "Not a confirmed contractual decision, variation approval, or cost estimate."
    )


class ConfirmedChangeEvent(BaseModel):
    """Human-reviewed and edited/confirmed site-change event."""

    origin: Literal["human_confirmed"] = "human_confirmed"
    confirmation_status: Literal["pending_review", "confirmed"] = "pending_review"
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    reviewer_notes: Optional[str] = None
    fields: ChangeEventFields


class ConfirmExtractionRequest(BaseModel):
    """Request payload for QS/user edit and confirmation of an extracted event."""

    fields: ChangeEventFields
    confirmed_by: Optional[str] = None
    reviewer_notes: Optional[str] = None
    confirm: bool = True


class SourceReference(BaseModel):
    """Verbatim reference linking an extracted fact back to its source document."""

    document_id: str
    document_name: str
    document_type: DocumentType
    location: str = Field(
        ...,
        description="Exact location such as 'Page 14, Clause 12.3' or 'Sheet MEP BOQ, Row 42'.",
    )
    excerpt: str


class DocumentMetadata(BaseModel):
    """Stored metadata for an uploaded project or evidence file."""

    id: str
    filename: str
    document_type: DocumentType
    storage_uri: str
    uploaded_at: datetime
    is_demo: bool = False
    project_id: str = "default-project"
    content_sha256: Optional[str] = None
    processing_status: DocumentProcessingStatus = DocumentProcessingStatus.extracted
    status_message: Optional[str] = None
    page_count: Optional[int] = None
    readable_page_count: Optional[int] = None
    sheet_count: Optional[int] = None
    row_count: Optional[int] = None


class ContractPage(BaseModel):
    """Extracted text and metadata for a single contract PDF page."""

    page_number: int
    text: str
    character_count: int
    is_readable: bool
    source_reference: SourceReference


class ContractExtractionResult(BaseModel):
    """Page-level extraction result for an uploaded contract PDF."""

    page_count: int
    readable_page_count: int
    unreadable_pages: list[int] = Field(default_factory=list)
    pages: list[ContractPage] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class BoqRow(BaseModel):
    """Extracted BOQ row preserving exact sheet/row source references and nullable values."""

    sheet_name: str
    row_number: int
    item_code: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[Decimal] = None
    rate: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    raw_values: dict[str, Optional[str]] = Field(default_factory=dict)
    source_reference: SourceReference


class BoqSheet(BaseModel):
    """Extracted BOQ worksheet with header metadata, merged cell notes, and rows."""

    sheet_name: str
    header_row_number: Optional[int] = None
    columns: list[str] = Field(default_factory=list)
    merged_ranges: list[str] = Field(default_factory=list)
    blank_rows_skipped: int = 0
    rows: list[BoqRow] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class BoqExtractionResult(BaseModel):
    """Workbook-level BOQ extraction result across all sheets."""

    sheet_count: int
    total_rows: int
    sheets: list[BoqSheet] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DocumentExtractionRecord(BaseModel):
    """Persisted extraction payload linked to a stored DocumentMetadata record."""

    document_id: str
    document_type: DocumentType
    contract_extraction: Optional[ContractExtractionResult] = None
    boq_extraction: Optional[BoqExtractionResult] = None


class DocumentIngestResponse(BaseModel):
    """API response containing stored document metadata and its extracted structure."""

    document: DocumentMetadata
    contract_extraction: Optional[ContractExtractionResult] = None
    boq_extraction: Optional[BoqExtractionResult] = None


def _parse_exact_decimal(value: Any) -> Optional[Decimal]:
    """Reject binary floats/booleans and parse exact Decimal from str/int/Decimal."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("Boolean is not a valid decimal number.")
    if isinstance(value, float):
        raise ValueError(
            "Provide exact decimal strings or integers rather than binary floats for financial values."
        )
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Decimal value must be finite.")
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        parsed = Decimal(stripped)
        if not parsed.is_finite():
            raise ValueError("Decimal value must be finite.")
        return parsed
    raise ValueError(f"Unsupported decimal input type: {type(value).__name__}")


class CostLineItem(BaseModel):
    """Single deterministic cost line; missing rates/quantities remain None."""

    id: str = ""
    description: str
    category: CostCategory = CostCategory.other
    line_type: CostLineType = CostLineType.addition
    unit: Optional[str] = None
    quantity: Optional[Decimal] = None
    rate: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    quantity_source: ValueSource = ValueSource.missing
    quantity_source_note: Optional[str] = None
    rate_source: ValueSource = ValueSource.missing
    rate_basis_note: Optional[str] = None
    verification_status: CostVerificationStatus = CostVerificationStatus.unverified
    boq_reference: Optional[SourceReference] = None
    original_boq_item_code: Optional[str] = None
    original_boq_unit: Optional[str] = None
    original_boq_quantity: Optional[Decimal] = None
    original_boq_rate: Optional[Decimal] = None
    missing_fields: list[str] = Field(default_factory=list)
    note: Optional[str] = None


class DeterministicEstimate(BaseModel):
    """Deterministic Python calculation derived only from verified/supplied rates & quantities."""

    currency: Optional[str] = None
    decimal_places: int = 2
    rounding_mode: RoundingMode = RoundingMode.half_up
    line_items: list[CostLineItem] = Field(default_factory=list)
    additions_subtotal: Optional[Decimal] = None
    deductions_subtotal: Optional[Decimal] = None
    subtotal: Optional[Decimal] = None
    tax_rate_percent: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None
    total_estimated_amount: Optional[Decimal] = None
    calculable_line_count: int = 0
    incomplete_line_count: int = 0
    is_partial_estimate: bool = False
    has_unverified_inputs: bool = False
    missing_inputs: list[str] = Field(default_factory=list)
    calculation_notes: list[str] = Field(default_factory=list)
    calculated_at: Optional[datetime] = None
    disclaimer: str = (
        "Preliminary deterministic estimate for QS review only — not an approved variation amount."
    )


class AiSuggestion(BaseModel):
    """AI-generated extraction and preliminary commercial suggestion (unconfirmed)."""

    origin: Literal["ai_suggestion"] = "ai_suggestion"
    summary: str
    work_description: str
    location: Optional[str] = None
    instructed_by: Optional[str] = None
    instruction_date: Optional[str] = None
    suggested_assessment: AssessmentOutcome
    rationale: str
    contract_references: list[SourceReference] = Field(default_factory=list)
    boq_references: list[SourceReference] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    requires_human_review: bool = True


class QsDecision(BaseModel):
    """Confirmed commercial decision authored or approved by a human QS."""

    origin: Literal["human_qs_decision"] = "human_qs_decision"
    review_status: ReviewStatus = ReviewStatus.pending_review
    decision_action: Optional[QsDecisionAction] = None
    confirmed_assessment: Optional[AssessmentOutcome] = None
    confirmed_category: Optional[PreliminaryAssessmentCategory] = None
    assessment_id: Optional[str] = None
    reviewer_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    reason: Optional[str] = None
    notes: Optional[str] = None
    is_draft: bool = True


class RetrievedContractClause(BaseModel):
    """Retrieved contract passage preserving exact document, page, and verbatim text."""

    ref_id: str
    document_id: str
    document_name: str
    page_number: int
    clause_number: Optional[str] = None
    clause_title: Optional[str] = None
    verbatim_text: str
    matched_terms: list[str] = Field(default_factory=list)
    relevance_reason: str
    source_reference: SourceReference


class RetrievedBoqItem(BaseModel):
    """Retrieved BOQ row preserving workbook, sheet, row, and nullable values."""

    ref_id: str
    document_id: str
    workbook_name: str
    sheet_name: str
    row_number: int
    item_code: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[Decimal] = None
    rate: Optional[Decimal] = None
    amount: Optional[Decimal] = None
    matched_terms: list[str] = Field(default_factory=list)
    caution_note: str = (
        "Lexical match only — does not by itself prove the requested work is included in base scope."
    )
    source_reference: SourceReference


class CitedFinding(BaseModel):
    """Single assessment finding bound deterministically to retrieved source refs."""

    statement: str
    source_ref_ids: list[str] = Field(default_factory=list)
    source_references: list[SourceReference] = Field(default_factory=list)
    grounding_status: Literal["verified", "unverified", "unsupported"] = "verified"
    grounding_note: Optional[str] = None


class GroundingValidationResult(BaseModel):
    """Result of independent source-grounding & commercial guardrail checks (Phase 7)."""

    is_valid: bool = True
    checked_reference_count: int = 0
    verified_reference_count: int = 0
    unsupported_claim_count: int = 0
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PreliminaryCommercialAssessment(BaseModel):
    """AI preliminary commercial assessment comparing confirmed event against sources."""

    origin: Literal["ai_suggestion"] = "ai_suggestion"
    assessment_category: PreliminaryAssessmentCategory
    requested_work_summary: str
    documented_facts: list[CitedFinding] = Field(default_factory=list)
    scope_comparison: str
    ai_interpretation_summary: str
    explicit_inclusions: list[CitedFinding] = Field(default_factory=list)
    explicit_exclusions: list[CitedFinding] = Field(default_factory=list)
    potential_scope_overlap: list[CitedFinding] = Field(default_factory=list)
    written_approval_requirements: list[CitedFinding] = Field(default_factory=list)
    issuer_authority_requirements: list[CitedFinding] = Field(default_factory=list)
    notice_requirements_and_deadlines: list[CitedFinding] = Field(default_factory=list)
    conflicting_or_ambiguous_evidence: list[CitedFinding] = Field(default_factory=list)
    missing_evidence_and_information: list[str] = Field(default_factory=list)
    recommended_qs_followup: list[str] = Field(default_factory=list)
    guardrail_warnings: list[str] = Field(default_factory=list)
    disclaimer: str = (
        "AI-generated preliminary assessment for QS review only. "
        "Does not establish contractual entitlement, legal payability, or variation approval."
    )


class CommercialAssessmentRecord(BaseModel):
    """Persisted Phase 4 commercial assessment linked to a confirmed site-change event."""

    id: str
    project_id: str
    case_id: str
    is_demo: bool = False
    retrieved_contract_clauses: list[RetrievedContractClause] = Field(default_factory=list)
    retrieved_boq_items: list[RetrievedBoqItem] = Field(default_factory=list)
    retrieved_source_references: list[SourceReference] = Field(default_factory=list)
    ai_assessment: PreliminaryCommercialAssessment
    grounding_validation: Optional[GroundingValidationResult] = None
    assessed_at: datetime
    model_name: str
    human_review_status: ReviewStatus = ReviewStatus.pending_review


class CommercialTracking(BaseModel):
    """Explicitly tracked commercial lifecycle metadata (never auto-invented)."""

    project_name: Optional[str] = None
    subcontractor_name: Optional[str] = None
    responsible_person: Optional[str] = None
    submission_reference: Optional[str] = None
    submission_date: Optional[str] = None
    recipient: Optional[str] = None
    claimed_amount: Optional[Decimal] = None
    approved_amount: Optional[Decimal] = None
    billed_amount: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = None
    execution_status: Optional[str] = None
    invoice_reference: Optional[str] = None
    payment_status: Optional[str] = None
    payment_date: Optional[str] = None
    notes: Optional[str] = None
    supporting_document_ids: list[str] = Field(default_factory=list)

    @field_validator(
        "claimed_amount",
        "approved_amount",
        "billed_amount",
        "paid_amount",
        mode="before",
    )
    @classmethod
    def _validate_exact_amounts(cls, value: Any) -> Optional[Decimal]:
        return _parse_exact_decimal(value)


class VariationCase(BaseModel):
    """Potential variation case stored in the variation register."""

    id: str
    title: str
    project_id: str = "default-project"
    variation_reference: Optional[str] = None
    lifecycle_status: VariationLifecycleStatus = VariationLifecycleStatus.detected
    commercial_tracking: CommercialTracking = Field(default_factory=CommercialTracking)
    latest_report_id: Optional[str] = None
    instruction_text: Optional[str] = None
    original_input: Optional[OriginalInstructionInput] = None
    attachment_ids: list[str] = Field(default_factory=list)
    ai_extraction: Optional[AiChangeEventExtraction] = None
    confirmed_extraction: Optional[ConfirmedChangeEvent] = None
    latest_assessment_id: Optional[str] = None
    ai_suggestion: Optional[AiSuggestion] = None
    deterministic_estimate: Optional[DeterministicEstimate] = None
    qs_decision: QsDecision = Field(default_factory=QsDecision)
    is_demo: bool = False
    created_at: datetime
    updated_at: datetime


class CostLineItemInput(BaseModel):
    """Input line item payload rejecting binary floats and preserving BOQ reference data."""

    id: str = ""
    description: str
    category: CostCategory = CostCategory.other
    line_type: CostLineType = CostLineType.addition
    unit: Optional[str] = None
    quantity: Optional[Decimal] = None
    rate: Optional[Decimal] = None
    quantity_source: ValueSource = ValueSource.missing
    quantity_source_note: Optional[str] = None
    rate_source: ValueSource = ValueSource.missing
    rate_basis_note: Optional[str] = None
    verification_status: CostVerificationStatus = CostVerificationStatus.unverified
    boq_reference: Optional[SourceReference] = None
    original_boq_item_code: Optional[str] = None
    original_boq_unit: Optional[str] = None
    original_boq_quantity: Optional[Decimal] = None
    original_boq_rate: Optional[Decimal] = None
    note: Optional[str] = None

    @field_validator(
        "quantity",
        "rate",
        "original_boq_quantity",
        "original_boq_rate",
        mode="before",
    )
    @classmethod
    def _validate_exact_decimals(cls, value: Any) -> Optional[Decimal]:
        return _parse_exact_decimal(value)


class CostEstimateUpdateRequest(BaseModel):
    """Request payload for server-side deterministic cost recalculation & persistence."""

    reviewer_name: Optional[str] = None
    reason: Optional[str] = None
    currency: Optional[str] = None
    decimal_places: int = 2
    rounding_mode: RoundingMode = RoundingMode.half_up
    tax_rate_percent: Optional[Decimal] = None
    line_items: list[CostLineItemInput] = Field(default_factory=list)

    @field_validator("tax_rate_percent", mode="before")
    @classmethod
    def _validate_exact_tax(cls, value: Any) -> Optional[Decimal]:
        return _parse_exact_decimal(value)


class QsReviewRequest(BaseModel):
    """Request payload for saving a draft or confirmed QS human decision."""

    reviewer_name: str
    decision_action: QsDecisionAction
    confirmed_category: Optional[PreliminaryAssessmentCategory] = None
    reason: Optional[str] = None
    notes: Optional[str] = None
    is_draft: bool = False
    assessment_id: Optional[str] = None


class ReviewHistoryEntry(BaseModel):
    """Immutable append-only audit trail entry for cost updates and QS decisions."""

    id: str
    project_id: str
    case_id: str
    entry_type: Literal["cost_update", "qs_decision_draft", "qs_decision_confirmed"]
    reviewer_name: str
    timestamp: datetime
    assessment_id: Optional[str] = None
    decision_action: Optional[QsDecisionAction] = None
    review_status: ReviewStatus
    reason: Optional[str] = None
    previous_snapshot: dict[str, Any] = Field(default_factory=dict)
    updated_snapshot: dict[str, Any] = Field(default_factory=dict)
    cost_estimate_snapshot: Optional[DeterministicEstimate] = None


class CostEstimateResponse(BaseModel):
    """Response returned after saving and recalculating a case cost build-up."""

    case_id: str
    project_id: str
    deterministic_estimate: DeterministicEstimate
    history_entry: ReviewHistoryEntry


class QsReviewResponse(BaseModel):
    """Response returned after saving a QS review draft or decision."""

    case: VariationCase
    assessment: Optional[CommercialAssessmentRecord] = None
    history_entry: ReviewHistoryEntry


class LifecycleHistoryEntry(BaseModel):
    """Immutable append-only status change record for the variation lifecycle."""

    id: str
    project_id: str
    case_id: str
    from_status: Optional[VariationLifecycleStatus] = None
    to_status: VariationLifecycleStatus
    changed_by: str
    changed_at: datetime
    reason: Optional[str] = None
    notes: Optional[str] = None
    tracking_snapshot: dict[str, Any] = Field(default_factory=dict)


class EvidencePackRecord(BaseModel):
    """Persisted metadata for a generated PDF variation evidence pack."""

    id: str
    project_id: str
    case_id: str
    variation_reference: str
    title: str
    filename: str
    storage_uri: str
    storage_relative_path: str
    content_sha256: str
    size_bytes: int
    page_count: int
    is_draft: bool = True
    status_label: str
    lifecycle_status_at_generation: VariationLifecycleStatus
    qs_review_status_at_generation: ReviewStatus
    assessment_id: Optional[str] = None
    prepared_by: str
    project_name: Optional[str] = None
    subcontractor_name: Optional[str] = None
    is_demo: bool = False
    generated_at: datetime


class GenerateReportRequest(BaseModel):
    """Request payload for generating a draft or post-submission PDF evidence pack."""

    prepared_by: str
    project_name: Optional[str] = None
    subcontractor_name: Optional[str] = None
    variation_reference: Optional[str] = None


class LifecycleTransitionRequest(BaseModel):
    """Explicit human lifecycle status transition and commercial tracking update."""

    target_status: VariationLifecycleStatus
    responsible_person: str
    reason: Optional[str] = None
    project_name: Optional[str] = None
    subcontractor_name: Optional[str] = None
    variation_reference: Optional[str] = None
    submission_reference: Optional[str] = None
    submission_date: Optional[str] = None
    recipient: Optional[str] = None
    claimed_amount: Optional[Decimal] = None
    approved_amount: Optional[Decimal] = None
    billed_amount: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = None
    execution_status: Optional[str] = None
    invoice_reference: Optional[str] = None
    payment_status: Optional[str] = None
    payment_date: Optional[str] = None
    notes: Optional[str] = None
    supporting_document_ids: Optional[list[str]] = None

    @field_validator(
        "claimed_amount",
        "approved_amount",
        "billed_amount",
        "paid_amount",
        mode="before",
    )
    @classmethod
    def _validate_exact_amounts(cls, value: Any) -> Optional[Decimal]:
        return _parse_exact_decimal(value)


class CommercialTrackingUpdateRequest(BaseModel):
    """Update commercial tracking details without advancing lifecycle status."""

    updated_by: str
    notes_reason: Optional[str] = None
    project_name: Optional[str] = None
    subcontractor_name: Optional[str] = None
    variation_reference: Optional[str] = None
    responsible_person: Optional[str] = None
    submission_reference: Optional[str] = None
    submission_date: Optional[str] = None
    recipient: Optional[str] = None
    claimed_amount: Optional[Decimal] = None
    approved_amount: Optional[Decimal] = None
    billed_amount: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = None
    execution_status: Optional[str] = None
    invoice_reference: Optional[str] = None
    payment_status: Optional[str] = None
    payment_date: Optional[str] = None
    notes: Optional[str] = None
    supporting_document_ids: Optional[list[str]] = None

    @field_validator(
        "claimed_amount",
        "approved_amount",
        "billed_amount",
        "paid_amount",
        mode="before",
    )
    @classmethod
    def _validate_exact_amounts(cls, value: Any) -> Optional[Decimal]:
        return _parse_exact_decimal(value)


class LifecycleTransitionResponse(BaseModel):
    """Response returned after a validated lifecycle status transition."""

    case: VariationCase
    history_entry: LifecycleHistoryEntry


class CurrencyCommercialSummary(BaseModel):
    """Deterministic per-currency amounts strictly separating proposed, approved, billed, and paid."""

    currency: str
    potential_variation_value: Decimal
    proposed_total: Decimal
    approved_total: Decimal
    approved_unbilled_total: Decimal
    billed_total: Decimal
    billed_unpaid_total: Decimal
    paid_total: Decimal
    proposed_case_count: int = 0
    approved_case_count: int = 0
    billed_case_count: int = 0
    paid_case_count: int = 0
    unpriced_case_count: int = 0


class DashboardMetricsResponse(BaseModel):
    """Commercial register summary metrics computed deterministically from persisted cases."""

    project_id: Optional[str] = None
    total_cases: int = 0
    live_case_count: int = 0
    demo_case_count: int = 0
    contains_demo_data: bool = False
    demo_label: Optional[str] = None
    status_counts: dict[str, int] = Field(default_factory=dict)
    awaiting_qs_review_count: int = 0
    drafted_not_submitted_count: int = 0
    submitted_awaiting_response_count: int = 0
    approved_not_billed_count: int = 0
    billed_unpaid_count: int = 0
    incomplete_evidence_count: int = 0
    amounts_by_currency: list[CurrencyCommercialSummary] = Field(default_factory=list)
    disclaimer: str = (
        "Proposed, approved, billed, and paid amounts are strictly separated "
        "and calculated deterministically from persisted case data — never merged into one revenue figure."
    )


class HealthResponse(BaseModel):
    """Backend health and configuration readiness payload (safe for public display)."""

    status: Literal["ok"] = "ok"
    app: str
    version: str
    environment: str
    storage_backend: str
    storage_ready: bool
    gemini_configured: bool
