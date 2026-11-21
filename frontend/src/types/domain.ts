export type DocumentType =
  | "contract_pdf"
  | "boq_excel"
  | "site_audio"
  | "site_photo";

export type DocumentProcessingStatus =
  | "extracted"
  | "partial"
  | "unreadable";

export type InstructionSourceType =
  | "text"
  | "audio"
  | "image"
  | "text_and_audio"
  | "text_and_image";

export type ExtractionFieldStatus = "extracted" | "uncertain" | "missing";

export type PreliminaryAssessmentCategory =
  | "existing_scope"
  | "potential_variation"
  | "approval_or_notice_missing"
  | "insufficient_evidence"
  | "ambiguous";

export type CostCategory =
  | "labour"
  | "material"
  | "equipment"
  | "subcontract"
  | "other";

export type CostLineType = "addition" | "deduction";

export type RoundingMode = "HALF_UP" | "HALF_EVEN";

export type ValueSource =
  | "confirmed_instruction"
  | "boq_reference"
  | "qs_entered"
  | "qs_proposed"
  | "site_measurement"
  | "subcontractor_quote"
  | "contract_schedule"
  | "missing";

export type CostVerificationStatus = "verified" | "unverified" | "missing_data";

export type QsDecisionAction =
  | "accept_assessment"
  | "reject_assessment"
  | "mark_existing_scope"
  | "request_additional_info";

export type AssessmentOutcome =
  | "potential_variation"
  | "existing_scope"
  | "missing_approval"
  | "insufficient_evidence";

export type ReviewStatus =
  | "pending_review"
  | "confirmed"
  | "needs_more_info"
  | "rejected";

export type VariationLifecycleStatus =
  | "detected"
  | "under_review"
  | "drafted"
  | "submitted"
  | "approved"
  | "rejected"
  | "executed"
  | "billed"
  | "paid";

export interface SourceReference {
  document_id: string;
  document_name: string;
  document_type: DocumentType;
  location: string;
  excerpt: string;
}

export interface DocumentMetadata {
  id: string;
  filename: string;
  document_type: DocumentType;
  storage_uri: string;
  uploaded_at: string;
  is_demo: boolean;
  project_id: string;
  content_sha256: string | null;
  processing_status: DocumentProcessingStatus;
  status_message: string | null;
  page_count: number | null;
  readable_page_count: number | null;
  sheet_count: number | null;
  row_count: number | null;
}

export interface ContractPage {
  page_number: number;
  text: string;
  character_count: number;
  is_readable: boolean;
  source_reference: SourceReference;
}

export interface ContractExtractionResult {
  page_count: number;
  readable_page_count: number;
  unreadable_pages: number[];
  pages: ContractPage[];
  warnings: string[];
}

export interface BoqRow {
  sheet_name: string;
  row_number: number;
  item_code: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  raw_values: Record<string, string | null>;
  source_reference: SourceReference;
}

export interface BoqSheet {
  sheet_name: string;
  header_row_number: number | null;
  columns: string[];
  merged_ranges: string[];
  blank_rows_skipped: number;
  rows: BoqRow[];
  warnings: string[];
}

export interface BoqExtractionResult {
  sheet_count: number;
  total_rows: number;
  sheets: BoqSheet[];
  warnings: string[];
}

export interface DocumentIngestResponse {
  document: DocumentMetadata;
  contract_extraction: ContractExtractionResult | null;
  boq_extraction: BoqExtractionResult | null;
}

export interface ExtractedField {
  value: string | null;
  status: ExtractionFieldStatus;
  note: string | null;
  evidence_quote: string | null;
}

export interface ExtractedQuantityMention {
  item_or_material: string | null;
  quantity: string | null;
  unit: string | null;
  status: ExtractionFieldStatus;
  note: string | null;
  evidence_quote: string | null;
}

export interface InstructionEvidenceReference {
  source_id: string;
  source_type: InstructionSourceType;
  location: string;
  excerpt: string;
}

