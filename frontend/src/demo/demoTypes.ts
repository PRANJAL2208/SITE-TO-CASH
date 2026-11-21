export type DemoRole = "contractor" | "client";

export type ContractorPageId =
  | "dashboard"
  | "project"
  | "inbox"
  | "ai_intelligence"
  | "variation"
  | "approval_workflow"
  | "progress"
  | "delays"
  | "billing"
  | "live_engine";

export type ClientPageId =
  | "client_dashboard"
  | "client_variations"
  | "client_progress"
  | "client_delays_billing"
  | "live_engine";

export type DemoInstructionChannel =
  | "whatsapp"
  | "email"
  | "meeting_minutes"
  | "voice_transcript"
  | "site_note"
  | "photo";

export type DemoClassificationCategory =
  | "existing_scope"
  | "potential_variation"
  | "insufficient_evidence"
  | "approval_or_notice_missing"
  | "ambiguous";

export type DemoVariationStatus =
  | "detected"
  | "qs_review"
  | "ready_for_contractor_approval"
  | "contractor_approved"
  | "submitted_to_client"
  | "clarification_requested"
  | "partially_approved"
  | "client_approved"
  | "client_rejected"
  | "executed"
  | "billed"
  | "paid";

export interface DemoContact {
  id: string;
  name: string;
  role: string;
  organization: string;
  party: DemoRole;
  email: string;
  phone: string;
  authorityNote: string;
}

export interface DemoContractDocument {
  id: string;
  projectId: string;
  title: string;
  documentType: "Subcontract Agreement" | "BOQ Workbook" | "IFC Drawing" | "Specification";
  pagesOrSheets: string;
  keyClauseOrNote: string;
  uploadedAt: string;
}

export interface DemoBoqRow {
  id: string;
  projectId: string;
  sheetName: string;
  rowNumber: number;
  itemCode: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
}

export interface DemoEvidenceItem {
  id: string;
  title: string;
  kind: "site_photo" | "ceiling_markup" | "whatsapp_screenshot" | "clause_excerpt";
  caption: string;
  location: string;
  capturedAt: string;
  capturedBy: string;
  sourceRef: string;
}

export interface DemoInstruction {
  id: string;
  projectId: string;
  channel: DemoInstructionChannel;
  senderName: string;
  senderRole: string;
  recipient: string;
  receivedAt: string;
  subjectOrThread: string;
  originalText: string;
  attachmentNames: string[];
  linkedVariationId: string | null;
  aiAnalyzed: boolean;
  aiAnalyzedAt: string | null;
  qsConfirmed: boolean;
  qsConfirmedBy: string | null;
  qsConfirmedAt: string | null;
}

export interface DemoAiAssessment {
  origin: "ai_suggestion";
  classification: DemoClassificationCategory;
  confidenceLabel: "High (evidence-backed)" | "Moderate (requires verification)" | "Low (missing proof)";
  confidencePercent: number;
  instructionSummary: string;
  projectAndLocation: string;
  affectedTrade: string;
  potentialScopeChange: string;
  scopeComparisonNote: string;
  existingBoqReferences: Array<{
    refId: string;
    sheetAndRow: string;
    itemCode: string;
    description: string;
    unit: string | null;
    baseRate: number | null;
  }>;
  relevantContractClauses: Array<{
    refId: string;
    clauseRef: string;
    title: string;
    excerpt: string;
    pageRef: string;
  }>;
  potentialCostImpactSummary: string;
  potentialScheduleImpactSummary: string;
  missingInformation: string[];
  approvalRequirements: string[];
  evidenceReferences: Array<{
    sourceLabel: string;
    verbatimExcerpt: string;
  }>;
  uncertaintyIndicators: string[];
  qsNotes: string;
  qsEditedSummary: string | null;
}

export interface DemoCostLine {
  id: string;
  description: string;
  category: "Material" | "Labour" | "Equipment" | "Subcontract" | "Credit / Omission";
  lineType: "addition" | "deduction";
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  quantitySource: string;
  rateSource: string;
  boqRef: string | null;
  verified: boolean;
}

export interface DemoContractorApprovalState {
  step:
    | "ai_draft_ready"
    | "qs_confirmed"
    | "approver_approved"
    | "approver_changes_requested"
    | "approver_rejected"
    | "dispatched_simulated";
  qsReviewer: string | null;
  qsReviewedAt: string | null;
  approverName: string | null;
  approverRole: string | null;
  approvedAt: string | null;
  approverNotes: string | null;
  dispatchedAt: string | null;
  noticeSubject: string;
  recipientName: string;
  recipientEmail: string;
  emailBody: string;
  attachedDocs: string[];
}

