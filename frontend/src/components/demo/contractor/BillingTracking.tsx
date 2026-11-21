import { Fragment, useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import { formatInr } from "../../../demo/demoSeed";
import type { DemoMilestone, DemoVariation } from "../../../demo/demoTypes";
import ConfirmModal from "../shared/ConfirmModal";

export default function BillingTracking() {
  const {
    state,
    raiseDemoInvoice,
    updateMilestoneStatus,
    openVariation,
  } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projVars = state.variations.filter((v) => v.projectId === project.id);
  const projInvoices = state.invoices.filter((i) => i.projectId === project.id);
  const projMilestones = state.milestones.filter((m) => m.projectId === project.id);

  const [invoiceTarget, setInvoiceTarget] = useState<DemoVariation | null>(null);
  const [expandedReminderId, setExpandedReminderId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const approvedTotal = projVars.reduce((s, v) => s + (v.approvedAmount ?? 0), 0);
  const executedTotal = projVars.reduce((s, v) => s + (v.executedAmount ?? 0), 0);
  const unbilledVariations = projVars.filter((v) => v.status === "executed");
  const unbilledExecutedValue = unbilledVariations.reduce(
    (s, v) => s + (v.executedAmount ?? v.approvedAmount ?? 0),
    0
  );
  const submittedInvoicesTotal = projInvoices.reduce((s, i) => s + i.amount, 0);
  const paidInvoicesTotal = projInvoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amount, 0);
  const outstandingTotal = projInvoices
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + i.amount, 0);

  const handleConfirmRaiseInvoice = ({
    reason,
    amount,
  }: {
    reason: string;
    amount: number | null;
  }) => {
    if (!invoiceTarget) return;
    const finalAmt =
      amount ?? invoiceTarget.executedAmount ?? invoiceTarget.approvedAmount ?? 0;
    raiseDemoInvoice({
      projectId: project.id,
      variationId: invoiceTarget.id,
      milestoneName: `Approved Variation (${invoiceTarget.id})`,
      description:
        reason.trim() || `Interim Variation Claim — ${invoiceTarget.id}: ${invoiceTarget.title}`,
      amount: finalAmt,
      dueDate: "2026-12-05",
    });
    setBanner(
      `Variation Invoice raised for ${invoiceTarget.id} (${formatInr(finalAmt)}). Status updated to Billed and posted to Client Billing Portal.`
    );
    setInvoiceTarget(null);
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Contractor View / Commercial Billing &amp; Cash</div>
          <h1>Billing, Variation Claims &amp; Payment Tracking</h1>
          <p className="muted-note">
            Convert approved, physically executed site variations into formal variation
            claims and track receivables without losing unbilled change value.
          </p>
        </div>
        <span className="badge badge-phase">Simulated Financial Ledger</span>
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      {/* Commercial Totals Guardrail Strip */}
      <div className="saas-kpi-grid">
        <div className="saas-kpi-card">
          <span className="kpi-label">Approved Variations</span>
          <strong className="kpi-value">{formatInr(approvedTotal)}</strong>
          <span className="kpi-sub">Client-confirmed ceiling</span>
        </div>
        <div className="saas-kpi-card">
          <span className="kpi-label">Executed Variation Work</span>
          <strong className="kpi-value">{formatInr(executedTotal)}</strong>
          <span className="kpi-sub">Site work completed</span>
        </div>
        <div
          className={`saas-kpi-card ${
            unbilledExecutedValue > 0 ? "kpi-warn" : "kpi-ok"
          }`}
        >
          <span className="kpi-label">Completed — Not Yet Billed</span>
          <strong className="kpi-value">{formatInr(unbilledExecutedValue)}</strong>
          <span className="kpi-sub">
            {unbilledVariations.length} executed variation(s) ready to invoice
          </span>
        </div>
        <div className="saas-kpi-card">
          <span className="kpi-label">Total Invoiced</span>
          <strong className="kpi-value">{formatInr(submittedInvoicesTotal)}</strong>
          <span className="kpi-sub">{projInvoices.length} raised claims</span>
        </div>
        <div className="saas-kpi-card kpi-ok">
          <span className="kpi-label">Payments Received</span>
          <strong className="kpi-value">{formatInr(paidInvoicesTotal)}</strong>
          <span className="kpi-sub">Settled cash collected</span>
        </div>
        <div
          className={`saas-kpi-card ${outstandingTotal > 0 ? "kpi-danger" : "kpi-ok"}`}
        >
          <span className="kpi-label">Outstanding Receivables</span>
          <strong className="kpi-value">{formatInr(outstandingTotal)}</strong>
          <span className="kpi-sub">Submitted / verified / overdue</span>
        </div>
      </div>

      {/* Ready to Bill Section */}
      <div className="saas-card section-spacer">
        <div className="saas-card-header">
          <div>
            <h3>Executed Variations Ready to Bill ({unbilledVariations.length})</h3>
            <p className="muted-note">
              Separates Proposed → Approved → Executed → Billed → Paid amounts at all times.
            </p>
          </div>
          <span className="badge badge-qs">Revenue Leakage Guard</span>
        </div>

        {unbilledVariations.length === 0 ? (
          <div className="empty-state">
            No unbilled executed variations right now. Approve &amp; log execution progress
            on a variation (such as <strong>VAR-SCT-004</strong>) to unlock 1-click invoicing.
          </div>
        ) : (
          <div className="action-list">
            {unbilledVariations.map((v) => (
              <div key={v.id} className="action-item">
                <div className="action-item-main">
                  <div className="edit-row">
                    <strong>{v.id}</strong>
                    <span>{v.title}</span>
                    <span className="badge badge-ok">Executed</span>
                  </div>
                  <p className="muted-note" style={{ margin: "4px 0 0" }}>
                    Approved Value: <strong>{formatInr(v.approvedAmount)}</strong> ·
                    Executed Value:{" "}
                    <strong>{formatInr(v.executedAmount ?? v.approvedAmount)}</strong> ·
                    Location: {v.floorLocation}
                  </p>
                </div>
                <div className="edit-row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => openVariation(v.id, "contractor")}
                  >
                    Inspect
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setInvoiceTarget(v)}
                  >
                    Raise Variation Invoice (Demo)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invoices Table */}
      <div className="saas-card section-spacer">
        <div className="saas-card-header">
          <h3>Submitted Invoices &amp; Payment Status ({projInvoices.length})</h3>
          <span className="badge badge-phase">Demo Billing Ledger</span>
        </div>

        {projInvoices.length === 0 ? (
          <div className="empty-state">No invoices recorded for this project.</div>
        ) : (
          <div className="table-wrap">
            <table className="boq-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Variation / Milestone</th>
                  <th>Description</th>
                  <th>Submitted</th>
                  <th>Due Date</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Payment / Reminder</th>
                </tr>
              </thead>
              <tbody>
                {projInvoices.map((inv) => (
                  <Fragment key={inv.id}>
                    <tr>
                      <td>
                        <strong>{inv.id}</strong>
                      </td>
                      <td>
                        {inv.variationId ? (
                          <span className="ref-pill">{inv.variationId}</span>
                        ) : (
                          inv.milestoneName
                        )}
                      </td>
                      <td>{inv.description}</td>
                      <td>{inv.submittedDate}</td>
                      <td>{inv.dueDate}</td>
                      <td className="num">
                        <strong>{formatInr(inv.amount)}</strong>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            inv.status === "paid"
                              ? "badge-ok"
                              : inv.status === "overdue"
                              ? "badge-err"
                              : inv.status === "client_verified"
                              ? "badge-phase"
                              : "badge-qs"
                          }`}
                        >
                          {inv.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td>
                        {inv.status === "paid" ? (
                          <span className="muted-note">
                            Paid {inv.paidDate} ({inv.paymentRef ?? "Ref logged"})
                          </span>
                        ) : inv.overdueReminderPreview ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              setExpandedReminderId(
                                expandedReminderId === inv.id ? null : inv.id
                              )
                            }
                          >
                            {expandedReminderId === inv.id
                              ? "Hide Reminder Preview"
                              : "View Reminder Preview (Demo)"}
                          </button>
                        ) : (
                          <span className="muted-note">Awaiting Client Verification</span>
                        )}
                      </td>
                    </tr>
                    {expandedReminderId === inv.id && inv.overdueReminderPreview && (
                      <tr>
                        <td colSpan={8}>
                          <div className="demo-inline-alert warn">
                            <strong>
                              Overdue Payment Reminder Preview (Demo action — not actually
                              sent):
                            </strong>{" "}
                            {inv.overdueReminderPreview}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Illustrative Milestone Payment Schedule */}
      <div className="saas-card section-spacer">
        <div className="saas-card-header">
          <div>
            <h3>Contract Milestone Billing Schedule (Illustrative Demo Sample)</h3>
            <p className="muted-note">
              Tracks contract completion milestones independently from approved change orders.
            </p>
          </div>
          <span className="badge">Illustrative Project Schedule</span>
        </div>

        <div className="demo-inline-alert info" style={{ marginBottom: 12 }}>
          <strong>Illustrative Demo Schedule:</strong> Milestone names (Initial
          Mobilisation, First-Floor Completion, Second-Floor Completion, Final
          Commissioning) depict a sample MEP subcontract payment breakdown for{" "}
          <strong>{project.name}</strong> and are not universal rules for all projects.
        </div>

        <div className="table-wrap">
          <table className="boq-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Milestone</th>
                <th>Target Date</th>
                <th className="num">Share %</th>
                <th className="num">Scheduled Value</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {projMilestones.map((ms) => (
                <tr key={ms.id}>
                  <td>{ms.sequence}</td>
                  <td>
                    <strong>{ms.name}</strong>
                  </td>
                  <td>{ms.targetDate}</td>
                  <td className="num">{ms.paymentPercent}%</td>
                  <td className="num">
                    <strong>{formatInr(ms.scheduledValue)}</strong>
                  </td>
                  <td>
                    <select
                      className="status-select"
                      value={ms.status}
                      onChange={(e) =>
                        updateMilestoneStatus(
                          ms.id,
                          e.target.value as DemoMilestone["status"]
                        )
                      }
                    >
                      <option value="completed">completed</option>
                      <option value="in_progress">in progress</option>
                      <option value="at_risk">at risk</option>
                      <option value="upcoming">upcoming</option>
                    </select>
                  </td>
                  <td className="muted-note">{ms.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(invoiceTarget)}
        title={`Raise Variation Invoice — ${invoiceTarget?.id ?? ""}`}
        description={`Issue formal variation billing claim for completed physical work under ${
          invoiceTarget?.id ?? ""
        }. This updates Paid/Billed totals and posts the invoice to Client Billing Portal.`}
        confirmLabel="Raise Variation Invoice (Demo)"
        confirmTone="primary"
        showAmountInput
        amountLabel="Invoice Claim Amount (INR)"
        initialAmount={String(
          invoiceTarget?.executedAmount ?? invoiceTarget?.approvedAmount ?? 0
        )}
        reasonLabel="Invoice Claim Description"
        initialReason={
          invoiceTarget
            ? `Interim Variation Claim — ${invoiceTarget.id}: ${invoiceTarget.title} (Executed & Verified)`
            : ""
        }
        disclaimerNote="Simulated ledger action — updates live Demo Client Billing portal."
        onCancel={() => setInvoiceTarget(null)}
        onConfirm={handleConfirmRaiseInvoice}
      />
    </div>
  );
}
