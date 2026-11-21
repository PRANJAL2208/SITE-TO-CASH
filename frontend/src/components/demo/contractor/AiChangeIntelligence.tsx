import { useEffect, useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import type { DemoClassificationCategory } from "../../../demo/demoTypes";

const CLASSIFICATIONS: Array<{
  id: DemoClassificationCategory;
  label: string;
  desc: string;
}> = [
  {
    id: "existing_scope",
    label: "Existing Contractual Scope",
    desc: "Already included inside base tender drawings / BOQ.",
  },
  {
    id: "potential_variation",
    label: "Potential Variation",
    desc: "Appears additional to base scope; commercial claim merited if authorized.",
  },
  {
    id: "approval_or_notice_missing",
    label: "Approval or Notice Missing",
    desc: "Requires formal written CVO / Clause 8.3 notice before proceeding.",
  },
  {
    id: "insufficient_evidence",
    label: "Insufficient Evidence",
    desc: "Cannot confirm scope vs base contract without additional drawings/proof.",
  },
  {
    id: "ambiguous",
    label: "Ambiguous Instruction",
    desc: "Wording, quantity, or issuer authority remains unclear.",
  },
];

export default function AiChangeIntelligence() {
  const {
    state,
    confirmDemoQsExtraction,
    openVariation,
    setContractorPage,
  } = useDemo();

  const instruction =
    state.instructions.find((i) => i.id === state.selectedInstructionId) ??
    state.instructions[0];
  const variation =
    state.variations.find((v) => v.id === instruction?.linkedVariationId) ??
    state.variations[0];

  const [reviewerName, setReviewerName] = useState("Rohan Deshmukh (Senior QS)");
  const [editedSummary, setEditedSummary] = useState(
    variation?.aiAssessment.qsEditedSummary ??
      variation?.aiAssessment.instructionSummary ??
      ""
  );
  const [classification, setClassification] = useState<DemoClassificationCategory>(
    variation?.aiAssessment.classification ?? "approval_or_notice_missing"
  );
  const [qsNotes, setQsNotes] = useState(variation?.aiAssessment.qsNotes ?? "");
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    if (variation) {
      setEditedSummary(
        variation.aiAssessment.qsEditedSummary ??
          variation.aiAssessment.instructionSummary
      );
      setClassification(variation.aiAssessment.classification);
      setQsNotes(variation.aiAssessment.qsNotes);
      setSavedBanner(null);
    }
  }, [variation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!instruction || !variation) {
    return (
      <div className="empty-state">
        Select a captured instruction in Site Instruction Inbox first.
      </div>
    );
  }

  const ai = variation.aiAssessment;

  const handleConfirmQs = () => {
    confirmDemoQsExtraction({
      instructionId: instruction.id,
      reviewerName: reviewerName.trim() || "Rohan Deshmukh (Senior QS)",
      editedSummary,
      classification,
      qsNotes,
    });
    setSavedBanner(
      `QS review confirmed by ${reviewerName}. Original instruction text and preliminary AI assessment remain preserved separately.`
    );
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">
            Contractor View / AI Change Intelligence / {variation.id}
          </div>
          <h1>AI Change Intelligence &amp; Human QS Confirmation</h1>
          <p className="muted-note">
            Structured contract/BOQ extraction separated strictly from raw site
            text and human commercial confirmation.
          </p>
        </div>
        <div className="edit-row">
          <span className="badge badge-ai">
            AI Confidence: {ai.confidencePercent}% ({ai.confidenceLabel})
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openVariation(variation.id, "contractor")}
          >
            Open Variation Workspace ({variation.id})
          </button>
        </div>
      </div>

      {/* Non-entitlement commercial guardrail banner */}
      <div className="warning-banner" role="alert">
        <strong>Commercial Guardrail:</strong> AI Change Intelligence surfaces
        preliminary comparisons and source links only. It{" "}
        <strong>does NOT determine legal entitlement or contractual approval</strong>
        . Human QS review and Client written authorization are mandatory.
      </div>

      {/* Classification Comparison Strip (All 5 categories clearly shown) */}
      <div className="saas-card section-spacer">
        <h3>Commercial Classification Matrix (AI Preliminary Tag Highlighted)</h3>
        <div className="classification-grid">
          {CLASSIFICATIONS.map((item) => {
            const isActive = ai.classification === item.id;
            return (
              <div
                key={item.id}
                className={`classification-tile ${isActive ? "active" : ""}`}
              >
                <div className="panel-header">
                  <strong>{item.label}</strong>
                  {isActive && <span className="badge badge-ai">AI Flagged</span>}
                </div>
                <p className="muted-note">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Split: Original Untouched Instruction vs AI Extracted Intelligence */}
      <div className="saas-two-col section-spacer">
        <div className="saas-card card-ai">
          <div className="panel-header">
            <h3>AI-Extracted Change Structure</h3>
            <span className="badge badge-ai">AI Suggestion (Preliminary)</span>
          </div>

          <dl className="kv-list">
            <div>
              <dt>Instruction Summary</dt>
              <dd>{ai.instructionSummary}</dd>
            </div>
            <div>
              <dt>Project &amp; Location</dt>
              <dd>{ai.projectAndLocation}</dd>
            </div>
            <div>
              <dt>Affected Trade</dt>
              <dd>{ai.affectedTrade}</dd>
            </div>
            <div>
              <dt>Potential Scope Change</dt>
              <dd>{ai.potentialScopeChange}</dd>
            </div>
            <div>
              <dt>Potential Cost Impact</dt>
              <dd>{ai.potentialCostImpactSummary}</dd>
            </div>
            <div>
              <dt>Potential Schedule Impact</dt>
              <dd>{ai.potentialScheduleImpactSummary}</dd>
            </div>
          </dl>

          <div className="sub-section">
            <strong>Relevant Contract Clauses (Page-Attributed)</strong>
            <ul className="citation-list">
              {ai.relevantContractClauses.map((c) => (
                <li key={c.refId} className="finding-item">
                  <div>
                    <span className="citation-chip">[{c.refId}] {c.clauseRef}</span>{" "}
                    <strong>{c.title}</strong> · <span className="ref-pill">{c.pageRef}</span>
                  </div>
                  <div className="evidence-quote">&ldquo;{c.excerpt}&rdquo;</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="sub-section">
            <strong>Existing BOQ References</strong>
            {ai.existingBoqReferences.length === 0 ? (
              <p className="muted-note">No direct BOQ rows linked.</p>
            ) : (
              <ul className="citation-list">
                {ai.existingBoqReferences.map((b) => (
                  <li key={b.refId} className="finding-item">
                    <span className="citation-chip">[{b.refId}] {b.itemCode}</span>{" "}
                    <strong>{b.description}</strong>
                    <div className="meta-line">
                      {b.sheetAndRow} · Unit: {b.unit ?? "—"} · Base Rate:{" "}
                      {b.baseRate !== null ? `₹${b.baseRate.toLocaleString("en-IN")}` : "NULL (Rate Only)"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right Column: Original Input + Gaps + Uncertainty + Human QS Review */}
        <div className="saas-col">
          <div className="saas-card">
            <div className="panel-header">
              <h3>Immutable Original Instruction &amp; Evidence Citations</h3>
              <span className="badge badge-phase">{instruction.id}</span>
            </div>
            <pre className="page-text">{instruction.originalText}</pre>
            <div className="sub-section">
              <strong>Verbatim Evidence Citations</strong>
              <ul className="compact-list">
                {ai.evidenceReferences.map((ev, idx) => (
                  <li key={idx}>
                    <strong>{ev.sourceLabel}:</strong> &ldquo;{ev.verbatimExcerpt}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="saas-card">
            <h3>Missing Information, Approvals &amp; Uncertainty Indicators</h3>
            <div className="sub-section">
              <strong>Missing Evidence / Information</strong>
              <ul className="compact-list">
                {ai.missingInformation.map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>
            </div>
            <div className="sub-section">
              <strong>Required Approval Steps</strong>
              <ul className="compact-list">
                {ai.approvalRequirements.map((req, idx) => (
                  <li key={idx}>{req}</li>
                ))}
              </ul>
            </div>
            <div className="sub-section">
              <strong>Uncertainty Indicators</strong>
              <ul className="compact-list">
                {ai.uncertaintyIndicators.map((u, idx) => (
                  <li key={idx}>{u}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="saas-card card-qs">
            <div className="panel-header">
              <h3>Human Quantity Surveyor (QS) Review &amp; Confirmation</h3>
              <span
                className={`badge ${
                  instruction.qsConfirmed ? "badge-ok" : "badge-qs"
                }`}
              >
                {instruction.qsConfirmed
                  ? `Confirmed by ${instruction.qsConfirmedBy}`
                  : "Pending QS Confirmation"}
              </span>
            </div>

            {savedBanner && (
              <div className="success-banner" role="status">
                {savedBanner}
              </div>
            )}

            <div className="field-group">
              <label htmlFor="qs-reviewer-name">QS Reviewer Name</label>
              <input
                id="qs-reviewer-name"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="qs-classification-select">
                QS Confirmed Commercial Category
              </label>
              <select
                id="qs-classification-select"
                className="status-select small-input"
                value={classification}
                onChange={(e) =>
                  setClassification(e.target.value as DemoClassificationCategory)
                }
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="qs-edited-summary">
                QS Edited Commercial Scope Description
              </label>
              <textarea
                id="qs-edited-summary"
                className="input-text"
                rows={3}
                value={editedSummary}
                onChange={(e) => setEditedSummary(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="qs-notes-input">QS Commercial &amp; Measurement Notes</label>
              <textarea
                id="qs-notes-input"
                className="input-text"
                rows={2}
                value={qsNotes}
                onChange={(e) => setQsNotes(e.target.value)}
                placeholder="Note verified quantities, missing rates to quote, or notice deadline..."
              />
            </div>

            <div className="edit-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmQs}
              >
                Confirm QS Extraction &amp; Proceed
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => openVariation(variation.id, "contractor")}
              >
                Edit Cost Breakdown ({variation.id})
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setContractorPage("approval_workflow")}
              >
                Go to Approval Workflow
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
