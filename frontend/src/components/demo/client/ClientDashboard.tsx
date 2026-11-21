import { useDemo } from "../../../demo/DemoContext";
import { formatInr } from "../../../demo/demoSeed";
import ActivityTimeline from "../shared/ActivityTimeline";

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

export default function ClientDashboard() {
  const {
    state,
    setClientPage,
    openVariation,
    setRole,
  } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projVars = state.variations.filter(
    (v) => v.projectId === project.id && CLIENT_VISIBLE_STATUSES.has(v.status)
  );
  const awaitingDecision = projVars.filter(
    (v) => v.status === "submitted_to_client" || v.status === "clarification_requested"
  );
  const awaitingValue = awaitingDecision.reduce(
    (sum, v) => sum + (v.proposedAmount ?? 0),
    0
  );
  const approvedValue = projVars.reduce((sum, v) => sum + (v.approvedAmount ?? 0), 0);
  const rejectedCount = projVars.filter((v) => v.status === "client_rejected").length;
  const projProgress = state.progressEntries.filter((p) => p.projectId === project.id);
  const projMilestones = state.milestones.filter((m) => m.projectId === project.id);
  const nextMilestone =
    projMilestones.find((m) => m.status !== "completed") ?? projMilestones[0];
  const projDelays = state.delays.filter((d) => d.projectId === project.id);
  const openDelays = projDelays.filter((d) => d.status !== "mitigated");
  const projInvoices = state.invoices.filter((i) => i.projectId === project.id);
  const outstandingInvoices = projInvoices.filter((i) => i.status !== "paid");
  const outstandingAmount = outstandingInvoices.reduce((s, i) => s + i.amount, 0);
  const projActivities = state.activities.filter((a) => a.projectId === project.id);

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Client View / Commercial Portal</div>
          <h1>Client Project &amp; Change Control Portal</h1>
          <p className="muted-note">
            Owner review workspace for <strong>{project.client}</strong> overseeing{" "}
            <strong>{project.name}</strong> (Subcontractor: {project.contractor}).
          </p>
        </div>
        <div className="edit-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setClientPage("client_variations")}
          >
            Review Submitted Variations ({awaitingDecision.length})
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setRole("contractor")}
          >
            Switch to Contractor View
          </button>
        </div>
      </div>

      {/* Client KPIs */}
      <div className="saas-kpi-grid">
        <div
          className={`saas-kpi-card ${awaitingDecision.length > 0 ? "kpi-warn" : ""}`}
        >
          <span className="kpi-label">Awaiting Client Decision</span>
          <strong className="kpi-value">{awaitingDecision.length}</strong>
          <span className="kpi-sub">{formatInr(awaitingValue)} proposed exposure</span>
        </div>
        <div className="saas-kpi-card kpi-ok">
          <span className="kpi-label">Approved Variation Commitment</span>
          <strong className="kpi-value">{formatInr(approvedValue)}</strong>
          <span className="kpi-sub">Rejected count: {rejectedCount}</span>
        </div>
        <div className="saas-kpi-card">
          <span className="kpi-label">Reported Physical Progress</span>
          <strong className="kpi-value">{project.overallProgressPercent}%</strong>
          <span className="kpi-sub">
            Next milestone: {nextMilestone ? nextMilestone.name : "—"}
          </span>
        </div>
        <div
          className={`saas-kpi-card ${openDelays.length > 0 ? "kpi-danger" : "kpi-ok"}`}
        >
          <span className="kpi-label">Open Contractor Delay Notices</span>
          <strong className="kpi-value">{openDelays.length}</strong>
          <span className="kpi-sub">
            {openDelays.filter((d) => d.isOverdue).length} overdue client responses
          </span>
        </div>
        <div
          className={`saas-kpi-card ${
            outstandingAmount > 0 ? "kpi-warn" : "kpi-ok"
          }`}
        >
          <span className="kpi-label">Pending Contractor Invoices</span>
          <strong className="kpi-value">{formatInr(outstandingAmount)}</strong>
          <span className="kpi-sub">{outstandingInvoices.length} unpaid invoice(s)</span>
        </div>
      </div>

      <div className="saas-two-col">
        {/* Left: Submitted Variation Queue + Recent Progress */}
        <div className="saas-stack">
          <div className="saas-card">
            <div className="saas-card-header">
              <h3>Variations Submitted for Client Review</h3>
              <button
                type="button"
                className="btn"
                onClick={() => setClientPage("client_variations")}
              >
                Open Review Inbox
              </button>
            </div>

            {projVars.length === 0 ? (
              <div className="empty-state">
                No variations have been dispatched to the Client yet for this project.
              </div>
            ) : (
              <div className="action-list">
                {projVars.map((v) => (
                  <div key={v.id} className="action-item">
                    <div className="action-item-main">
                      <div className="edit-row">
                        <strong>{v.id}</strong>
                        <span>{v.title}</span>
                        <span
                          className={`badge ${
                            v.status === "client_approved" ||
                            v.status === "executed" ||
                            v.status === "billed" ||
                            v.status === "paid"
                              ? "badge-ok"
                              : v.status === "client_rejected"
                              ? "badge-err"
                              : "badge-qs"
                          }`}
                        >
                          {v.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="muted-note" style={{ margin: "4px 0 0" }}>
                        Proposed: <strong>{formatInr(v.proposedAmount)}</strong> · Approved:{" "}
                        <strong>{formatInr(v.approvedAmount, "Pending")}</strong> · Submitted:{" "}
                        {v.submittedDate ?? v.contractorApproval.dispatchedAt ?? "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openVariation(v.id, "client")}
                    >
                      Inspect &amp; Decide
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="saas-card">
            <div className="saas-card-header">
              <h3>Recent Contractor Progress Submissions</h3>
              <button
                type="button"
                className="btn"
                onClick={() => setClientPage("client_progress")}
              >
                Open Progress View
              </button>
            </div>

            {projProgress.length === 0 ? (
              <div className="empty-state">No progress logs received yet.</div>
            ) : (
              <div className="action-list">
                {projProgress.slice(0, 3).map((p) => (
                  <div key={p.id} className="action-item">
                    <div className="action-item-main">
                      <strong>{p.floorLocation}</strong> ({p.completionPercent}%)
                      <p className="muted-note" style={{ margin: "3px 0 0" }}>
                        {p.workDescription}
                      </p>
                    </div>
                    {p.clientAcknowledgedReceipt ? (
                      <span className="badge badge-ok">Receipt Logged</span>
                    ) : (
                      <span className="badge badge-qs">Unacknowledged</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Delays / Billing Summary + Timeline */}
        <div className="saas-stack">
          <div className="saas-card">
            <div className="saas-card-header">
              <h3>Delays, Milestones &amp; Pending Bills</h3>
              <button
                type="button"
                className="btn"
                onClick={() => setClientPage("client_delays_billing")}
              >
                Open Delays &amp; Billing
              </button>
            </div>

            <div className="kv-list" style={{ marginBottom: 12 }}>
              <div>
                <span>Client PM / Representative:</span>
                <strong>Vikram Malhotra (Skyline Developers)</strong>
              </div>
              <div>
                <span>Commercial Signatory:</span>
                <strong>Siddharth Rao (Commercial Approver)</strong>
              </div>
              <div>
                <span>Upcoming Target Milestone:</span>
                <strong>
                  {nextMilestone
                    ? `${nextMilestone.name} (${nextMilestone.targetDate})`
                    : "None"}
                </strong>
              </div>
              <div>
                <span>Unpaid / Overdue Bills:</span>
                <strong>
                  {outstandingInvoices.length} invoices ({formatInr(outstandingAmount)})
                </strong>
              </div>
            </div>

            {openDelays.slice(0, 2).map((d) => (
              <div
                key={d.id}
                className={`demo-inline-alert ${d.isOverdue ? "warn" : "info"}`}
                style={{ marginTop: 8 }}
              >
                <strong>
                  {d.id}: {d.title}
                </strong>{" "}
                ({d.potentialDaysImpact}d risk · Due {d.dueDate})
              </div>
            ))}
          </div>

          <div className="saas-card">
            <h3>Shared Commercial Activity Feed</h3>
            <ActivityTimeline events={projActivities} maxItems={6} />
          </div>
        </div>
      </div>
    </div>
  );
}
