import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import type { DemoEvidenceItem } from "../../../demo/demoTypes";
import EvidencePreviewCard from "../shared/EvidencePreviewCard";

export default function ClientProgressView() {
  const {
    state,
    acknowledgeProgressReceipt,
    addProgressComment,
    openVariation,
  } = useDemo();

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const projProgress = state.progressEntries.filter((p) => p.projectId === project.id);
  const projMilestones = state.milestones.filter((m) => m.projectId === project.id);

  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(
    projProgress[0]?.id ?? null
  );
  const [composerForId, setComposerForId] = useState<string | null>(null);
  const [composerKind, setComposerKind] = useState<"comment" | "info_request">("comment");
  const [commentText, setCommentText] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  const handleAcknowledge = (progressId: string) => {
    acknowledgeProgressReceipt(progressId, "Vikram Malhotra (Client PM)");
    setBanner(
      `Receipt logged for ${progressId}. Explicitly marked: "Receipt Acknowledged — Not Contractual Approval".`
    );
  };

  const handleSubmitComment = (e: React.FormEvent, progressId: string) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addProgressComment(
      progressId,
      "Vikram Malhotra (Client PM)",
      commentText.trim(),
      composerKind
    );
    setBanner(
      `${
        composerKind === "info_request" ? "Information request" : "Comment"
      } recorded on ${progressId} and shared with Contractor Progress View.`
    );
    setCommentText("");
    setComposerForId(null);
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Client View / Site Progress &amp; Verification</div>
          <h1>Client Site Progress &amp; Completion Evidence</h1>
          <p className="muted-note">
            Review contractor execution reports, site photography, and milestone completion
            on <strong>{project.name}</strong>.
          </p>
        </div>
        <span className="badge badge-phase">Receipt ≠ Contractual Approval</span>
      </div>

      <div className="warning-banner">
        <strong>Client Verification Guardrail:</strong> Acknowledging receipt of progress
        evidence confirms visual delivery of site records only and does not replace
        Engineer/QS payment certification.
      </div>

      {banner && <div className="success-banner">{banner}</div>}

      {/* Milestone Strip */}
      <div className="saas-card section-spacer">
        <h3>Milestone Completion Snapshot ({project.overallProgressPercent}% Overall)</h3>
        <div className="saas-four-col" style={{ marginTop: 10 }}>
          {projMilestones.map((m) => (
            <div key={m.id} className="action-item" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <div className="saas-card-header" style={{ width: "100%", marginBottom: 4 }}>
                <strong>{m.name}</strong>
                <span
                  className={`badge ${
                    m.status === "completed"
                      ? "badge-ok"
                      : m.status === "at_risk"
                      ? "badge-err"
                      : "badge-qs"
                  }`}
                >
                  {m.status.replace(/_/g, " ")}
                </span>
              </div>
              <span className="muted-note">
                Target: {m.targetDate} · Weight {m.paymentPercent}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Progress Cards */}
      <div className="saas-stack section-spacer">
        {projProgress.length === 0 ? (
          <div className="empty-state">
            No contractor progress updates submitted for this project yet.
          </div>
        ) : (
          projProgress.map((entry) => {
            const evPreview: DemoEvidenceItem = {
              id: `CLIENT-EV-${entry.id}`,
              title: `${entry.floorLocation} (${entry.completionPercent}%)`,
              kind: entry.photoKind,
              caption: entry.photoCaption,
              location: entry.floorLocation,
              capturedAt: entry.date,
              capturedBy: entry.submittedBy,
              sourceRef: entry.supportingDocs[0] ?? "Site Record",
            };
            const isExpanded = expandedEvidenceId === entry.id;

            return (
              <div key={entry.id} className="saas-card">
                <div className="saas-card-header">
                  <div>
                    <div className="edit-row">
                      <strong>{entry.id}</strong>
                      <span>· {entry.floorLocation}</span>
                      {entry.variationId && (
                        <button
                          type="button"
                          className="ref-pill"
                          style={{ cursor: "pointer" }}
                          onClick={() => openVariation(entry.variationId!, "client")}
                        >
                          {entry.variationId}
                        </button>
                      )}
                    </div>
                    <p className="muted-note" style={{ margin: "4px 0 0" }}>
                      Submitted {entry.date} by {entry.submittedBy}
                    </p>
                  </div>
                  <div className="edit-row">
                    <span className="badge badge-ok">{entry.completionPercent}% Complete</span>
                    {entry.clientAcknowledgedReceipt ? (
                      <span className="badge badge-ok">
                        Receipt Acknowledged — Not Contractual Approval
                      </span>
                    ) : (
                      <span className="badge badge-qs">Pending Client Receipt</span>
                    )}
                  </div>
                </div>

                <p style={{ margin: "6px 0 10px" }}>{entry.workDescription}</p>

                <div className="progress-bar-track" style={{ marginBottom: 12 }}>
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${entry.completionPercent}%` }}
                  />
                </div>

                <div className="citation-list" style={{ marginBottom: 12 }}>
                  {entry.supportingDocs.map((doc) => (
                    <span key={doc} className="citation-chip">
                      📄 {doc}
                    </span>
                  ))}
                </div>

                <div className="edit-row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setExpandedEvidenceId(isExpanded ? null : entry.id)
                    }
                  >
                    {isExpanded ? "Hide Visual Evidence" : "View Evidence"}
                  </button>
                  {!entry.clientAcknowledgedReceipt && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleAcknowledge(entry.id)}
                    >
                      Acknowledge Receipt
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setComposerForId(entry.id);
                      setComposerKind("comment");
                    }}
                  >
                    Add Comment
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning"
                    onClick={() => {
                      setComposerForId(entry.id);
                      setComposerKind("info_request");
                    }}
                  >
                    Request Additional Information
                  </button>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 12, maxWidth: 480 }}>
                    <EvidencePreviewCard item={evPreview} />
                  </div>
                )}

                {composerForId === entry.id && (
                  <form
                    onSubmit={(e) => handleSubmitComment(e, entry.id)}
                    className="action-item"
                    style={{ marginTop: 12, flexDirection: "column", alignItems: "stretch" }}
                  >
                    <strong>
                      {composerKind === "info_request"
                        ? "Request Additional Information from Contractor"
                        : "Add Client Inspection Comment"}
                    </strong>
                    <textarea
                      rows={2}
                      required
                      style={{ margin: "8px 0", width: "100%", padding: 8 }}
                      placeholder="Enter observation, test witness query, or inspection comment..."
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                    />
                    <div className="edit-row">
                      <button type="submit" className="btn btn-primary">
                        Save Client Note
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setComposerForId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {entry.clientComments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: "0.86rem" }}>
                      Client Comment History ({entry.clientComments.length})
                    </strong>
                    <div className="saas-stack" style={{ marginTop: 6 }}>
                      {entry.clientComments.map((c) => (
                        <div key={c.id} className="demo-inline-alert info">
                          <strong>{c.author}</strong>{" "}
                          <span className="badge">
                            {c.kind === "info_request" ? "Info Request" : "Comment"}
                          </span>{" "}
                          · <span className="muted-note">{c.timestamp}</span>
                          <p style={{ margin: "4px 0 0" }}>{c.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