export interface ChangeEventFields {
  instruction_description: ExtractedField;
  issuer_name: ExtractedField;
  issuer_role: ExtractedField;
  recipient: ExtractedField;
  project_site_location: ExtractedField;
  communication_date: ExtractedField;
  requested_work: ExtractedField;
  affected_activity: ExtractedField;
  mentioned_quantities: ExtractedQuantityMention[];
  mentioned_materials: ExtractedField[];
  mentioned_deadlines: ExtractedField[];
  scope_change_indicators: ExtractedField[];
  missing_or_ambiguous_information: string[];
}

export interface OriginalInstructionInput {
  raw_text: string | null;
  source_type: InstructionSourceType;
  submitted_at: string;
  attachment_id: string | null;
  attachment_filename: string | null;
  attachment_mime_type: string | null;
  attachment_storage_uri: string | null;
}

export interface AiChangeEventExtraction {
  origin: "ai_suggestion";
  model_name: string;
  extracted_at: string;
  fields: ChangeEventFields;
  evidence_references: InstructionEvidenceReference[];
  disclaimer: string;
}

export interface ConfirmedChangeEvent {
  origin: "human_confirmed";
  confirmation_status: "pending_review" | "confirmed";
  confirmed_by: string | null;
  confirmed_at: string | null;
  reviewer_notes: string | null;
  fields: ChangeEventFields;
}

export interface ConfirmExtractionRequest {
  fields: ChangeEventFields;
  confirmed_by: string | null;
  reviewer_notes: string | null;
  confirm: boolean;
}

export interface CostLineItem {
  id: string;
  description: string;
  category: CostCategory;
  line_type: CostLineType;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  quantity_source: ValueSource;
  quantity_source_note: string | null;
  rate_source: ValueSource;
  rate_basis_note: string | null;
  verification_status: CostVerificationStatus;
  boq_reference: SourceReference | null;
  original_boq_item_code: string | null;
  original_boq_unit: string | null;
  original_boq_quantity: string | null;
  original_boq_rate: string | null;
  missing_fields: string[];
  note: string | null;
}

export interface CostLineItemInput {
  id?: string;
  description: string;
  category: CostCategory;
  line_type: CostLineType;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  quantity_source: ValueSource;
  quantity_source_note: string | null;
  rate_source: ValueSource;
  rate_basis_note: string | null;
  verification_status: CostVerificationStatus;
  boq_reference: SourceReference | null;
  original_boq_item_code: string | null;
  original_boq_unit: string | null;
  original_boq_quantity: string | null;
  original_boq_rate: string | null;
  note: string | null;
}

export interface DeterministicEstimate {
  currency: string | null;
  decimal_places: number;
  rounding_mode: RoundingMode;
  line_items: CostLineItem[];
  additions_subtotal: string | null;
  deductions_subtotal: string | null;
  subtotal: string | null;
  tax_rate_percent: string | null;
  tax_amount: string | null;
  total_estimated_amount: string | null;
  calculable_line_count: number;
  incomplete_line_count: number;
  is_partial_estimate: boolean;
  has_unverified_inputs: boolean;
  missing_inputs: string[];
  calculation_notes: string[];
  calculated_at: string | null;
  disclaimer: string;
}

export interface CostEstimateUpdateRequest {
  reviewer_name: string | null;
  reason: string | null;
  currency: string | null;
  decimal_places: number;
  rounding_mode: RoundingMode;
  tax_rate_percent: string | null;
  line_items: CostLineItemInput[];
}

export interface QsReviewRequest {
  reviewer_name: string;
  decision_action: QsDecisionAction;
  confirmed_category: PreliminaryAssessmentCategory | null;
  reason: string | null;
  notes: string | null;
  is_draft: boolean;
  assessment_id: string | null;
}

export interface ReviewHistoryEntry {
  id: string;
  project_id: string;
  case_id: string;
  entry_type: "cost_update" | "qs_decision_draft" | "qs_decision_confirmed";
  reviewer_name: string;
  timestamp: string;
  assessment_id: string | null;
  decision_action: QsDecisionAction | null;
  review_status: ReviewStatus;
  reason: string | null;
  previous_snapshot: Record<string, unknown>;
  updated_snapshot: Record<string, unknown>;
  cost_estimate_snapshot: DeterministicEstimate | null;
}

