import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import type { DemoEvidenceItem } from "../../../demo/demoTypes";
import EvidencePreviewCard from "../shared/EvidencePreviewCard";

export default function ProgressEvidence() {
  const { state, addProgressUpdate, openVariation } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projVars = state.variations.filter((v) => v.projectId === project.id);
  const projProgress = state.progressEntries.filter((p) => p.projectId === project.id);

  const defaultVar =
    projVars.find((v) => v.id === "VAR-SCT-004" && v.status === "client_approved") ??
    projVars.find((v) => v.status === "client_approved" || v.status === "partially_approved") ??
    projVars[0];

  const [variationId, setVariationId] = useState<string>(defaultVar?.id ?? "");
  const [floorLocation, setFloorLocation] = useState("2nd Floor — East Ceiling Void");
  const [completionPercent, setCompletionPercent] = useState("100");
  const [date, setDate] = useState("2026-11-21");
  const [submittedBy, setSubmittedBy] = useState("Arjun Verma (Site Engineer)");
  const [photoKind, setPhotoKind] = useState<"site_photo" | "ceiling_markup">("site_photo");
  const [photoCaption, setPhotoCaption] = useState(
    "Relocated 2F galvanized supply ductwork & dampers installed per IFC Rev-C; pressure test passed."
  );
  const [workDescription, setWorkDescription] = useState(
    "Completed physical rerouting of 2F East HVAC supply branch around revised architectural lighting bulkhead, including VCD damper re-termination."
  );
  const [docsInput, setDocsInput] = useState(
    "2F_Completion_Photo_RevC.jpg, HVAC_Pressure_Test_Log.pdf"
  );
  const [markExecuted, setMarkExecuted] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const linkedVar = projVars.find((v) => v.id === variationId) ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workDescription.trim()) return;
    const pct = Math.min(100, Math.max(0, Number(completionPercent) || 0));
    const supportingDocs = docsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    addProgressUpdate({
      projectId: project.id,
      variationId: variationId || null,
      workDescription: workDescription.trim(),
      floorLocation: floorLocation.trim() || "Site Zone",
      completionPercent: pct,
      date: date || "2026-11-21",
      submittedBy: submittedBy.trim() || "Site Engineer",
      photoKind,
      photoCaption: photoCaption.trim() || workDescription.trim(),
      supportingDocs,
      markVariationExecuted: Boolean(variationId && markExecuted),
    });

    setBanner(
      `Progress update logged for ${variationId || project.name}${
        variationId && markExecuted ? " and variation marked Executed (ready for billing)." : "."
      } Preview added to Client Progress View.`
    );
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Contractor View / Site Execution Evidence</div>
          <h1>Work Progress &amp; Completion Evidence</h1>
          <p className="muted-note">
            Document completed base-contract and approved variation work on site so billing
            milestones remain backed by dated photo proof and client visibility.
          </p>
        </div>
        <span className="badge badge-phase">Simulated Client Preview Sync</span>
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      <div className="saas-two-col">
        {/* Form: Log Progress & Site Evidence */}
        <div className="saas-card">
          <h3>Log Site Progress &amp; Supporting Evidence (Demo)</h3>
          <form onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="prog-var">Linked Variation (Optional)</label>
              <select
                id="prog-var"
                className="status-select"
                style={{ width: "100%" }}
                value={variationId}
                onChange={(e) => setVariationId(e.target.value)}
              >
                <option value="">General Base Contract Works</option>
                {projVars.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} — {v.title} ({v.status.replace(/_/g, " ")})
                  </option>
                ))}
              </select>
            </div>

            <div className="cost-settings-grid">
              <div className="field-group">
                <label htmlFor="prog-floor">Floor / Zone</label>
                <input
                  id="prog-floor"
                  value={floorLocation}
                  onChange={(e) => setFloorLocation(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="prog-pct">Completion %</label>
                <input
                  id="prog-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={completionPercent}
                  onChange={(e) => setCompletionPercent(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="prog-date">Execution Date</label>
                <input
                  id="prog-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div className="cost-settings-grid">
              <div className="field-group">
                <label htmlFor="prog-by">Submitted By</label>
                <input
                  id="prog-by"
                  value={submittedBy}
                  onChange={(e) => setSubmittedBy(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="prog-kind">Visual Evidence Diagram</label>
                <select
                  id="prog-kind"
                  className="status-select"
                  style={{ width: "100%" }}
                  value={photoKind}
                  onChange={(e) =>
                    setPhotoKind(e.target.value as "site_photo" | "ceiling_markup")
                  }
                >
                  <option value="site_photo">Site Installation Photo Preview</option>
                  <option value="ceiling_markup">Annotated Ceiling Markup</option>
                </select>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="prog-desc">Executed Work Description</label>
              <textarea
                id="prog-desc"
                rows={3}
                value={workDescription}
                onChange={(e) => setWorkDescription(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="prog-caption">Photo / Drawing Caption</label>
              <input
                id="prog-caption"
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="prog-docs">Supporting Document Refs (comma-separated)</label>
              <input
                id="prog-docs"
                value={docsInput}
                onChange={(e) => setDocsInput(e.target.value)}
              />
            </div>

            {linkedVar && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={markExecuted}
                  onChange={(e) => setMarkExecuted(e.target.checked)}
                />
                <span>
                  Mark <strong>{linkedVar.id}</strong> status as <strong>Executed</strong>{" "}
                  (unlocks Variation Invoice in Billing)
                </span>
              </label>
            )}

            <button type="submit" className="btn btn-primary">
              Record Site Progress &amp; Notify Client Portal (Demo)
            </button>
          </form>
        </div>

        {/* Feed of Recorded Progress Entries */}
        <div className="saas-card">
          <h3>Logged Progress &amp; Photo Proof ({projProgress.length})</h3>
          {projProgress.length === 0 ? (
            <div className="empty-state">No progress entries logged for this project yet.</div>
          ) : (
            <div className="saas-stack">
              {projProgress.map((entry) => {
                const evPreview: DemoEvidenceItem = {
                  id: `EV-${entry.id}`,
                  title: `${entry.floorLocation} (${entry.completionPercent}%)`,
                  kind: entry.photoKind,
                  caption: entry.photoCaption,
                  location: entry.floorLocation,
                  capturedAt: entry.date,
                  capturedBy: entry.submittedBy,
                  sourceRef: entry.supportingDocs[0] ?? "Site Photo Log",
                };
                return (
                  <div key={entry.id} className="action-item">
                    <div className="saas-card-header" style={{ marginBottom: 8 }}>
                      <div>
                        <strong>{entry.id}</strong>{" "}
                        {entry.variationId && (
                          <button
                            type="button"
                            className="ref-pill"
                            style={{ cursor: "pointer" }}
                            onClick={() =>
                              openVariation(entry.variationId!, "contractor")
                            }
                          >
                            {entry.variationId}
                          </button>
                        )}
                      </div>
                      <span className="badge badge-ok">{entry.completionPercent}% Complete</span>
                    </div>

                    <p style={{ margin: "0 0 8px" }}>{entry.workDescription}</p>
                    <p className="muted-note" style={{ margin: "0 0 8px" }}>
                      Location: {entry.floorLocation} · Date: {entry.date} · By:{" "}
                      {entry.submittedBy}
                    </p>

                    <div className="progress-bar-track" style={{ marginBottom: 10 }}>
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${entry.completionPercent}%` }}
                      />
                    </div>

                    <EvidencePreviewCard item={evPreview} />

                    <div className="demo-inline-alert info" style={{ marginTop: 10 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <strong>Client Notification Preview (Demo — not sent)</strong>
                        {entry.clientAcknowledgedReceipt ? (
                          <span className="badge badge-ok">
                            Receipt Acknowledged by {entry.clientAcknowledgedBy} (Not
                            Contractual Approval)
                          </span>
                        ) : (
                          <span className="badge">Awaiting Client Receipt</span>
                        )}
                      </div>
                      <p style={{ margin: "6px 0 0", fontSize: "0.86rem" }}>
                        {entry.clientNotificationPreview}
                      </p>
                    </div>

                    {entry.clientComments.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <strong style={{ fontSize: "0.84rem" }}>
                          Client Portal Notes ({entry.clientComments.length}):
                        </strong>
                        {entry.clientComments.map((c) => (
                          <div
                            key={c.id}
                            className="muted-note"
                            style={{ marginTop: 4, paddingLeft: 8, borderLeft: "2px solid var(--border)" }}
                          >
                            <strong>{c.author}</strong> ({c.kind === "info_request" ? "Info Request" : "Comment"}):{" "}
                            {c.text} · <em>{c.timestamp}</em>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
