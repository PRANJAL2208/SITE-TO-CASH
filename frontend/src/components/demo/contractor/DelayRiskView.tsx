import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import type { DemoDelayItem } from "../../../demo/demoTypes";

const DELAY_CATEGORIES: DemoDelayItem["category"][] = [
  "Site Obstruction",
  "Drawing Revision Delay",
  "Material Lead Time",
  "Pending Client Decision",
  "Delayed Approval",
];

export default function DelayRiskView() {
  const { state, createDemoDelayNotice } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projDelays = state.delays.filter((d) => d.projectId === project.id);
  const projMilestones = state.milestones.filter((m) => m.projectId === project.id);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DemoDelayItem["category"]>(
    "Pending Client Decision"
  );
  const [dueDate, setDueDate] = useState("2026-11-26");
  const [affectedMilestone, setAffectedMilestone] = useState(
    projMilestones[2]?.name ?? "Second-Floor Completion"
  );
  const [potentialDaysImpact, setPotentialDaysImpact] = useState("5");
  const [supportingEvidence, setSupportingEvidence] = useState(
    "Site Daily Log + Subcontract Clause 14.2 Notice Record"
  );
  const [description, setDescription] = useState("");
  const [draftNoticeText, setDraftNoticeText] = useState(
    "Notice is hereby recorded regarding an active site/decision dependency impacting MEP installation sequencing. Please review and respond to mitigate critical-path extension."
  );
  const [banner, setBanner] = useState<string | null>(null);

  const openCount = projDelays.filter((d) => d.status === "open").length;
  const overdueCount = projDelays.filter((d) => d.isOverdue).length;
  const exposedDays = projDelays
    .filter((d) => d.status !== "mitigated")
    .reduce((sum, d) => sum + d.potentialDaysImpact, 0);

  const handleRaiseDelay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    createDemoDelayNotice({
      projectId: project.id,
      title: title.trim(),
      category,
      dueDate: dueDate || "2026-11-26",
      affectedMilestone: affectedMilestone.trim() || "Second-Floor Completion",
      potentialDaysImpact: Math.max(0, Number(potentialDaysImpact) || 0),
      description: description.trim(),
      supportingEvidence: supportingEvidence.trim() || "Site Log",
      draftNoticeText: draftNoticeText.trim(),
      raisedBy: "Vikash Kulkarni (MEP Project Manager)",
    });
    setBanner(
      `Delay notice "${title.trim()}" logged (Demo Draft) and surfaced to Client Delays & Billing Portal.`
    );
    setTitle("");
    setDescription("");
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Contractor View / Delay &amp; Schedule Risk</div>
          <h1>Delay &amp; Notice Protection Register</h1>
          <p className="muted-note">
            Track overdue client decisions, drawing holds, and site obstructions with written
            notice evidence to protect contractual EOT windows.
          </p>
        </div>
        <span className="badge badge-phase">Demo Draft Notices</span>
      </div>

      <div className="warning-banner">
        <strong>Commercial Guardrail:</strong> System records contractor delay notices and
        milestone flags for visibility only. Neither AI nor this dashboard calculates
        contractual Extension of Time (EOT) entitlement or liquidated damages relief.
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      {/* Summary KPI Row */}
      <div className="saas-kpi-grid">
        <div className={`saas-kpi-card ${openCount > 0 ? "kpi-warn" : ""}`}>
          <span className="kpi-label">Open Delay Events</span>
          <strong className="kpi-value">{openCount}</strong>
          <span className="kpi-sub">Across {project.name}</span>
        </div>
        <div className={`saas-kpi-card ${overdueCount > 0 ? "kpi-danger" : ""}`}>
          <span className="kpi-label">Overdue Response Flags</span>
          <strong className="kpi-value">{overdueCount}</strong>
          <span className="kpi-sub">Requires urgent client reply</span>
        </div>
        <div className="saas-kpi-card">
          <span className="kpi-label">Unmitigated Schedule Exposure</span>
          <strong className="kpi-value">{exposedDays} days</strong>
          <span className="kpi-sub">Reported contractor impact estimate</span>
        </div>
        <div className="saas-kpi-card kpi-ok">
          <span className="kpi-label">Client Responded / Mitigated</span>
          <strong className="kpi-value">
            {projDelays.length - openCount}
          </strong>
          <span className="kpi-sub">Of {projDelays.length} recorded notices</span>
        </div>
      </div>

      <div className="saas-two-col">
        {/* Existing Delay Items */}
        <div className="saas-card">
          <h3>Recorded Delays &amp; Escalation Notices ({projDelays.length})</h3>
          {projDelays.length === 0 ? (
            <div className="empty-state">No delay notices logged for this project.</div>
          ) : (
            <div className="saas-stack">
              {projDelays.map((d) => (
                <div key={d.id} className="action-item">
                  <div className="saas-card-header" style={{ marginBottom: 6 }}>
                    <div>
                      <strong>{d.id}</strong> — <strong>{d.title}</strong>
                    </div>
                    <div className="edit-row">
                      {d.isOverdue && <span className="badge badge-err">OVERDUE</span>}
                      <span className="badge">{d.category}</span>
                      <span
                        className={`badge ${
                          d.status === "mitigated"
                            ? "badge-ok"
                            : d.status === "client_responded"
                            ? "badge-phase"
                            : "badge-qs"
                        }`}
                      >
                        {d.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: "0 0 8px" }}>{d.description}</p>

                  <div className="kv-list" style={{ marginBottom: 8 }}>
                    <div>
                      <span>Affected Milestone:</span>
                      <strong>{d.affectedMilestone}</strong>
                    </div>
                    <div>
                      <span>Potential Exposure:</span>
                      <strong>{d.potentialDaysImpact} days</strong>
                    </div>
                    <div>
                      <span>Response Due Date:</span>
                      <strong>{d.dueDate}</strong>
                    </div>
                    <div>
                      <span>Supporting Evidence:</span>
                      <strong>{d.supportingEvidence}</strong>
                    </div>
                  </div>

                  <div className="demo-inline-alert info">
                    <strong>Draft Notice Text (Demo — Not Sent Externally):</strong>
                    <p style={{ margin: "4px 0 0", fontSize: "0.86rem" }}>
                      {d.draftNoticeText}
                    </p>
                  </div>

                  {d.clientResponse && (
                    <div className="demo-inline-alert ok" style={{ marginTop: 8 }}>
                      <strong>Client Response Logged:</strong> {d.clientResponse}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Raise New Delay Notification */}
        <div className="saas-card">
          <h3>Raise Delay Notification (Demo Draft)</h3>
          <form onSubmit={handleRaiseDelay}>
            <div className="field-group">
              <label htmlFor="delay-title">Delay / Hold Title</label>
              <input
                id="delay-title"
                required
                placeholder="e.g. Shaft Fire-Barrier Clearance Pending in Core B"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="cost-settings-grid">
              <div className="field-group">
                <label htmlFor="delay-cat">Category</label>
                <select
                  id="delay-cat"
                  className="status-select"
                  style={{ width: "100%" }}
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as DemoDelayItem["category"])
                  }
                >
                  {DELAY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="delay-due">Response Due Date</label>
                <input
                  id="delay-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="delay-days">Est. Exposure (Days)</label>
                <input
                  id="delay-days"
                  type="number"
                  min={0}
                  value={potentialDaysImpact}
                  onChange={(e) => setPotentialDaysImpact(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="delay-ms">Affected Project Milestone</label>
              <select
                id="delay-ms"
                className="status-select"
                style={{ width: "100%" }}
                value={affectedMilestone}
                onChange={(e) => setAffectedMilestone(e.target.value)}
              >
                {projMilestones.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name} (Target {m.targetDate})
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="delay-ev">Supporting Evidence Reference</label>
              <input
                id="delay-ev"
                value={supportingEvidence}
                onChange={(e) => setSupportingEvidence(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="delay-desc">Factual Site Impact Description</label>
              <textarea
                id="delay-desc"
                required
                rows={3}
                placeholder="Describe access hold, late drawing revision, or pending commercial approval..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="delay-draft">Formal Delay Notice Draft</label>
              <textarea
                id="delay-draft"
                rows={3}
                value={draftNoticeText}
                onChange={(e) => setDraftNoticeText(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Record Delay Notice (Demo — Visible in Client Portal)
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