export interface CostEstimateResponse {
  case_id: string;
  project_id: string;
  deterministic_estimate: DeterministicEstimate;
  history_entry: ReviewHistoryEntry;
}

export interface QsReviewResponse {
  case: VariationCase;
  assessment: CommercialAssessmentRecord | null;
  history_entry: ReviewHistoryEntry;
}

export interface AiSuggestion {
  origin: "ai_suggestion";
  summary: string;
  work_description: string;
  location: string | null;
  instructed_by: string | null;
  instruction_date: string | null;
  suggested_assessment: AssessmentOutcome;
  rationale: string;
  contract_references: SourceReference[];
  boq_references: SourceReference[];
  missing_information: string[];
  requires_human_review: boolean;
}

export interface QsDecision {
  origin: "human_qs_decision";
  review_status: ReviewStatus;
  decision_action: QsDecisionAction | null;
  confirmed_assessment: AssessmentOutcome | null;
  confirmed_category: PreliminaryAssessmentCategory | null;
  assessment_id: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  reason: string | null;
  notes: string | null;
  is_draft: boolean;
}

export interface RetrievedContractClause {
  ref_id: string;
  document_id: string;
  document_name: string;
  page_number: number;
  clause_number: string | null;
  clause_title: string | null;
  verbatim_text: string;
  matched_terms: string[];
  relevance_reason: string;
  source_reference: SourceReference;
}

export interface RetrievedBoqItem {
  ref_id: string;
  document_id: string;
  workbook_name: string;
  sheet_name: string;
  row_number: number;
  item_code: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  matched_terms: string[];
  caution_note: string;
  source_reference: SourceReference;
}

export interface CitedFinding {
  statement: string;
  source_ref_ids: string[];
  source_references: SourceReference[];
  grounding_status?: "verified" | "unverified" | "unsupported";
  grounding_note?: string | null;
}

export interface GroundingValidationResult {
  is_valid: boolean;
  checked_reference_count: number;
  verified_reference_count: number;
  unsupported_claim_count: number;
  errors: string[];
  warnings: string[];
}

export interface PreliminaryCommercialAssessment {
  origin: "ai_suggestion";
  assessment_category: PreliminaryAssessmentCategory;
  requested_work_summary: string;
  documented_facts: CitedFinding[];
  scope_comparison: string;
  ai_interpretation_summary: string;
  explicit_inclusions: CitedFinding[];
  explicit_exclusions: CitedFinding[];
  potential_scope_overlap: CitedFinding[];
  written_approval_requirements: CitedFinding[];
  issuer_authority_requirements: CitedFinding[];
  notice_requirements_and_deadlines: CitedFinding[];
  conflicting_or_ambiguous_evidence: CitedFinding[];
  missing_evidence_and_information: string[];
  recommended_qs_followup: string[];
  guardrail_warnings?: string[];
  disclaimer: string;
}

export interface CommercialAssessmentRecord {
  id: string;
  project_id: string;
  case_id: string;
  is_demo: boolean;
  retrieved_contract_clauses: RetrievedContractClause[];
  retrieved_boq_items: RetrievedBoqItem[];
  retrieved_source_references: SourceReference[];
  ai_assessment: PreliminaryCommercialAssessment;
  grounding_validation?: GroundingValidationResult | null;
  assessed_at: string;
  model_name: string;
  human_review_status: ReviewStatus;
}

export interface CommercialTracking {
  project_name: string | null;
  subcontractor_name: string | null;
  responsible_person: string | null;
  submission_reference: string | null;
  submission_date: string | null;
  recipient: string | null;
  claimed_amount: string | null;
  approved_amount: string | null;
  billed_amount: string | null;
  paid_amount: string | null;
  execution_status: string | null;
  invoice_reference: string | null;
  payment_status: string | null;
  payment_date: string | null;
  notes: string | null;
  supporting_document_ids: string[];
}

