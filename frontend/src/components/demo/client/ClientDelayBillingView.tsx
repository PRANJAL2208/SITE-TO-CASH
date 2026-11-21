import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import { formatInr } from "../../../demo/demoSeed";
import type { DemoDelayItem, DemoInvoice } from "../../../demo/demoTypes";
import ConfirmModal from "../shared/ConfirmModal";

export default function ClientDelayBillingView() {
  const { state, respondToDelay, updateInvoicePaymentStatus } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projDelays = state.delays.filter((d) => d.projectId === project.id);
  const projInvoices = state.invoices.filter((i) => i.projectId === project.id);
  const projMilestones = state.milestones.filter((m) => m.projectId === project.id);

  const [replyDelayId, setReplyDelayId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] =
    useState<DemoDelayItem["status"]>("client_responded");

  const [invoiceModal, setInvoiceModal] = useState<{
    invoice: DemoInvoice;
    targetStatus: "client_verified" | "paid";
  } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const totalInvoiced = projInvoices.reduce((s, i) => s + i.amount, 0);
  const paidTotal = projInvoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amount, 0);
  const pendingTotal = projInvoices
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + i.amount, 0);

  const handleSaveDelayReply = (e: React.FormEvent, delayId: string) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    respondToDelay(delayId, replyText.trim(), replyStatus);
    setBanner(
      `Client response recorded on ${delayId} (${replyStatus.replace(/_/g, " ")}).`
    );
    setReplyDelayId(null);
    setReplyText("");
  };

  const handleConfirmInvoiceUpdate = ({ reason }: { reason: string }) => {
    if (!invoiceModal) return;
    updateInvoicePaymentStatus({
      invoiceId: invoiceModal.invoice.id,
      status: invoiceModal.targetStatus,
      paymentRef:
        reason.trim() ||
        (invoiceModal.targetStatus === "paid"
          ? "NEFT-DEMO-2026-8841"
          : "Client QS Verified (Demo)"),
    });
    setBanner(
      invoiceModal.targetStatus === "paid"
        ? `Payment settled recorded for ${invoiceModal.invoice.id} (${formatInr(
            invoiceModal.invoice.amount
          )}). Contractor Paid ledger updated.`
        : `Invoice ${invoiceModal.invoice.id} marked Client Verified.`
    );
    setInvoiceModal(null);
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">
            Client View / Delays, Invoices &amp; Milestones
          </div>
          <h1>Client Delay Notices &amp; Billing Settlement</h1>
          <p className="muted-note">
            Respond to contractor delay risks, verify variation invoices, and record
            payment settlement across {project.name}.
          </p>
        </div>
        <span className="badge badge-phase">Demo Payment &amp; Response Sync</span>
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      {/* Billing KPI Summary */}
      <div className="saas-kpi-grid">
        <div className="saas-kpi-card">
          <span className="kpi-label">Contractor Invoices Received</span>
          <strong className="kpi-value">{formatInr(totalInvoiced)}</strong>
          <span className="kpi-sub">{projInvoices.length} total claims</span>
        </div>
        <div className="saas-kpi-card kpi-ok">
          <span className="kpi-label">Payments Settled</span>
          <strong className="kpi-value">{formatInr(paidTotal)}</strong>
          <span className="kpi-sub">Disbursed to Apex MEP</span>
        </div>
        <div
          className={`saas-kpi-card ${pendingTotal > 0 ? "kpi-warn" : "kpi-ok"}`}
        >
          <span className="kpi-label">Outstanding Liability</span>
          <strong className="kpi-value">{formatInr(pendingTotal)}</strong>
          <span className="kpi-sub">Pending verification / disbursement</span>
        </div>
        <div
          className={`saas-kpi-card ${
            projDelays.some((d) => d.isOverdue) ? "kpi-danger" : ""
          }`}
        >
          <span className="kpi-label">Open Delay Notices</span>
          <strong className="kpi-value">
            {projDelays.filter((d) => d.status !== "mitigated").length}
          </strong>
          <span className="kpi-sub">
            {projDelays.filter((d) => d.isOverdue).length} past response due date
          </span>
        </div>
      </div>

      {/* Invoices Settlement Section */}
      <div className="saas-card section-spacer">
        <div className="saas-card-header">
          <h3>Submitted Contractor Invoices ({projInvoices.length})</h3>
          <span className="badge">Demo Action — Syncs to Contractor Billing</span>
        </div>

        {projInvoices.length === 0 ? (
          <div className="empty-state">No invoices submitted for this project yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="boq-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Variation / Milestone</th>
                  <th>Description</th>
                  <th>Due Date</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Client Commercial Action</th>
                </tr>
              </thead>
              <tbody>
                {projInvoices.map((inv) => (
                  <tr key={inv.id}>
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
                          Settled {inv.paidDate} ({inv.paymentRef ?? "Ref logged"})
                        </span>
                      ) : (
                        <div className="edit-row">
                          {inv.status !== "client_verified" && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                setInvoiceModal({
                                  invoice: inv,
                                  targetStatus: "client_verified",
                                })
                              }
                            >
                              Verify Invoice
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() =>
                              setInvoiceModal({
                                invoice: inv,
                                targetStatus: "paid",
                              })
                            }
                          >
                            Record Payment Settled
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delay Notifications */}
      <div className="saas-card section-spacer">
        <h3>Contractor Delay &amp; Obstruction Notices ({projDelays.length})</h3>
        {projDelays.length === 0 ? (
          <div className="empty-state">No contractor delay notices received.</div>
        ) : (
          <div className="saas-stack">
            {projDelays.map((d) => (
              <div key={d.id} className="action-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="saas-card-header" style={{ marginBottom: 6 }}>
                  <div>
                    <strong>{d.id}</strong> — <strong>{d.title}</strong>
                  </div>
                  <div className="edit-row">
                    {d.isOverdue && <span className="badge badge-err">OVERDUE</span>}
                    <span className="badge">{d.category}</span>
                    <span className="badge">{d.status.replace(/_/g, " ")}</span>
                  </div>
                </div>
                <p style={{ margin: "0 0 8px" }}>{d.description}</p>
                <p className="muted-note" style={{ margin: "0 0 8px" }}>
                  Milestone: {d.affectedMilestone} · Potential Exposure:{" "}
                  {d.potentialDaysImpact} days · Due Date: {d.dueDate} · Evidence:{" "}
                  {d.supportingEvidence}
                </p>

                {d.clientResponse && (
                  <div className="demo-inline-alert ok" style={{ marginBottom: 8 }}>
                    <strong>Recorded Client Response:</strong> {d.clientResponse}
                  </div>
                )}

                {replyDelayId === d.id ? (
                  <form onSubmit={(e) => handleSaveDelayReply(e, d.id)}>
                    <div className="edit-row" style={{ marginBottom: 8 }}>
                      <label htmlFor={`delay-status-${d.id}`}>Outcome Status:</label>
                      <select
                        id={`delay-status-${d.id}`}
                        className="status-select"
                        value={replyStatus}
                        onChange={(e) =>
                          setReplyStatus(e.target.value as DemoDelayItem["status"])
                        }
                      >
                        <option value="client_responded">Client Responded</option>
                        <option value="mitigated">Mitigated / Unblocked</option>
                      </select>
                    </div>
                    <textarea
                      rows={2}
                      required
                      style={{ width: "100%", padding: 8, marginBottom: 8 }}
                      placeholder="Enter official client direction, revised access window, or clarification..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                    />
                    <div className="edit-row">
                      <button type="submit" className="btn btn-primary">
                        Post Client Response (Demo)
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setReplyDelayId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setReplyDelayId(d.id);
                        setReplyText(d.clientResponse ?? "");
                      }}
                    >
                      {d.clientResponse ? "Update Client Response" : "Respond to Delay Notice"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Illustrative Milestone Schedule */}
      <div className="saas-card section-spacer">
        <div className="saas-card-header">
          <h3>Illustrative Milestone Schedule Visibility</h3>
          <span className="badge">Illustrative Project Schedule</span>
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
              </tr>
            </thead>
            <tbody>
              {projMilestones.map((m) => (
                <tr key={m.id}>
                  <td>{m.sequence}</td>
                  <td>
                    <strong>{m.name}</strong>
                  </td>
                  <td>{m.targetDate}</td>
                  <td className="num">{m.paymentPercent}%</td>
                  <td className="num">{formatInr(m.scheduledValue)}</td>
                  <td>
                    <span className="badge">{m.status.replace(/_/g, " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(invoiceModal)}
        title={
          invoiceModal?.targetStatus === "paid"
            ? `Record Payment Settled — ${invoiceModal.invoice.id}`
            : `Verify Invoice — ${invoiceModal?.invoice.id ?? ""}`
        }
        description={
          invoiceModal?.targetStatus === "paid"
            ? `Mark ${formatInr(invoiceModal.invoice.amount)} settled to ${project.contractor} (Demo simulation).`
            : `Confirm Client commercial check passed for ${invoiceModal?.invoice.id ?? ""} (${formatInr(
                invoiceModal?.invoice.amount
              )}).`
        }
        confirmLabel={
          invoiceModal?.targetStatus === "paid"
            ? "Record Paid (Demo)"
            : "Verify Invoice (Demo)"
        }
        confirmTone="primary"
        reasonLabel={
          invoiceModal?.targetStatus === "paid"
            ? "Simulated Bank / UTR Reference"
            : "Verification Remark"
        }
        initialReason={
          invoiceModal?.targetStatus === "paid"
            ? "UTR-HDFC-DEMO-90421"
            : "Approved variation & execution proof matched."
        }
        disclaimerNote="Simulated payment status update inside Demo mode only — no real bank/ERP payout."
        onCancel={() => setInvoiceModal(null)}
        onConfirm={handleConfirmInvoiceUpdate}
      />
    </div>
  );
}
