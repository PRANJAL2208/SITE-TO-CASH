import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import { computeDemoCostSummary, computeLineAmount, formatInr } from "../../../demo/demoSeed";
import ActivityTimeline from "../shared/ActivityTimeline";
import ConfirmModal from "../shared/ConfirmModal";
import EvidencePreviewCard from "../shared/EvidencePreviewCard";

type ClientModalMode =
  | "accepted"
  | "partially_approved"
  | "rejected"
  | "clarification_requested"
  | null;

const CLIENT_VISIBLE_STATUSES = new Set([
  "submitted_to_client",
  "clarification_requested",
  "partially_approved",
  "client_approved",
  "client_rejected",
  "executed",
  "billed",
  "paid",
]);

export default function ClientVariationInbox() {
  const {
    state,
    openVariation,
    recordClientDecision,
    setRole,
    setContractorPage,
  } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const allProjVars = state.variations.filter((v) => v.projectId === project.id);
  const visibleVars = allProjVars.filter((v) => CLIENT_VISIBLE_STATUSES.has(v.status));
  const pendingInternalCount = allProjVars.length - visibleVars.length;

  const variation =
    visibleVars.find((v) => v.id === state.selectedVariationId) ?? visibleVars[0];

  const [modalMode, setModalMode] = useState<ClientModalMode>(null);
  const [banner, setBanner] = useState<string | null>(null);

  if (!variation) {
    return (
      <div className="saas-page">
        <div className="saas-page-header">
          <div>
            <div className="breadcrumb">Client View / Variation Review Inbox</div>
            <h1>Client Variation Review &amp; Commercial Decisions</h1>
          </div>
        </div>
        <div className="empty-state">
          <p style={{ marginTop: 0 }}>
            No variations have been formally dispatched to the Client yet for{" "}
            <strong>{project.name}</strong> ({pendingInternalCount} draft/in-review items
            remain in Contractor View).
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setRole("contractor");
              setContractorPage("approval_workflow");
            }}
          >
            Go to Contractor Approval &amp; Dispatch →
          </button>
        </div>
      </div>
    );
  }

  const instruction = state.instructions.find(
    (i) => i.id === variation.instructionId
  );
  const costSummary = computeDemoCostSummary(
    variation.costLines,
    variation.applyTaxPercent
  );
  const caseActivities = state.activities.filter(
    (a) => a.entityId === variation.id || a.entityId === variation.instructionId
  );

  const canDecide =
    variation.status === "submitted_to_client" ||
    variation.status === "clarification_requested";

  const handleConfirmDecision = ({
    reason,
    amount,
  }: {
    reason: string;
    amount: number | null;
  }) => {
    if (!modalMode) return;
    recordClientDecision({
      variationId: variation.id,
      decision: modalMode,
      decidedBy:
        modalMode === "accepted" || modalMode === "partially_approved"
          ? "Siddharth Rao (Client Commercial Approver)"
          : "Vikram Malhotra (Client Project Manager)",
      comment: reason,
      partialAmount: amount,
    });
    setBanner(
      `Client decision "${modalMode.replace(/_/g, " ")}" recorded for ${
        variation.id
      }. Contractor View & Billing status updated immediately.`
    );
    setModalMode(null);
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Client View / Variation Review Inbox</div>
          <h1>Client Variation Review &amp; Decision Workbench</h1>
          <p className="muted-note">
            Review contractor evidence, BOQ/contract citations, deterministic cost build-up,
            and issue an authorized commercial decision.
          </p>
        </div>
        {pendingInternalCount > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRole("contractor");
              setContractorPage("approval_workflow");
            }}
          >
            {pendingInternalCount} Draft(s) Still in Contractor Pipeline →
          </button>
        )}
      </div>

      <div className="warning-banner">
        <strong>Client Commercial Rule:</strong> Viewing or acknowledging receipt of a
        submitted variation notice does <strong>not</strong> equal commercial acceptance.
        Entitlement is established only when the Client Commercial Approver explicitly records{" "}
        <em>Accept</em> or <em>Partially Approve</em> below.
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      {/* Submitted Variation Selector Pills */}
      <div className="project-pills">
        {visibleVars.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`project-tile ${v.id === variation.id ? "active" : ""}`}
            onClick={() => openVariation(v.id, "client")}
          >
            <strong>{v.id}</strong>
            <span>
              {v.title} · {v.status.replace(/_/g, " ")}
            </span>
          </button>
        ))}
      </div>

      {/* Main Client Review Package */}
      <div className="saas-two-col section-spacer">
        {/* Left: Contractor Evidence + Original Instruction + Clauses */}
        <div className="saas-stack">
          <div className="saas-card">
            <div className="saas-card-header">
              <div>
                <h3>
                  {variation.id}: {variation.title}
                </h3>
                <p className="muted-note">
                  Trade: {variation.trade} · Zone: {variation.floorLocation}
                </p>
              </div>
              <span
                className={`badge ${
                  variation.status === "client_approved" ||
                  variation.status === "executed" ||
                  variation.status === "billed" ||
                  variation.status === "paid"
                    ? "badge-ok"
                    : variation.status === "client_rejected"
                    ? "badge-err"
                    : "badge-qs"
                }`}
              >
                {variation.status.replace(/_/g, " ")}
              </span>
            </div>

            {instruction && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: "0.86rem" }}>
                  Original Site Instruction ({instruction.id} ·{" "}
                  {instruction.channel.replace(/_/g, " ")} · {instruction.receivedAt}):
                </strong>
                <div className="evidence-quote" style={{ marginTop: 6 }}>
                  {instruction.originalText}
                </div>
                <span className="muted-note">
                  Issued by {instruction.senderName} ({instruction.senderRole})
                </span>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: "0.86rem" }}>
                Contractor Scope Justification:
              </strong>
              <p style={{ margin: "4px 0" }}>{variation.contractorJustification}</p>
              <p className="muted-note" style={{ margin: 0 }}>
                {variation.scopeComparison}
              </p>
            </div>

            <div className="kv-list">
              <div>
                <span>Contractor Approval Sign-Off:</span>
                <strong>
                  {variation.contractorApproval.approverName ?? "Rohan / Meera"} (
                  {variation.contractorApproval.dispatchedAt ??
                    variation.submittedDate ??
                    "—"}
                  )
                </strong>
              </div>
              <div>
                <span>Claimed Schedule Impact:</span>
                <strong>
                  {variation.scheduleImpactDays !== null
                    ? `${variation.scheduleImpactDays} days — ${variation.scheduleImpactNote}`
                    : "None claimed"}
                </strong>
              </div>
            </div>
          </div>

          {/* Contract & BOQ Refs */}
          <div className="saas-card">
            <h3>Submitted Contract &amp; BOQ Citations</h3>
            <div className="saas-stack">
              {variation.aiAssessment.relevantContractClauses.map((c) => (
                <div key={c.refId} className="finding-item">
                  <div className="edit-row">
                    <strong>{c.clauseRef}</strong> — {c.title}
                    <span className="ref-pill">{c.pageRef}</span>
                  </div>
                  <div className="evidence-quote" style={{ marginTop: 6 }}>
                    {c.excerpt}
                  </div>
                </div>
              ))}
              {variation.aiAssessment.existingBoqReferences.map((b) => (
                <div key={b.refId} className="finding-item">
                  <div className="edit-row">
                    <strong>{b.itemCode}</strong> — {b.description}
                    <span className="ref-pill">{b.sheetAndRow}</span>
                  </div>
                  <p className="muted-note" style={{ margin: "4px 0 0" }}>
                    Base Unit: {b.unit ?? "—"} · Base Rate:{" "}
                    {formatInr(b.baseRate, "NULL (No contract rate)")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Visual Proof */}
          {variation.evidenceItems.length > 0 && (
            <div className="saas-card">
              <h3>Contractor Visual Evidence ({variation.evidenceItems.length})</h3>
              <div className="evidence-grid">
                {variation.evidenceItems.map((ev) => (
                  <EvidencePreviewCard key={ev.id} item={ev} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Deterministic Cost Breakdown + Client Decision Panel + History */}
        <div className="saas-stack">
          <div className="saas-card">
            <h3>Submitted Cost Build-Up Breakdown</h3>
            <div className="table-wrap">
              <table className="boq-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    <th className="num">Amount</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {variation.costLines.map((line) => {
                    const amt = computeLineAmount(line);
                    return (
                      <tr key={line.id}>
                        <td>{line.description}</td>
                        <td>{line.category}</td>
                        <td className="num">
                          {line.quantity ?? "MISSING"} {line.unit ?? ""}
                        </td>
                        <td className="num">{formatInr(line.rate, "MISSING")}</td>
                        <td className="num">
                          <strong>{formatInr(amt, "MISSING")}</strong>
                        </td>
                        <td className="muted-note">{line.rateSource}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="totals-box" style={{ marginTop: 12 }}>
              <div className="totals-grid">
                <div>
                  <span className="muted-note">Proposed Net Excl. Tax</span>
                  <strong>{formatInr(costSummary.subtotal)}</strong>
                </div>
                <div>
                  <span className="muted-note">
                    GST{" "}
                    {variation.applyTaxPercent !== null
                      ? `(${variation.applyTaxPercent}%)`
                      : "(Not applied)"}
                  </span>
                  <strong>{formatInr(costSummary.taxAmount, "₹0")}</strong>
                </div>
                <div>
                  <span className="muted-note">Submitted Claim Total</span>
                  <strong>{formatInr(costSummary.totalAmount)}</strong>
                </div>
                <div>
                  <span className="muted-note">Approved Client Ceiling</span>
                  <strong>{formatInr(variation.approvedAmount, "Pending decision")}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Client Decision Controls */}
          <div className="saas-card">
            <div className="saas-card-header">
              <h3>Client Commercial Decision</h3>
              <span
                className={`badge ${
                  variation.clientDecision.decision === "accepted"
                    ? "badge-ok"
                    : variation.clientDecision.decision === "rejected"
                    ? "badge-err"
                    : "badge-qs"
                }`}
              >
                {variation.clientDecision.decision.replace(/_/g, " ")}
              </span>
            </div>

            <div className="kv-list" style={{ marginBottom: 12 }}>
              <div>
                <span>Decided By:</span>
                <strong>{variation.clientDecision.decidedBy ?? "Awaiting review"}</strong>
              </div>
              <div>
                <span>Decision Timestamp:</span>
                <strong>{variation.clientDecision.decidedAt ?? "—"}</strong>
              </div>
              <div>
                <span>Approved Value:</span>
                <strong>{formatInr(variation.approvedAmount, "Not approved yet")}</strong>
              </div>
              <div>
                <span>Client Remarks:</span>
                <strong>{variation.clientDecision.comment ?? "—"}</strong>
              </div>
            </div>

            {canDecide ? (
              <div className="edit-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setModalMode("accepted")}
                >
                  Accept Full Variation ({formatInr(variation.proposedAmount)})
                </button>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() => setModalMode("partially_approved")}
                >
                  Partially Approve
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setModalMode("clarification_requested")}
                >
                  Request Clarification
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setModalMode("rejected")}
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="demo-inline-alert info">
                Decision already finalized ({variation.clientDecision.decision.replace(/_/g, " ")})
                on {variation.clientDecision.decidedAt}. Changes flow live to Contractor
                Progress &amp; Billing screens.
              </div>
            )}
          </div>

          <div className="saas-card">
            <h3>Notice &amp; Decision Audit Trail</h3>
            <ActivityTimeline events={caseActivities} />
          </div>
        </div>
      </div>

      {/* Confirmation Modals */}
      <ConfirmModal
        open={modalMode === "accepted"}
        title={`Accept Variation ${variation.id}`}
        description={`Confirm client commercial approval for ${formatInr(
          variation.proposedAmount
        )}. Contractor will be unlocked to record execution & raise variation billing upon completion.`}
        confirmLabel="Accept Variation"
        confirmTone="primary"
        reasonLabel="Client Approval Note"
        initialReason="Verified IFC Rev-C architectural revision instruction and site ceiling conflict. Full proposed cost approved."
        onCancel={() => setModalMode(null)}
        onConfirm={handleConfirmDecision}
      />

      <ConfirmModal
        open={modalMode === "partially_approved"}
        title={`Partially Approve Variation ${variation.id}`}
        description="Specify the revised approved monetary ceiling and written commercial rationale."
        confirmLabel="Record Partial Approval"
        confirmTone="warning"
        showAmountInput
        amountLabel="Approved Amount (INR)"
        initialAmount={String(variation.proposedAmount ?? "")}
        requireReason
        reasonLabel="Basis of Partial Approval"
        onCancel={() => setModalMode(null)}
        onConfirm={handleConfirmDecision}
      />

      <ConfirmModal
        open={modalMode === "clarification_requested"}
        title={`Request Clarification — ${variation.id}`}
        description="Return notice to Apex MEP Contractors for additional backup or measurement verification."
        confirmLabel="Send Clarification Request"
        confirmTone="warning"
        requireReason
        reasonLabel="Required Clarification Details"
        onCancel={() => setModalMode(null)}
        onConfirm={handleConfirmDecision}
      />

      <ConfirmModal
        open={modalMode === "rejected"}
        title={`Reject Variation ${variation.id}`}
        description="Reject variation claim and record approved amount as ₹0."
        confirmLabel="Confirm Rejection"
        confirmTone="danger"
        requireReason
        reasonLabel="Commercial Rejection Basis"
        onCancel={() => setModalMode(null)}
        onConfirm={handleConfirmDecision}
      />
    </div>
  );
}
