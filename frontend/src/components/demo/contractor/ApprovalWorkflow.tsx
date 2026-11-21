import { useEffect, useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import { computeDemoCostSummary, formatInr } from "../../../demo/demoSeed";
import type { DemoVariation } from "../../../demo/demoTypes";
import ActivityTimeline from "../shared/ActivityTimeline";
import ConfirmModal from "../shared/ConfirmModal";

type ModalAction = "confirm_qs" | "approve" | "request_changes" | "reject" | null;

const STEP_LABELS = [
  { id: 1, title: "1. AI Draft Ready" },
  { id: 2, title: "2. QS Confirmed" },
  { id: 3, title: "3. Commercial Approver" },
  { id: 4, title: "4. Ready to Dispatch" },
  { id: 5, title: "5. Sent to Client (Demo)" },
];

function getActiveStepNumber(v: DemoVariation): number {
  switch (v.contractorApproval.step) {
    case "ai_draft_ready":
      return 1;
    case "qs_confirmed":
      return 2;
    case "approver_changes_requested":
    case "approver_rejected":
      return 3;
    case "approver_approved":
      return 4;
    case "dispatched_simulated":
      return 5;
    default:
      return 1;
  }
}

export default function ApprovalWorkflow() {
  const {
    state,
    openVariation,
    reviewContractorDraft,
    dispatchContractorNotice,
    setContractorPage,
    setClientPage,
  } = useDemo();

  const projVars = state.variations.filter(
    (v) => v.projectId === state.selectedProjectId
  );
  const variation =
    projVars.find((v) => v.id === state.selectedVariationId) ?? projVars[0];

  const [modalAction, setModalAction] = useState<ModalAction>(null);
  const [noticeSubject, setNoticeSubject] = useState(
    variation?.contractorApproval.noticeSubject ?? ""
  );
  const [recipientEmail, setRecipientEmail] = useState(
    variation?.contractorApproval.recipientEmail ?? ""
  );
  const [emailBody, setEmailBody] = useState(
    variation?.contractorApproval.emailBody ?? ""
  );
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  useEffect(() => {
    if (variation) {
      setNoticeSubject(variation.contractorApproval.noticeSubject);
      setRecipientEmail(variation.contractorApproval.recipientEmail);
      setEmailBody(variation.contractorApproval.emailBody);
      setFeedbackBanner(null);
    }
  }, [variation?.id, variation?.contractorApproval.emailBody]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!variation) {
    return (
      <div className="empty-state">
        No variations exist in the selected project yet.
      </div>
    );
  }

  const costSummary = computeDemoCostSummary(
    variation.costLines,
    variation.applyTaxPercent
  );
  const activeStep = getActiveStepNumber(variation);
  const approval = variation.contractorApproval;
  const caseActivities = state.activities.filter(
    (a) => a.entityId === variation.id || a.entityId === variation.instructionId
  );

  const handleModalConfirm = ({ reason }: { reason: string }) => {
    if (!modalAction) return;
    if (modalAction === "confirm_qs") {
      reviewContractorDraft({
        variationId: variation.id,
        action: "confirm_qs",
        actorName: "Rohan Deshmukh (Senior QS)",
        notes: reason,
      });
      setFeedbackBanner(
        `QS commercial build-up confirmed for ${variation.id}. Ready for Contractor Commercial Approver review.`
      );
    } else if (modalAction === "approve") {
      reviewContractorDraft({
        variationId: variation.id,
        action: "approve",
        actorName: "Meera Nair (Commercial Manager)",
        notes: reason,
      });
      setFeedbackBanner(
        `${variation.id} internally approved by Commercial Manager. Formal Client Notice preview is unlocked below.`
      );
    } else if (modalAction === "request_changes") {
      reviewContractorDraft({
        variationId: variation.id,
        action: "request_changes",
        actorName: "Meera Nair (Commercial Manager)",
        notes: reason,
      });
      setFeedbackBanner(
        `Returned ${variation.id} to QS review with change comments.`
      );
    } else if (modalAction === "reject") {
      reviewContractorDraft({
        variationId: variation.id,
        action: "reject",
        actorName: "Meera Nair (Commercial Manager)",
        notes: reason,
      });
      setFeedbackBanner(`${variation.id} marked internally rejected.`);
    }
    setModalAction(null);
  };

  const handleDispatchSimulated = (e: React.FormEvent) => {
    e.preventDefault();
    dispatchContractorNotice({
      variationId: variation.id,
      subject: noticeSubject.trim() || approval.noticeSubject,
      recipientEmail: recipientEmail.trim() || approval.recipientEmail,
      emailBody: emailBody.trim() || approval.emailBody,
    });
    setFeedbackBanner(
      `Simulated notice logged for ${variation.id} and surfaced inside Client View (${approval.recipientName}). Demo action — not actually sent externally.`
    );
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">
            Contractor View / Approval &amp; Client Notice Dispatch
          </div>
          <h1>Contractor Internal Approval &amp; Notice Workflow</h1>
          <p className="muted-note">
            Two-stage internal sign-off (QS verification → Authorized Commercial Manager)
            before dispatching a formal notice to the Client.
          </p>
        </div>
        <div className="edit-row">
          <button
            type="button"
            className="btn"
            onClick={() => setContractorPage("variation")}
          >
            ← Back to Cost Build-Up
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              openVariation(variation.id, "client");
              setClientPage("client_variations");
            }}
          >
            Preview in Client View →
          </button>
        </div>
      </div>

      {/* Variation Selector Pills */}
      <div className="project-pills">
        {projVars.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`project-tile ${v.id === variation.id ? "active" : ""}`}
            onClick={() => openVariation(v.id, "contractor")}
          >
            <strong>{v.id}</strong>
            <span>{v.title}</span>
          </button>
        ))}
      </div>

      {feedbackBanner && (
        <div className="success-banner" style={{ marginTop: 12 }}>
          <span>{feedbackBanner}</span>
        </div>
      )}

      <div className="warning-banner" style={{ marginTop: 12 }}>
        <strong>Commercial Guardrail:</strong> AI outputs and QS calculations remain{" "}
        <em>draft proposals</em> until explicitly approved by human commercial authority.
        Simulated email dispatch updates the shared Demo Client Portal without sending real
        external email.
      </div>

      {/* 5-Step Progress Rail */}
      <div className="saas-card section-spacer">
        <div className="saas-card-header">
          <div>
            <h3>Workflow Stage Progress — {variation.id}</h3>
            <p className="muted-note">
              Proposed Net Total: <strong>{formatInr(costSummary.totalAmount)}</strong> · Status:{" "}
              <span className="badge">{variation.status.replace(/_/g, " ")}</span>
            </p>
          </div>
          <span className="badge badge-phase">Step {activeStep} of 5</span>
        </div>

        <div className="workflow-rail">
          {STEP_LABELS.map((step) => {
            const done = activeStep > step.id || (step.id === 5 && activeStep === 5);
            const current = activeStep === step.id;
            return (
              <div
                key={step.id}
                className={`workflow-step ${done ? "done" : ""} ${current ? "current" : ""}`}
              >
                <div className="workflow-step-num">{done ? "✓" : step.id}</div>
                <div className="workflow-step-label">{step.title}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Approval Gates & Notice Dispatch */}
      <div className="saas-two-col section-spacer">
        {/* Left: Gate 1 (QS) + Gate 2 (Commercial Manager) */}
        <div className="saas-stack">
          <div className="saas-card">
            <div className="saas-card-header">
              <h3>Gate 1: Quantity Surveyor Verification</h3>
              {approval.qsReviewer ? (
                <span className="badge badge-ok">Confirmed</span>
              ) : (
                <span className="badge badge-qs">Pending QS Sign-Off</span>
              )}
            </div>
            <div className="kv-list">
              <div>
                <span>Reviewer:</span>
                <strong>{approval.qsReviewer ?? "Rohan Deshmukh (Senior QS)"}</strong>
              </div>
              <div>
                <span>Confirmed At:</span>
                <strong>{approval.qsReviewedAt ?? "Not confirmed yet"}</strong>
              </div>
              <div>
                <span>Verified Lines:</span>
                <strong>
                  {costSummary.calculableCount} / {variation.costLines.length} lines
                </strong>
              </div>
              <div>
                <span>Proposed Total:</span>
                <strong>{formatInr(costSummary.totalAmount)}</strong>
              </div>
            </div>

            {costSummary.missingCount > 0 && (
              <div className="demo-inline-alert warn" style={{ marginTop: 12 }}>
                <strong>Missing Inputs Flagged ({costSummary.missingCount}):</strong>{" "}
                {variation.missingEvidence.join(" · ") ||
                  "One or more cost lines still have MISSING rates/quantities. You should complete rates on the Variation Workspace before approval."}
              </div>
            )}

            <div className="edit-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={approval.step !== "ai_draft_ready" && approval.step !== "approver_changes_requested"}
                onClick={() => setModalAction("confirm_qs")}
              >
                {approval.qsReviewer
                  ? "QS Sign-Off Recorded ✓"
                  : "Confirm QS Build-Up & Send to Approver"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setContractorPage("variation")}
              >
                Edit Cost Lines
              </button>
            </div>
          </div>

          <div className="saas-card">
            <div className="saas-card-header">
              <h3>Gate 2: Contractor Commercial Approver Sign-Off</h3>
              {approval.step === "approver_approved" ||
              approval.step === "dispatched_simulated" ? (
                <span className="badge badge-ok">Internally Approved</span>
              ) : approval.step === "approver_rejected" ? (
                <span className="badge badge-err">Internally Rejected</span>
              ) : approval.step === "approver_changes_requested" ? (
                <span className="badge badge-qs">Revisions Requested</span>
              ) : (
                <span className="badge badge-ai">Awaiting Meera Nair</span>
              )}
            </div>
            <div className="kv-list">
              <div>
                <span>Authorized Approver:</span>
                <strong>{approval.approverName ?? "Meera Nair (Commercial Manager)"}</strong>
              </div>
              <div>
                <span>Authority Scope:</span>
                <strong>{approval.approverRole ?? "Authorized Contractor Signatory"}</strong>
              </div>
              <div>
                <span>Decision Timestamp:</span>
                <strong>{approval.approvedAt ?? "Pending internal sign-off"}</strong>
              </div>
              <div>
                <span>Approver Remarks:</span>
                <strong>{approval.approverNotes ?? "—"}</strong>
              </div>
            </div>

            <div className="edit-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  approval.step === "ai_draft_ready" ||
                  approval.step === "approver_approved" ||
                  approval.step === "dispatched_simulated"
                }
                onClick={() => setModalAction("approve")}
              >
                Approve for Client Submission
              </button>
              <button
                type="button"
                className="btn btn-warning"
                disabled={
                  approval.step === "ai_draft_ready" ||
                  approval.step === "dispatched_simulated"
                }
                onClick={() => setModalAction("request_changes")}
              >
                Request Revisions
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={
                  approval.step === "ai_draft_ready" ||
                  approval.step === "dispatched_simulated"
                }
                onClick={() => setModalAction("reject")}
              >
                Reject Draft
              </button>
            </div>
            {approval.step === "ai_draft_ready" && (
              <p className="muted-note" style={{ marginTop: 8 }}>
                Complete Gate 1 (QS Verification) first to enable Commercial Manager sign-off.
              </p>
            )}
          </div>
        </div>

        {/* Right: Gate 3 (Simulated Formal Notice Dispatch) */}
        <div className="saas-card">
          <div className="saas-card-header">
            <div>
              <h3>Gate 3: Formal Client Notice Preview &amp; Dispatch</h3>
              <p className="muted-note">
                Prepares structured variation notice package with contract &amp; BOQ citations.
              </p>
            </div>
            <span className="badge badge-phase">Demo action — not actually sent</span>
          </div>

          <form onSubmit={handleDispatchSimulated}>
            <div className="field-group">
              <label htmlFor="notice-recipient">Client Recipient</label>
              <input
                id="notice-recipient"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                disabled={approval.step === "dispatched_simulated"}
              />
            </div>

            <div className="field-group">
              <label htmlFor="notice-subject">Notice Subject</label>
              <input
                id="notice-subject"
                value={noticeSubject}
                onChange={(e) => setNoticeSubject(e.target.value)}
                disabled={approval.step === "dispatched_simulated"}
              />
            </div>

            <div className="field-group">
              <label htmlFor="notice-body">Formal Notice Letter Preview</label>
              <textarea
                id="notice-body"
                rows={9}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                disabled={approval.step === "dispatched_simulated"}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <span className="muted-note" style={{ display: "block", marginBottom: 6 }}>
                Attached Supporting Package ({approval.attachedDocs.length} documents):
              </span>
              <div className="citation-list">
                {approval.attachedDocs.map((doc) => (
                  <span key={doc} className="citation-chip">
                    📎 {doc}
                  </span>
                ))}
              </div>
            </div>

            {approval.step === "dispatched_simulated" ? (
              <div className="demo-inline-alert ok">
                <strong>Simulated Notice Logged ({approval.dispatchedAt}):</strong> Delivered
                to Client Review Inbox in Demo Client View (not sent via external email).
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      openVariation(variation.id, "client");
                      setClientPage("client_variations");
                    }}
                  >
                    Switch to Client View to Review &amp; Approve →
                  </button>
                </div>
              </div>
            ) : (
              <div className="edit-row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={approval.step !== "approver_approved"}
                >
                  Send Variation Notice to Client (Demo — Not Actually Sent)
                </button>
              </div>
            )}

            {approval.step !== "approver_approved" &&
              approval.step !== "dispatched_simulated" && (
                <p className="muted-note" style={{ marginTop: 8 }}>
                  Notice dispatch unlocks automatically once Meera Nair approves Gate 2.
                </p>
              )}
          </form>
        </div>
      </div>

      {/* Audit Trail */}
      <div className="saas-card section-spacer">
        <h3>Approval &amp; Notice Audit Trail ({variation.id})</h3>
        <ActivityTimeline events={caseActivities} />
      </div>

      {/* Confirmation Modals */}
      <ConfirmModal
        open={modalAction === "confirm_qs"}
        title={`Confirm QS Build-Up for ${variation.id}`}
        description={`Verify deterministic build-up totaling ${formatInr(costSummary.totalAmount)} and submit to Meera Nair (Commercial Manager).`}
        confirmLabel="Confirm QS Build-Up"
        confirmTone="primary"
        reasonLabel="QS Commercial Verification Note"
        initialReason={variation.aiAssessment.qsNotes}
        disclaimerNote="Demo check: ensures human QS review precedes internal approval."
        onCancel={() => setModalAction(null)}
        onConfirm={handleModalConfirm}
      />

      <ConfirmModal
        open={modalAction === "approve"}
        title={`Approve ${variation.id} for Client Submission`}
        description={`Authorize proposed variation value ${formatInr(costSummary.totalAmount)} for formal dispatch to ${approval.recipientName}.`}
        confirmLabel="Approve Internally"
        confirmTone="primary"
        reasonLabel="Commercial Manager Sign-Off Note"
        initialReason="Quantities, rates, and Clause 14.1 evidence checked. Approved for formal submission."
        disclaimerNote="Internal contractor authorization only — Client contractual approval remains separate."
        onCancel={() => setModalAction(null)}
        onConfirm={handleModalConfirm}
      />

      <ConfirmModal
        open={modalAction === "request_changes"}
        title={`Request QS Revisions — ${variation.id}`}
        description="Return this variation to QS Review and specify required adjustments."
        confirmLabel="Request Revisions"
        confirmTone="warning"
        requireReason
        reasonLabel="Required Changes / Clarifications"
        reasonPlaceholder="e.g. Attach supplier quote for fire-rated dampers before client dispatch..."
        onCancel={() => setModalAction(null)}
        onConfirm={handleModalConfirm}
      />

      <ConfirmModal
        open={modalAction === "reject"}
        title={`Reject Internal Variation Draft — ${variation.id}`}
        description="Close internal submission draft with documented reason."
        confirmLabel="Confirm Rejection"
        confirmTone="danger"
        requireReason
        reasonLabel="Rejection Reason"
        onCancel={() => setModalAction(null)}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
}