export interface VariationCase {
  id: string;
  title: string;
  project_id: string;
  variation_reference: string | null;
  lifecycle_status: VariationLifecycleStatus;
  commercial_tracking: CommercialTracking;
  latest_report_id: string | null;
  instruction_text: string | null;
  original_input: OriginalInstructionInput | null;
  attachment_ids: string[];
  ai_extraction: AiChangeEventExtraction | null;
  confirmed_extraction: ConfirmedChangeEvent | null;
  latest_assessment_id: string | null;
  ai_suggestion: AiSuggestion | null;
  deterministic_estimate: DeterministicEstimate | null;
  qs_decision: QsDecision;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface LifecycleHistoryEntry {
  id: string;
  project_id: string;
  case_id: string;
  from_status: VariationLifecycleStatus | null;
  to_status: VariationLifecycleStatus;
  changed_by: string;
  changed_at: string;
  reason: string | null;
  notes: string | null;
  tracking_snapshot: Record<string, unknown>;
}

export interface EvidencePackRecord {
  id: string;
  project_id: string;
  case_id: string;
  variation_reference: string;
  title: string;
  filename: string;
  storage_uri: string;
  storage_relative_path: string;
  content_sha256: string;
  size_bytes: number;
  page_count: number;
  is_draft: boolean;
  status_label: string;
  lifecycle_status_at_generation: VariationLifecycleStatus;
  qs_review_status_at_generation: ReviewStatus;
  assessment_id: string | null;
  prepared_by: string;
  project_name: string | null;
  subcontractor_name: string | null;
  is_demo: boolean;
  generated_at: string;
}

export interface GenerateReportRequest {
  prepared_by: string;
  project_name: string | null;
  subcontractor_name: string | null;
  variation_reference: string | null;
}

export interface LifecycleTransitionRequest {
  target_status: VariationLifecycleStatus;
  responsible_person: string;
  reason?: string | null;
  project_name?: string | null;
  subcontractor_name?: string | null;
  variation_reference?: string | null;
  submission_reference?: string | null;
  submission_date?: string | null;
  recipient?: string | null;
  claimed_amount?: string | null;
  approved_amount?: string | null;
  billed_amount?: string | null;
  paid_amount?: string | null;
  execution_status?: string | null;
  invoice_reference?: string | null;
  payment_status?: string | null;
  payment_date?: string | null;
  notes?: string | null;
  supporting_document_ids?: string[] | null;
}

export interface CommercialTrackingUpdateRequest {
  updated_by: string;
  notes_reason?: string | null;
  project_name?: string | null;
  subcontractor_name?: string | null;
  variation_reference?: string | null;
  responsible_person?: string | null;
  submission_reference?: string | null;
  submission_date?: string | null;
  recipient?: string | null;
  claimed_amount?: string | null;
  approved_amount?: string | null;
  billed_amount?: string | null;
  paid_amount?: string | null;
  execution_status?: string | null;
  invoice_reference?: string | null;
  payment_status?: string | null;
  payment_date?: string | null;
  notes?: string | null;
  supporting_document_ids?: string[] | null;
}

export interface LifecycleTransitionResponse {
  case: VariationCase;
  history_entry: LifecycleHistoryEntry;
}

export interface CurrencyCommercialSummary {
  currency: string;
  potential_variation_value: string;
  proposed_total: string;
  approved_total: string;
  approved_unbilled_total: string;
  billed_total: string;
  billed_unpaid_total: string;
  paid_total: string;
  proposed_case_count: number;
  approved_case_count: number;
  billed_case_count: number;
  paid_case_count: number;
  unpriced_case_count: number;
}

export interface DashboardMetricsResponse {
  project_id: string | null;
  total_cases: number;
  live_case_count: number;
  demo_case_count: number;
  contains_demo_data: boolean;
  demo_label: string | null;
  status_counts: Record<string, number>;
  awaiting_qs_review_count: number;
  drafted_not_submitted_count: number;
  submitted_awaiting_response_count: number;
  approved_not_billed_count: number;
  billed_unpaid_count: number;
  incomplete_evidence_count: number;
  amounts_by_currency: CurrencyCommercialSummary[];
  disclaimer: string;
}

export interface HealthResponse {
  status: "ok";
  app: string;
  version: string;
  environment: string;
  storage_backend: string;
  storage_ready: boolean;
  gemini_configured: boolean;
}