export interface DemoClientDecisionState {
  decision: "pending" | "accepted" | "partially_approved" | "rejected" | "clarification_requested";
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  partialAmount: number | null;
}

export interface DemoVariation {
  id: string;
  projectId: string;
  instructionId: string;
  title: string;
  trade: string;
  floorLocation: string;
  status: DemoVariationStatus;
  scopeComparison: string;
  contractorJustification: string;
  scheduleImpactDays: number | null;
  scheduleImpactNote: string;
  applyTaxPercent: number | null;
  costLines: DemoCostLine[];
  proposedAmount: number | null;
  revisedAmount: number | null;
  approvedAmount: number | null;
  executedAmount: number | null;
  billedAmount: number | null;
  paidAmount: number | null;
  missingEvidence: string[];
  evidenceItems: DemoEvidenceItem[];
  aiAssessment: DemoAiAssessment;
  contractorApproval: DemoContractorApprovalState;
  clientDecision: DemoClientDecisionState;
  submittedDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoProgressEntry {
  id: string;
  projectId: string;
  variationId: string | null;
  workDescription: string;
  floorLocation: string;
  completionPercent: number;
  date: string;
  submittedBy: string;
  photoKind: "site_photo" | "ceiling_markup";
  photoCaption: string;
  supportingDocs: string[];
  clientNotificationPreview: string;
  clientAcknowledgedReceipt: boolean;
  clientAcknowledgedBy: string | null;
  clientAcknowledgedAt: string | null;
  clientComments: Array<{
    id: string;
    author: string;
    text: string;
    timestamp: string;
    kind: "comment" | "info_request";
  }>;
}

export interface DemoDelayItem {
  id: string;
  projectId: string;
  title: string;
  category:
    | "Site Obstruction"
    | "Drawing Revision Delay"
    | "Material Lead Time"
    | "Pending Client Decision"
    | "Delayed Approval";
  status: "open" | "client_responded" | "mitigated";
  raisedBy: string;
  raisedAt: string;
  dueDate: string;
  isOverdue: boolean;
  affectedMilestone: string;
  potentialDaysImpact: number;
  description: string;
  supportingEvidence: string;
  draftNoticeText: string;
  clientResponse: string | null;
}

export interface DemoMilestone {
  id: string;
  projectId: string;
  sequence: number;
  name: string;
  targetDate: string;
  paymentPercent: number;
  scheduledValue: number;
  status: "completed" | "in_progress" | "at_risk" | "upcoming";
  notes: string;
}

export interface DemoInvoice {
  id: string;
  projectId: string;
  variationId: string | null;
  milestoneName: string;
  description: string;
  amount: number;
  submittedDate: string;
  dueDate: string;
  status: "submitted" | "client_verified" | "paid" | "overdue";
  paidDate: string | null;
  paymentRef: string | null;
  overdueReminderPreview: string | null;
}

export interface DemoNotification {
  id: string;
  projectId: string;
  targetRole: DemoRole | "both";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  linkPageContractor?: ContractorPageId;
  linkPageClient?: ClientPageId;
  entityId?: string;
}

export interface DemoActivityEvent {
  id: string;
  projectId: string;
  timestamp: string;
  actor: string;
  actorRole: "Contractor" | "Client" | "AI Suggestion" | "Demo System";
  title: string;
  detail: string;
  entityId: string;
}

export interface DemoProject {
  id: string;
  name: string;
  code: string;
  location: string;
  projectType: string;
  trade: string;
  contractor: string;
  client: string;
  currencySymbol: string;
  baseContractValue: number;
  overallProgressPercent: number;
  targetCompletionDate: string;
  status: "Active Construction" | "MEP Rough-In";
}

export interface DemoState {
  role: DemoRole;
  contractorPage: ContractorPageId;
  clientPage: ClientPageId;
  selectedProjectId: string;
  selectedInstructionId: string;
  selectedVariationId: string;
  projects: DemoProject[];
  contacts: DemoContact[];
  documents: DemoContractDocument[];
  boqRows: DemoBoqRow[];
  instructions: DemoInstruction[];
  variations: DemoVariation[];
  progressEntries: DemoProgressEntry[];
  delays: DemoDelayItem[];
  milestones: DemoMilestone[];
  invoices: DemoInvoice[];
  notifications: DemoNotification[];
  activities: DemoActivityEvent[];
}
