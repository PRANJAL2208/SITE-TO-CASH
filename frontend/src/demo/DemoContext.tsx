import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { computeDemoCostSummary, createInitialDemoState } from "./demoSeed";
import type {
  ClientPageId,
  ContractorPageId,
  DemoClassificationCategory,
  DemoCostLine,
  DemoDelayItem,
  DemoInstruction,
  DemoInstructionChannel,
  DemoMilestone,
  DemoProgressEntry,
  DemoRole,
  DemoState,
  DemoVariation,
} from "./demoTypes";

const STORAGE_KEY = "site_to_cash_panel_demo_v1";

function nowStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} IST`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadPersistedState(): DemoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialDemoState();
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.variations)) {
      return createInitialDemoState();
    }
    return {
      ...createInitialDemoState(),
      ...parsed,
    };
  } catch {
    return createInitialDemoState();
  }
}

export interface DemoContextValue {
  state: DemoState;
  setRole: (role: DemoRole) => void;
  setContractorPage: (page: ContractorPageId) => void;
  setClientPage: (page: ClientPageId) => void;
  setSelectedProjectId: (projectId: string) => void;
  selectInstruction: (instructionId: string) => void;
  openVariation: (variationId: string, roleOverride?: DemoRole) => void;
  resetDemo: () => void;

  submitDemoInstruction: (params: {
    projectId: string;
    channel: DemoInstructionChannel;
    senderName: string;
    senderRole: string;
    subjectOrThread: string;
    originalText: string;
    attachmentNames: string[];
  }) => { instructionId: string; variationId: string };

  runDemoAiAnalysis: (instructionId: string) => void;

  confirmDemoQsExtraction: (params: {
    instructionId: string;
    reviewerName: string;
    editedSummary: string;
    classification: DemoClassificationCategory;
    qsNotes: string;
  }) => void;

  updateDemoVariationCostLines: (params: {
    variationId: string;
    costLines: DemoCostLine[];
    applyTaxPercent: number | null;
    scheduleImpactDays: number | null;
    scheduleImpactNote: string;
    qsNotes: string;
  }) => void;

  reviewContractorDraft: (params: {
    variationId: string;
    action: "confirm_qs" | "approve" | "request_changes" | "reject";
    actorName: string;
    notes: string;
  }) => void;

  dispatchContractorNotice: (params: {
    variationId: string;
    subject: string;
    recipientEmail: string;
    emailBody: string;
  }) => void;

  recordClientDecision: (params: {
    variationId: string;
    decision: "accepted" | "partially_approved" | "rejected" | "clarification_requested";
    decidedBy: string;
    comment: string;
    partialAmount: number | null;
  }) => void;

  addProgressUpdate: (params: {
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
    markVariationExecuted: boolean;
  }) => void;

  acknowledgeProgressReceipt: (progressId: string, clientName: string) => void;
  addProgressComment: (
    progressId: string,
    author: string,
    text: string,
    kind: "comment" | "info_request"
  ) => void;

  createDemoDelayNotice: (params: {
    projectId: string;
    title: string;
    category: DemoDelayItem["category"];
    dueDate: string;
    affectedMilestone: string;
    potentialDaysImpact: number;
    description: string;
    supportingEvidence: string;
    draftNoticeText: string;
    raisedBy: string;
  }) => void;

  respondToDelay: (delayId: string, clientResponse: string, resolveStatus: DemoDelayItem["status"]) => void;

  raiseDemoInvoice: (params: {
    projectId: string;
    variationId: string | null;
    milestoneName: string;
    description: string;
    amount: number;
    dueDate: string;
  }) => void;

  updateMilestoneStatus: (milestoneId: string, status: DemoMilestone["status"]) => void;

  updateInvoicePaymentStatus: (params: {
    invoiceId: string;
    status: "client_verified" | "paid";
    paymentRef: string;
  }) => void;

  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => loadPersistedState());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors in demo mode
    }
  }, [state]);

  const setRole = (role: DemoRole) => {
    setState((prev) => ({
      ...prev,
      role,
    }));
  };

  const setContractorPage = (page: ContractorPageId) => {
    setState((prev) => ({
      ...prev,
      role: "contractor",
      contractorPage: page,
    }));
  };

  const setClientPage = (page: ClientPageId) => {
    setState((prev) => ({
      ...prev,
      role: "client",
      clientPage: page,
    }));
  };

  const setSelectedProjectId = (projectId: string) => {
    setState((prev) => {
      const projVars = prev.variations.filter((v) => v.projectId === projectId);
      const projInstr = prev.instructions.filter((i) => i.projectId === projectId);
      return {
        ...prev,
        selectedProjectId: projectId,
        selectedVariationId: projVars[0]?.id ?? prev.selectedVariationId,
        selectedInstructionId: projInstr[0]?.id ?? prev.selectedInstructionId,
      };
    });
  };

  const selectInstruction = (instructionId: string) => {
    setState((prev) => {
      const instr = prev.instructions.find((i) => i.id === instructionId);
      return {
        ...prev,
        selectedInstructionId: instructionId,
        selectedVariationId: instr?.linkedVariationId ?? prev.selectedVariationId,
      };
    });
  };

  const openVariation = (variationId: string, roleOverride?: DemoRole) => {
    setState((prev) => {
      const variation = prev.variations.find((v) => v.id === variationId);
      const nextRole = roleOverride ?? prev.role;
      return {
        ...prev,
        role: nextRole,
        selectedVariationId: variationId,
        selectedInstructionId: variation?.instructionId ?? prev.selectedInstructionId,
        contractorPage: nextRole === "contractor" ? "variation" : prev.contractorPage,
        clientPage: nextRole === "client" ? "client_variations" : prev.clientPage,
      };
    });
  };

  const resetDemo = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    setState(createInitialDemoState());
  };

  const submitDemoInstruction: DemoContextValue["submitDemoInstruction"] = (params) => {
    const suffix = String(state.instructions.length + 1).padStart(3, "0");
    const instructionId = `INS-${suffix}`;
    const variationId = `VAR-SCT-${suffix}`;
    const ts = nowStamp();

    const lower = params.originalText.toLowerCase();
    const isHvac = lower.includes("hvac") || lower.includes("duct");
    const isAmbiguous = lower.includes("maybe") || lower.includes("unclear") || lower.includes("some");
    const isElec = lower.includes("light") || lower.includes("cable") || lower.includes("electrical");

    const detectedTrade = isHvac
      ? "HVAC Ducting & Controls"
      : isElec
        ? "Electrical Distribution & Lighting"
        : "MEP General Services";

    const newInstruction: DemoInstruction = {
      id: instructionId,
      projectId: params.projectId,
      channel: params.channel,
      senderName: params.senderName,
      senderRole: params.senderRole,
      recipient: "Apex MEP Site Team",
      receivedAt: ts,
      subjectOrThread: params.subjectOrThread,
      originalText: params.originalText,
      attachmentNames: params.attachmentNames,
      linkedVariationId: variationId,
      aiAnalyzed: false,
      aiAnalyzedAt: null,
      qsConfirmed: false,
      qsConfirmedBy: null,
      qsConfirmedAt: null,
    };

    const defaultQty = isAmbiguous ? null : isElec ? 12 : 25;
    const defaultRate = isHvac ? 2400 : isElec ? 1850 : null;
    const defaultUnit = isElec ? "nr" : isHvac ? "sqm" : "lot";

    const lines: DemoCostLine[] = [
      {
        id: `cl-${suffix}-1`,
        description: params.originalText.slice(0, 72) + (params.originalText.length > 72 ? "..." : ""),
        category: "Material",
        lineType: "addition",
        unit: defaultUnit,
        quantity: defaultQty,
        rate: defaultRate,
        quantitySource: isAmbiguous ? "MISSING — unclear in voice note" : "Extracted instruction count",
        rateSource: defaultRate !== null ? "BOQ Reference Rate" : "MISSING — quote needed",
        boqRef: isHvac ? "Sheet 'HVAC Ducting BOQ', Row 18" : null,
        verified: false,
      },
    ];
    const summary = computeDemoCostSummary(lines, null);

    const newVariation: DemoVariation = {
      id: variationId,
      projectId: params.projectId,
      instructionId,
      title: params.subjectOrThread || `Site Instruction ${instructionId}`,
      trade: detectedTrade,
      floorLocation: isHvac ? "Second Floor" : "Project Floor Area",
      status: "detected",
      scopeComparison:
        "Pending AI Change Intelligence run against Subcontract PDF and BOQ workbook.",
      contractorJustification: "Captured in Instruction Inbox; awaiting AI analysis and QS confirmation.",
      scheduleImpactDays: isAmbiguous ? null : 3,
      scheduleImpactNote: "Preliminary schedule impact pending site verification.",
      applyTaxPercent: null,
      costLines: lines,
      proposedAmount: summary.totalAmount,
      revisedAmount: null,
      approvedAmount: null,
      executedAmount: null,
      billedAmount: null,
      paidAmount: null,
      missingEvidence: [
        "Written Client Variation Order (Clause 4.2)",
        ...(isAmbiguous ? ["Exact scope quantity and floor coordinates unclear in instruction"] : []),
      ],
      evidenceItems: [
        {
          id: `ev-${suffix}-1`,
          title: `Captured ${params.channel.replace(/_/g, " ")} record`,
          kind: "whatsapp_screenshot",
          caption: params.originalText,
          location: params.subjectOrThread,
          capturedAt: ts,
          capturedBy: params.senderName,
          sourceRef: `Instruction ${instructionId}`,
        },
      ],
      aiAssessment: {
        origin: "ai_suggestion",
        classification: isAmbiguous ? "ambiguous" : "approval_or_notice_missing",
        confidenceLabel: isAmbiguous ? "Low (missing proof)" : "Moderate (requires verification)",
        confidencePercent: isAmbiguous ? 54 : 84,
        instructionSummary: params.originalText,
        projectAndLocation: `${params.projectId === "proj-skyline" ? "Skyline Commercial Tower" : "Nexus Medical Centre"}`,
        affectedTrade: detectedTrade,
        potentialScopeChange: isAmbiguous
          ? "Ambiguous wording — confirm scope boundary and authority before claiming variation."
          : "Informal direction appears additional to IFC drawings; formal written order missing.",
        scopeComparisonNote:
          "Compare requested modification against IFC Drawings Appendix B and BOQ Schedule.",
        existingBoqReferences: isHvac
          ? [
              {
                refId: "B1",
                sheetAndRow: "Sheet 'HVAC Ducting BOQ', Row 18",
                itemCode: "HVAC-2.04",
                description: "24G GI acoustic-lined rectangular ducting",
                unit: "sqm",
                baseRate: 2400,
              },
            ]
          : [],
        relevantContractClauses: [
          {
            refId: "C1",
            clauseRef: "Clause 4.2",
            title: "Written Variation Authority",
            excerpt: "Informal site directions require written authorization by Authorized Client Approver.",
            pageRef: "Subcontract PDF, Page 11",
          },
          {
            refId: "C2",
            clauseRef: "Clause 8.3",
            title: "7-Day Variation Notice",
            excerpt: "Preliminary notice due within 7 days of instruction.",
            pageRef: "Subcontract PDF, Page 19",
          },
        ],
        potentialCostImpactSummary:
          summary.totalAmount !== null
            ? `Preliminary calc ₹${summary.totalAmount.toLocaleString("en-IN")} excl. GST (requires QS review).`
            : "Cannot total yet — missing quantity or unit rate preserved as null.",
        potentialScheduleImpactSummary: "3 working days potential exposure (to be verified by QS/PM).",
        missingInformation: [
          "Written Variation Order under Clause 4.2",
          ...(defaultRate === null ? ["Unit rate not found in BOQ — must be quoted by QS"] : []),
          ...(defaultQty === null ? ["Exact numerical quantity unspecified in instruction"] : []),
        ],
        approvalRequirements: [
          "QS verification & rate confirmation",
          "Contractor Commercial Director review",
          "Client Authorized Commercial Approver sign-off",
        ],
        evidenceReferences: [
          {
            sourceLabel: `Instruction ${instructionId}`,
            verbatimExcerpt: params.originalText,
          },
        ],
        uncertaintyIndicators: [
          "AI suggestion only — does not determine legal entitlement.",
        ],
        qsNotes: "",
        qsEditedSummary: null,
      },
      contractorApproval: {
        step: "ai_draft_ready",
        qsReviewer: null,
        qsReviewedAt: null,
        approverName: null,
        approverRole: null,
        approvedAt: null,
        approverNotes: null,
        dispatchedAt: null,
        noticeSubject: `[Clause 8.3 Notice] ${variationId}: ${params.subjectOrThread}`,
        recipientName: "Siddharth Rao & Vikram Malhotra (Skyline Developers)",
        recipientEmail: "siddharth.commercial@skylinedev.demo",
        emailBody: `Dear Client Commercial Team,\n\nPlease find formal potential variation notice ${variationId} regarding instruction ${instructionId}:\n"${params.originalText}"\n\nPlease issue written CVO confirmation per Clause 4.2.\n\nRegards,\nApex MEP Contractors`,
        attachedDocs: [`${variationId}_Draft_Evidence_Pack.pdf`, ...params.attachmentNames],
      },
      clientDecision: {
        decision: "pending",
        decidedBy: null,
        decidedAt: null,
        comment: null,
        partialAmount: null,
      },
      submittedDate: null,
      createdAt: ts,
      updatedAt: ts,
    };

    setState((prev) => ({
      ...prev,
      selectedInstructionId: instructionId,
      selectedVariationId: variationId,
      instructions: [newInstruction, ...prev.instructions],
      variations: [newVariation, ...prev.variations],
      activities: [
        {
          id: `act-${Date.now()}`,
          projectId: params.projectId,
          timestamp: ts,
          actor: params.senderName,
          actorRole: "Contractor",
          title: `Instruction Captured (${instructionId})`,
          detail: params.originalText,
          entityId: instructionId,
        },
        ...prev.activities,
      ],
    }));

    return { instructionId, variationId };
  };

  const runDemoAiAnalysis = (instructionId: string) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.instructions.find((i) => i.id === instructionId);
      return {
        ...prev,
        selectedInstructionId: instructionId,
        selectedVariationId: target?.linkedVariationId ?? prev.selectedVariationId,
        instructions: prev.instructions.map((ins) =>
          ins.id === instructionId
            ? { ...ins, aiAnalyzed: true, aiAnalyzedAt: ts }
            : ins
        ),
        activities: target
          ? [
              {
                id: `act-${Date.now()}`,
                projectId: target.projectId,
                timestamp: ts,
                actor: "Site-to-Cash AI (Demo)",
                actorRole: "AI Suggestion",
                title: `AI Change Intelligence Analysed ${instructionId}`,
                detail:
                  "Extracted scope, Clauses 4.2/8.3/1.4, BOQ links, and flagged missing written authority.",
                entityId: target.linkedVariationId ?? instructionId,
              },
              ...prev.activities,
            ]
          : prev.activities,
      };
    });
  };

  const confirmDemoQsExtraction: DemoContextValue["confirmDemoQsExtraction"] = (params) => {
    const ts = nowStamp();
    setState((prev) => {
      const instr = prev.instructions.find((i) => i.id === params.instructionId);
      const linkedVarId = instr?.linkedVariationId ?? null;
      return {
        ...prev,
        instructions: prev.instructions.map((i) =>
          i.id === params.instructionId
            ? {
                ...i,
                qsConfirmed: true,
                qsConfirmedBy: params.reviewerName,
                qsConfirmedAt: ts,
              }
            : i
        ),
        variations: prev.variations.map((v) =>
          v.id === linkedVarId
            ? {
                ...v,
                status: v.status === "detected" ? "qs_review" : v.status,
                updatedAt: ts,
                aiAssessment: {
                  ...v.aiAssessment,
                  classification: params.classification,
                  qsNotes: params.qsNotes,
                  qsEditedSummary: params.editedSummary,
                },
              }
            : v
        ),
        activities: instr
          ? [
              {
                id: `act-${Date.now()}`,
                projectId: instr.projectId,
                timestamp: ts,
                actor: params.reviewerName,
                actorRole: "Contractor",
                title: `QS Confirmed Extraction (${params.instructionId})`,
                detail: `Original instruction & AI suggestion preserved unchanged; QS set notes.`,
                entityId: linkedVarId ?? params.instructionId,
              },
              ...prev.activities,
            ]
          : prev.activities,
      };
    });
  };

  const updateDemoVariationCostLines: DemoContextValue["updateDemoVariationCostLines"] = (
    params
  ) => {
    const ts = nowStamp();
    const calc = computeDemoCostSummary(params.costLines, params.applyTaxPercent);
    setState((prev) => {
      const target = prev.variations.find((v) => v.id === params.variationId);
      return {
        ...prev,
        variations: prev.variations.map((v) =>
          v.id === params.variationId
            ? {
                ...v,
                costLines: params.costLines,
                applyTaxPercent: params.applyTaxPercent,
                scheduleImpactDays: params.scheduleImpactDays,
                scheduleImpactNote: params.scheduleImpactNote,
                proposedAmount: v.proposedAmount ?? calc.totalAmount,
                revisedAmount: calc.totalAmount,
                updatedAt: ts,
                aiAssessment: {
                  ...v.aiAssessment,
                  qsNotes: params.qsNotes,
                },
                contractorApproval: {
                  ...v.contractorApproval,
                  emailBody: v.contractorApproval.emailBody.includes("Estimated Variation Cost:")
                    ? v.contractorApproval.emailBody.replace(
                        /Estimated Variation Cost:.*(\r?\n|$)/,
                        `Estimated Variation Cost: ${
                          calc.totalAmount !== null
                            ? `₹${calc.totalAmount.toLocaleString("en-IN")}${
                                params.applyTaxPercent !== null
                                  ? ` (incl. ${params.applyTaxPercent}% GST)`
                                  : " (excl. tax)"
                              }`
                            : "Incomplete / pending verified rates"
                        }\n`
                      )
                    : v.contractorApproval.emailBody,
                },
              }
            : v
        ),
        activities: target
          ? [
              {
                id: `act-${Date.now()}`,
                projectId: target.projectId,
                timestamp: ts,
                actor: "Rohan Deshmukh (QS)",
                actorRole: "Contractor",
                title: `Deterministic Cost Build-Up Updated (${target.id})`,
                detail: `Calculated revised total: ${
                  calc.totalAmount !== null
                    ? `₹${calc.totalAmount.toLocaleString("en-IN")}`
                    : "Partial / missing inputs"
                } (${calc.missingCount} missing line(s)).`,
                entityId: target.id,
              },
              ...prev.activities,
            ]
          : prev.activities,
      };
    });
  };

  const reviewContractorDraft: DemoContextValue["reviewContractorDraft"] = (params) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.variations.find((v) => v.id === params.variationId);
      if (!target) return prev;

      const updatedVariations = prev.variations.map((v) => {
        if (v.id !== params.variationId) return v;
        if (params.action === "confirm_qs") {
          return {
            ...v,
            status: "ready_for_contractor_approval" as const,
            updatedAt: ts,
            contractorApproval: {
              ...v.contractorApproval,
              step: "qs_confirmed" as const,
              qsReviewer: params.actorName,
              qsReviewedAt: ts,
            },
          };
        }
        if (params.action === "approve") {
          return {
            ...v,
            status: "contractor_approved" as const,
            updatedAt: ts,
            contractorApproval: {
              ...v.contractorApproval,
              step: "approver_approved" as const,
              approverName: params.actorName,
              approverRole: "Commercial Director (Authorized Approver)",
              approvedAt: ts,
              approverNotes: params.notes || "Cleared for formal client dispatch.",
            },
          };
        }
        if (params.action === "request_changes") {
          return {
            ...v,
            status: "qs_review" as const,
            updatedAt: ts,
            contractorApproval: {
              ...v.contractorApproval,
              step: "approver_changes_requested" as const,
              approverName: params.actorName,
              approverRole: "Commercial Director",
              approvedAt: ts,
              approverNotes: params.notes,
            },
          };
        }
        return {
          ...v,
          status: "qs_review" as const,
          updatedAt: ts,
          contractorApproval: {
            ...v.contractorApproval,
            step: "approver_rejected" as const,
            approverName: params.actorName,
            approverRole: "Commercial Director",
            approvedAt: ts,
            approverNotes: params.notes,
          },
        };
      });

      const actionLabel =
        params.action === "confirm_qs"
          ? "QS Signed Off Commercial Details"
          : params.action === "approve"
            ? "Authorized Approver Cleared Outgoing Notice"
            : params.action === "request_changes"
              ? "Approver Requested Changes to Draft Notice"
              : "Approver Rejected Outgoing Draft";

      return {
        ...prev,
        variations: updatedVariations,
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: params.actorName,
            actorRole: "Contractor",
            title: `${actionLabel} (${target.id})`,
            detail: params.notes || "Reviewed in Contractor Approval Workflow.",
            entityId: target.id,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const dispatchContractorNotice: DemoContextValue["dispatchContractorNotice"] = (
    params
  ) => {
    const ts = nowStamp();
    const today = todayIso();
    setState((prev) => {
      const target = prev.variations.find((v) => v.id === params.variationId);
      if (!target) return prev;
      return {
        ...prev,
        variations: prev.variations.map((v) =>
          v.id === params.variationId
            ? {
                ...v,
                status: "submitted_to_client",
                submittedDate: today,
                updatedAt: ts,
                proposedAmount: v.revisedAmount ?? v.proposedAmount,
                clientDecision: {
                  decision: "pending",
                  decidedBy: null,
                  decidedAt: null,
                  comment: null,
                  partialAmount: null,
                },
                contractorApproval: {
                  ...v.contractorApproval,
                  step: "dispatched_simulated",
                  dispatchedAt: ts,
                  noticeSubject: params.subject,
                  recipientEmail: params.recipientEmail,
                  emailBody: params.emailBody,
                },
              }
            : v
        ),
        notifications: [
          {
            id: `ntf-${Date.now()}`,
            projectId: target.projectId,
            targetRole: "client",
            title: `Variation Submitted: ${target.id}`,
            message: `Apex MEP Contractors submitted formal Variation Notice ${target.id} (${target.title}). Demo action — not sent via real email.`,
            timestamp: ts,
            read: false,
            linkPageClient: "client_variations",
            entityId: target.id,
          },
          ...prev.notifications,
        ],
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: target.contractorApproval.approverName ?? "Meera Nair",
            actorRole: "Demo System",
            title: `Variation Notice Marked Dispatched (${target.id})`,
            detail: `Demo action — not actually sent over SMTP. Now visible in Client Variation Review Inbox.`,
            entityId: target.id,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const recordClientDecision: DemoContextValue["recordClientDecision"] = (params) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.variations.find((v) => v.id === params.variationId);
      if (!target) return prev;

      const baseVal = target.revisedAmount ?? target.proposedAmount;
      const nextStatus =
        params.decision === "accepted"
          ? ("client_approved" as const)
          : params.decision === "partially_approved"
            ? ("partially_approved" as const)
            : params.decision === "rejected"
              ? ("client_rejected" as const)
              : ("clarification_requested" as const);

      const nextApproved =
        params.decision === "accepted"
          ? baseVal
          : params.decision === "partially_approved"
            ? params.partialAmount
            : null;

      const titleMap = {
        accepted: "Client Accepted Variation",
        partially_approved: "Client Partially Approved Variation",
        rejected: "Client Rejected Variation",
        clarification_requested: "Client Requested Clarification",
      };

      return {
        ...prev,
        variations: prev.variations.map((v) =>
          v.id === params.variationId
            ? {
                ...v,
                status: nextStatus,
                approvedAmount: nextApproved,
                updatedAt: ts,
                clientDecision: {
                  decision: params.decision,
                  decidedBy: params.decidedBy,
                  decidedAt: ts,
                  comment: params.comment,
                  partialAmount:
                    params.decision === "partially_approved" ? params.partialAmount : null,
                },
              }
            : v
        ),
        notifications: [
          {
            id: `ntf-${Date.now()}`,
            projectId: target.projectId,
            targetRole: "contractor",
            title: `${titleMap[params.decision]}: ${target.id}`,
            message: `${params.decidedBy}: ${params.comment || titleMap[params.decision]}`,
            timestamp: ts,
            read: false,
            linkPageContractor: "variation",
            entityId: target.id,
          },
          ...prev.notifications,
        ],
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: params.decidedBy,
            actorRole: "Client",
            title: `${titleMap[params.decision]} (${target.id})`,
            detail:
              params.comment ||
              (nextApproved !== null
                ? `Approved amount recorded: ₹${nextApproved.toLocaleString("en-IN")}.`
                : "Updated in Client Review Inbox."),
            entityId: target.id,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const addProgressUpdate: DemoContextValue["addProgressUpdate"] = (params) => {
    const ts = nowStamp();
    const progressId = `PRG-${String(state.progressEntries.length + 1).padStart(3, "0")}`;
    const newEntry: DemoProgressEntry = {
      id: progressId,
      projectId: params.projectId,
      variationId: params.variationId,
      workDescription: params.workDescription,
      floorLocation: params.floorLocation,
      completionPercent: params.completionPercent,
      date: params.date,
      submittedBy: params.submittedBy,
      photoKind: params.photoKind,
      photoCaption: params.photoCaption,
      supportingDocs: params.supportingDocs,
      clientNotificationPreview: `Demo Notification (simulated): ${params.submittedBy} logged ${params.completionPercent}% site progress at ${params.floorLocation}.`,
      clientAcknowledgedReceipt: false,
      clientAcknowledgedBy: null,
      clientAcknowledgedAt: null,
      clientComments: [],
    };

    setState((prev) => ({
      ...prev,
      progressEntries: [newEntry, ...prev.progressEntries],
      variations: params.variationId
        ? prev.variations.map((v) => {
            if (v.id !== params.variationId) return v;
            const execVal = v.approvedAmount ?? v.revisedAmount ?? v.proposedAmount;
            return {
              ...v,
              status: params.markVariationExecuted ? "executed" : v.status,
              executedAmount: params.markVariationExecuted ? execVal : v.executedAmount,
              updatedAt: ts,
            };
          })
        : prev.variations,
      projects: prev.projects.map((p) =>
        p.id === params.projectId
          ? {
              ...p,
              overallProgressPercent: Math.min(99, Math.max(p.overallProgressPercent, params.completionPercent >= 80 ? p.overallProgressPercent + 4 : p.overallProgressPercent + 2)),
            }
          : p
      ),
      notifications: [
        {
          id: `ntf-${Date.now()}`,
          projectId: params.projectId,
          targetRole: "client",
          title: `New Progress Evidence (${progressId})`,
          message: `${params.floorLocation} — ${params.completionPercent}% complete. View & acknowledge receipt in Client Progress View.`,
          timestamp: ts,
          read: false,
          linkPageClient: "client_progress",
          entityId: progressId,
        },
        ...prev.notifications,
      ],
      activities: [
        {
          id: `act-${Date.now()}`,
          projectId: params.projectId,
          timestamp: ts,
          actor: params.submittedBy,
          actorRole: "Contractor",
          title: `Progress Evidence Logged (${progressId})`,
          detail: `${params.workDescription} (${params.completionPercent}%${
            params.variationId && params.markVariationExecuted
              ? ` · Marked ${params.variationId} Executed`
              : ""
          }).`,
          entityId: params.variationId ?? progressId,
        },
        ...prev.activities,
      ],
    }));
  };

  const acknowledgeProgressReceipt = (progressId: string, clientName: string) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.progressEntries.find((p) => p.id === progressId);
      if (!target) return prev;
      return {
        ...prev,
        progressEntries: prev.progressEntries.map((p) =>
          p.id === progressId
            ? {
                ...p,
                clientAcknowledgedReceipt: true,
                clientAcknowledgedBy: clientName,
                clientAcknowledgedAt: ts,
              }
            : p
        ),
        notifications: [
          {
            id: `ntf-${Date.now()}`,
            projectId: target.projectId,
            targetRole: "contractor",
            title: `Client Acknowledged Receipt (${progressId})`,
            message: `${clientName} acknowledged receipt of progress evidence (note: receipt acknowledgement is not contractual approval).`,
            timestamp: ts,
            read: false,
            linkPageContractor: "progress",
            entityId: progressId,
          },
          ...prev.notifications,
        ],
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: clientName,
            actorRole: "Client",
            title: `Acknowledged Receipt Only (${progressId})`,
            detail: "Marked receipt acknowledged in Client Portal (does not constitute contractual approval).",
            entityId: progressId,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const addProgressComment: DemoContextValue["addProgressComment"] = (
    progressId,
    author,
    text,
    kind
  ) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.progressEntries.find((p) => p.id === progressId);
      if (!target) return prev;
      return {
        ...prev,
        progressEntries: prev.progressEntries.map((p) =>
          p.id === progressId
            ? {
                ...p,
                clientComments: [
                  ...p.clientComments,
                  { id: `cm-${Date.now()}`, author, text, timestamp: ts, kind },
                ],
              }
            : p
        ),
        notifications: [
          {
            id: `ntf-${Date.now()}`,
            projectId: target.projectId,
            targetRole: "contractor",
            title:
              kind === "info_request"
                ? `Client Requested Info on ${progressId}`
                : `Client Commented on ${progressId}`,
            message: `${author}: ${text}`,
            timestamp: ts,
            read: false,
            linkPageContractor: "progress",
            entityId: progressId,
          },
          ...prev.notifications,
        ],
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: author,
            actorRole: "Client",
            title:
              kind === "info_request"
                ? `Requested Additional Progress Info (${progressId})`
                : `Added Comment on Progress (${progressId})`,
            detail: text,
            entityId: progressId,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const createDemoDelayNotice: DemoContextValue["createDemoDelayNotice"] = (params) => {
    const ts = nowStamp();
    const delayId = `DLY-${String(state.delays.length + 1).padStart(3, "0")}`;
    const newDelay: DemoDelayItem = {
      id: delayId,
      projectId: params.projectId,
      title: params.title,
      category: params.category,
      status: "open",
      raisedBy: params.raisedBy,
      raisedAt: todayIso(),
      dueDate: params.dueDate,
      isOverdue: false,
      affectedMilestone: params.affectedMilestone,
      potentialDaysImpact: params.potentialDaysImpact,
      description: params.description,
      supportingEvidence: params.supportingEvidence,
      draftNoticeText: params.draftNoticeText,
      clientResponse: null,
    };

    setState((prev) => ({
      ...prev,
      delays: [newDelay, ...prev.delays],
      notifications: [
        {
          id: `ntf-${Date.now()}`,
          projectId: params.projectId,
          targetRole: "client",
          title: `Delay Notification Logged: ${delayId}`,
          message: `${params.title} (Potential impact: ${params.potentialDaysImpact} days on ${params.affectedMilestone}).`,
          timestamp: ts,
          read: false,
          linkPageClient: "client_delays_billing",
          entityId: delayId,
        },
        ...prev.notifications,
      ],
      activities: [
        {
          id: `act-${Date.now()}`,
          projectId: params.projectId,
          timestamp: ts,
          actor: params.raisedBy,
          actorRole: "Contractor",
          title: `Delay Notice Prepared (${delayId})`,
          detail: params.title,
          entityId: delayId,
        },
        ...prev.activities,
      ],
    }));
  };

  const respondToDelay: DemoContextValue["respondToDelay"] = (
    delayId,
    clientResponse,
    resolveStatus
  ) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.delays.find((d) => d.id === delayId);
      if (!target) return prev;
      return {
        ...prev,
        delays: prev.delays.map((d) =>
          d.id === delayId
            ? { ...d, clientResponse, status: resolveStatus, isOverdue: false }
            : d
        ),
        notifications: [
          {
            id: `ntf-${Date.now()}`,
            projectId: target.projectId,
            targetRole: "contractor",
            title: `Client Responded to ${delayId}`,
            message: clientResponse,
            timestamp: ts,
            read: false,
            linkPageContractor: "delays",
            entityId: delayId,
          },
          ...prev.notifications,
        ],
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: "Vikram Malhotra (Client PM)",
            actorRole: "Client",
            title: `Updated Delay Response (${delayId})`,
            detail: clientResponse,
            entityId: delayId,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const raiseDemoInvoice: DemoContextValue["raiseDemoInvoice"] = (params) => {
    const ts = nowStamp();
    const invoiceId = `INV-SCT-${101 + state.invoices.length}`;
    const today = todayIso();
    setState((prev) => ({
      ...prev,
      invoices: [
        {
          id: invoiceId,
          projectId: params.projectId,
          variationId: params.variationId,
          milestoneName: params.milestoneName,
          description: params.description,
          amount: params.amount,
          submittedDate: today,
          dueDate: params.dueDate,
          status: "submitted",
          paidDate: null,
          paymentRef: null,
          overdueReminderPreview: null,
        },
        ...prev.invoices,
      ],
      variations: params.variationId
        ? prev.variations.map((v) =>
            v.id === params.variationId
              ? {
                  ...v,
                  status: "billed",
                  billedAmount: params.amount,
                  updatedAt: ts,
                }
              : v
          )
        : prev.variations,
      notifications: [
        {
          id: `ntf-${Date.now()}`,
          projectId: params.projectId,
          targetRole: "client",
          title: `New Variation Invoice Submitted: ${invoiceId}`,
          message: `${params.description} — ₹${params.amount.toLocaleString("en-IN")} due ${params.dueDate}.`,
          timestamp: ts,
          read: false,
          linkPageClient: "client_delays_billing",
          entityId: invoiceId,
        },
        ...prev.notifications,
      ],
      activities: [
        {
          id: `act-${Date.now()}`,
          projectId: params.projectId,
          timestamp: ts,
          actor: "Rohan Deshmukh (QS)",
          actorRole: "Contractor",
          title: `Invoice Raised (${invoiceId})`,
          detail: `${params.description} — ₹${params.amount.toLocaleString("en-IN")}.`,
          entityId: params.variationId ?? invoiceId,
        },
        ...prev.activities,
      ],
    }));
  };

  const updateMilestoneStatus: DemoContextValue["updateMilestoneStatus"] = (
    milestoneId,
    status
  ) => {
    const ts = nowStamp();
    setState((prev) => {
      const target = prev.milestones.find((m) => m.id === milestoneId);
      if (!target) return prev;
      return {
        ...prev,
        milestones: prev.milestones.map((m) =>
          m.id === milestoneId ? { ...m, status } : m
        ),
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: prev.role === "contractor" ? "Rohan Deshmukh (QS)" : "Siddharth Rao",
            actorRole: prev.role === "contractor" ? "Contractor" : "Client",
            title: `Milestone Updated (${target.name})`,
            detail: `Status marked '${status.replace(/_/g, " ")}'.`,
            entityId: target.id,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const updateInvoicePaymentStatus: DemoContextValue["updateInvoicePaymentStatus"] = (
    params
  ) => {
    const ts = nowStamp();
    const today = todayIso();
    setState((prev) => {
      const target = prev.invoices.find((inv) => inv.id === params.invoiceId);
      if (!target) return prev;
      return {
        ...prev,
        invoices: prev.invoices.map((inv) =>
          inv.id === params.invoiceId
            ? {
                ...inv,
                status: params.status,
                paidDate: params.status === "paid" ? today : inv.paidDate,
                paymentRef:
                  params.status === "paid"
                    ? params.paymentRef || `NEFT-DEMO-${inv.id.slice(-3)}`
                    : inv.paymentRef,
              }
            : inv
        ),
        variations:
          target.variationId && params.status === "paid"
            ? prev.variations.map((v) =>
                v.id === target.variationId
                  ? {
                      ...v,
                      status: "paid",
                      paidAmount: target.amount,
                      updatedAt: ts,
                    }
                  : v
              )
            : prev.variations,
        notifications: [
          {
            id: `ntf-${Date.now()}`,
            projectId: target.projectId,
            targetRole: "contractor",
            title:
              params.status === "paid"
                ? `Payment Recorded (${target.id})`
                : `Client Verified Invoice (${target.id})`,
            message:
              params.status === "paid"
                ? `Client recorded settlement of ₹${target.amount.toLocaleString("en-IN")} (Ref: ${params.paymentRef || "Demo EFT"}).`
                : `Client commercial team verified invoice ${target.id} for payment run.`,
            timestamp: ts,
            read: false,
            linkPageContractor: "billing",
            entityId: target.id,
          },
          ...prev.notifications,
        ],
        activities: [
          {
            id: `act-${Date.now()}`,
            projectId: target.projectId,
            timestamp: ts,
            actor: "Siddharth Rao (Client Approver)",
            actorRole: "Client",
            title:
              params.status === "paid"
                ? `Recorded Payment (${target.id})`
                : `Verified Invoice (${target.id})`,
            detail: `₹${target.amount.toLocaleString("en-IN")} — ${target.description}`,
            entityId: target.variationId ?? target.id,
          },
          ...prev.activities,
        ],
      };
    });
  };

  const markNotificationRead = (notificationId: string) => {
    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n
      ),
    }));
  };

  const markAllNotificationsRead = () => {
    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.targetRole === prev.role || n.targetRole === "both"
          ? { ...n, read: true }
          : n
      ),
    }));
  };

  return (
    <DemoContext.Provider
      value={{
        state,
        setRole,
        setContractorPage,
        setClientPage,
        setSelectedProjectId,
        selectInstruction,
        openVariation,
        resetDemo,
        submitDemoInstruction,
        runDemoAiAnalysis,
        confirmDemoQsExtraction,
        updateDemoVariationCostLines,
        reviewContractorDraft,
        dispatchContractorNotice,
        recordClientDecision,
        addProgressUpdate,
        acknowledgeProgressReceipt,
        addProgressComment,
        createDemoDelayNotice,
        respondToDelay,
        raiseDemoInvoice,
        updateMilestoneStatus,
        updateInvoicePaymentStatus,
        markNotificationRead,
        markAllNotificationsRead,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) {
    throw new Error("useDemo must be used inside a DemoProvider.");
  }
  return ctx;
}
