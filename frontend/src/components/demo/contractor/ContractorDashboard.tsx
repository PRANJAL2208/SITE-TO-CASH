import { useDemo } from "../../../demo/DemoContext";
import { formatInr } from "../../../demo/demoSeed";
import ActivityTimeline from "../shared/ActivityTimeline";

export default function ContractorDashboard() {
  const {
    state,
    setContractorPage,
    openVariation,
    setSelectedProjectId,
  } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projVariations = state.variations.filter((v) => v.projectId === project.id);
  const projMilestones = state.milestones.filter((m) => m.projectId === project.id);
  const projInvoices = state.invoices.filter((i) => i.projectId === project.id);
  const projDelays = state.delays.filter((d) => d.projectId === project.id);
  const projActivities = state.activities.filter((a) => a.projectId === project.id);

  const openVariations = projVariations.filter(
    (v) => v.status !== "paid" && v.status !== "client_rejected"
  );
  const awaitingContractor = projVariations.filter((v) =>
    ["detected", "qs_review", "ready_for_contractor_approval", "contractor_approved"].includes(
      v.status
    )
  );
  const awaitingClient = projVariations.filter(
    (v) => v.status === "submitted_to_client" || v.status === "clarification_requested"
  );
  const approvedValue = projVariations.reduce(
    (sum, v) => sum + (v.approvedAmount ?? 0),
    0
  );
  const executedNotBilled = projVariations
    .filter((v) => v.status === "executed")
    .reduce((sum, v) => sum + (v.executedAmount ?? v.approvedAmount ?? 0), 0);
  const outstandingPayments = projInvoices
    .filter((inv) => inv.status !== "paid")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const heroVar =
    projVariations.find((v) => v.id === "VAR-SCT-004") ?? projVariations[0];

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Contractor View / Commercial Overview</div>
          <h1>Contractor Commercial Dashboard</h1>
          <p className="muted-note">
            Portfolio &amp; active project control for{" "}
            <strong>{project.contractor}</strong> on{" "}
            <strong>{project.name}</strong> ({project.location}).
          </p>
        </div>
        <div className="edit-row">
          {heroVar && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openVariation(heroVar.id, "contractor")}
            >
              Inspect {heroVar.id}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => setContractorPage("inbox")}
          >
            + Capture Site Instruction
          </button>
        </div>
      </div>

      {/* KPI Summary Hierarchy: Primary Operational Counts + Commercial Exposure */}
      <div className="kpi-stack">
        <div className="saas-kpi-grid-primary">
          <div className="saas-kpi-card kpi-primary kpi-neutral">
            <div className="kpi-label">Active Projects</div>
            <div className="kpi-value">{state.projects.length}</div>
            <div className="meta-line">Skyline Tower + Nexus Medical</div>
          </div>
          <div className="saas-kpi-card kpi-primary kpi-info">
            <div className="kpi-label">Open Variations ({project.code})</div>
            <div className="kpi-value">{openVariations.length}</div>
            <div className="meta-line">Across HVAC, Elec &amp; Plumbing</div>
          </div>
          <div className="saas-kpi-card kpi-primary kpi-warn">
            <div className="kpi-label">Awaiting Contractor Approval</div>
            <div className="kpi-value">{awaitingContractor.length}</div>
            <div className="meta-line">QS review / Director sign-off</div>
          </div>
          <div className="saas-kpi-card kpi-primary kpi-client">
            <div className="kpi-label">Awaiting Client Decision</div>
            <div className="kpi-value">{awaitingClient.length}</div>
            <div className="meta-line">Submitted / clarification pending</div>
          </div>
        </div>

        <div className="saas-kpi-grid-secondary">
          <div className="saas-kpi-card kpi-secondary kpi-ok">
            <div className="kpi-label">Client-Approved Variation Value</div>
            <div className="kpi-value">{formatInr(approvedValue)}</div>
            <div className="meta-line">Strictly signed CVO value only</div>
          </div>
          <div className="saas-kpi-card kpi-secondary kpi-warn">
            <div className="kpi-label">Completed Not Billed</div>
            <div className="kpi-value">{formatInr(executedNotBilled)}</div>
            <div className="meta-line">Executed variations ready to invoice</div>
          </div>
          <div className="saas-kpi-card kpi-secondary kpi-danger">
            <div className="kpi-label">Outstanding Payments</div>
            <div className="kpi-value">{formatInr(outstandingPayments)}</div>
            <div className="meta-line">
              {projInvoices.filter((i) => i.status === "overdue").length} overdue
              invoice(s)
            </div>
          </div>
        </div>
      </div>

      <div className="saas-two-col">
        {/* Left Column: Pending Actions + Milestones */}
        <div className="saas-col">
          <div className="saas-card">
            <div className="panel-header">
              <h3>Priority Pending Actions</h3>
              <span className="badge badge-ai">Action Required</span>
            </div>
            <ul className="action-list">
              {awaitingContractor.map((v) => (
                <li key={v.id} className="action-item">
                  <div>
                    <strong>{v.id}: {v.title}</strong>
                    <div className="meta-line">
                      Status: <code>{v.status.replace(/_/g, " ")}</code> · Proposed:{" "}
                      {formatInr(v.revisedAmount ?? v.proposedAmount, "Unpriced")}
                    </div>
                  </div>
                  <div className="edit-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openVariation(v.id, "contractor")}
                    >
                      Open Case
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        openVariation(v.id, "contractor");
                        setContractorPage("approval_workflow");
                      }}
                    >
                      Approval Flow
                    </button>
                  </div>
                </li>
              ))}
              {projDelays
                .filter((d) => d.status === "open")
                .map((d) => (
                  <li key={d.id} className="action-item">
                    <div>
                      <strong>{d.id}: {d.title}</strong>
                      <div className="meta-line">
                        {d.isOverdue ? "OVERDUE" : "Open"} · Affects{" "}
                        {d.affectedMilestone} (+{d.potentialDaysImpact} days)
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setContractorPage("delays")}
                    >
                      Review Delay
                    </button>
                  </li>
                ))}
              {executedNotBilled > 0 && (
                <li className="action-item">
                  <div>
                    <strong>Bill Executed Variation (VAR-SCT-002)</strong>
                    <div className="meta-line">
                      {formatInr(executedNotBilled)} executed work awaiting running bill
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setContractorPage("billing")}
                  >
                    Raise Invoice
                  </button>
                </li>
              )}
            </ul>
          </div>

          <div className="saas-card">
            <div className="panel-header">
              <h3>Upcoming Project Milestones</h3>
              <button
                type="button"
                className="btn"
                onClick={() => setContractorPage("billing")}
              >
                Payment Schedule
              </button>
            </div>
            {projMilestones.length === 0 ? (
              <div className="empty-state">No milestones seeded for this project.</div>
            ) : (
              <div className="table-wrap">
                <table className="boq-table">
                  <thead>
                    <tr>
                      <th>Milestone</th>
                      <th>Target Date</th>
                      <th className="num-cell">Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projMilestones.map((ms) => (
                      <tr key={ms.id}>
                        <td>
                          <strong>{ms.name}</strong>
                          <div className="meta-line">{ms.notes}</div>
                        </td>
                        <td>{ms.targetDate}</td>
                        <td className="num-cell">{formatInr(ms.scheduledValue)}</td>
                        <td>
                          <span
                            className={`badge ${
                              ms.status === "completed"
                                ? "badge-ok"
                                : ms.status === "at_risk"
                                  ? "badge-err"
                                  : "badge-phase"
                            }`}
                          >
                            {ms.status.replace(/_/g, " ").toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="saas-card">
            <div className="panel-header">
              <h3>Active Projects Portfolio</h3>
            </div>
            <div className="project-pills project-pills-grid">
              {state.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`project-tile ${
                    p.id === project.id ? "active" : ""
                  }`}
                  onClick={() => setSelectedProjectId(p.id)}
                >
                  <div className="panel-header">
                    <strong>{p.name}</strong>
                    <span className="badge badge-phase">{p.overallProgressPercent}%</span>
                  </div>
                  <div className="meta-line">
                    {p.location} · Client: {p.client} · {p.trade}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Live Activity Timeline */}
        <div className="saas-col">
          <div className="saas-card">
            <div className="panel-header">
              <h3>Recent Activity Timeline</h3>
              <span className="badge badge-phase">Live Demo State</span>
            </div>
            <p className="muted-note card-lead">
              Synchronizes automatically across Contractor and Client views during the presentation.
            </p>
            <ActivityTimeline events={projActivities} maxItems={8} />
          </div>
        </div>
      </div>
    </div>
  );
}
