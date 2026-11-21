import { useEffect, useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import {
  computeDemoCostSummary,
  computeLineAmount,
  formatInr,
} from "../../../demo/demoSeed";
import type { DemoCostLine } from "../../../demo/demoTypes";
import ActivityTimeline from "../shared/ActivityTimeline";
import EvidencePreviewCard from "../shared/EvidencePreviewCard";

export default function VariationWorkspace() {
  const {
    state,
    openVariation,
    updateDemoVariationCostLines,
    setContractorPage,
  } = useDemo();

  const projVars = state.variations.filter(
    (v) => v.projectId === state.selectedProjectId
  );
  const variation =
    projVars.find((v) => v.id === state.selectedVariationId) ?? projVars[0];
  const instruction = state.instructions.find(
    (i) => i.id === variation?.instructionId
  );

  const [lines, setLines] = useState<DemoCostLine[]>(variation?.costLines ?? []);
  const [applyTaxPercent, setApplyTaxPercent] = useState<number | null>(
    variation?.applyTaxPercent ?? null
  );
  const [scheduleDays, setScheduleDays] = useState<string>(
    variation?.scheduleImpactDays !== null && variation?.scheduleImpactDays !== undefined
      ? String(variation.scheduleImpactDays)
      : ""
  );
  const [scheduleNote, setScheduleNote] = useState(
    variation?.scheduleImpactNote ?? ""
  );
  const [qsNotes, setQsNotes] = useState(variation?.aiAssessment.qsNotes ?? "");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (variation) {
      setLines(variation.costLines.map((l) => ({ ...l })));
      setApplyTaxPercent(variation.applyTaxPercent);
      setScheduleDays(
        variation.scheduleImpactDays !== null
          ? String(variation.scheduleImpactDays)
          : ""
      );
      setScheduleNote(variation.scheduleImpactNote);
      setQsNotes(variation.aiAssessment.qsNotes);
      setSaveMessage(null);
    }
  }, [variation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!variation) {
    return (
      <div className="empty-state">
        No variations exist in the selected project yet.
      </div>
    );
  }

  const liveSummary = computeDemoCostSummary(lines, applyTaxPercent);
  const caseActivities = state.activities.filter(
    (a) => a.entityId === variation.id || a.entityId === variation.instructionId
  );

  const handleRateChange = (lineId: string, rawVal: string) => {
    const cleaned = rawVal.trim();
    const num = cleaned === "" ? null : Number(cleaned);
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              rate: num !== null && !Number.isNaN(num) && num >= 0 ? num : null,
              rateSource:
                num !== null && !Number.isNaN(num)
                  ? "QS Verified Quote / Schedule"
                  : "MISSING — Enter verified quote",
              verified:
                num !== null && !Number.isNaN(num) && line.quantity !== null,
            }
          : line
      )
    );
  };

  const handleQtyChange = (lineId: string, rawVal: string) => {
    const cleaned = rawVal.trim();
    const num = cleaned === "" ? null : Number(cleaned);
    setLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              quantity:
                num !== null && !Number.isNaN(num) && num > 0 ? num : null,
              verified:
                num !== null && !Number.isNaN(num) && num > 0 && line.rate !== null,
            }
          : line
      )
    );
  };

  const handleSaveBuildUp = () => {
    const daysParsed = scheduleDays.trim() ? Number(scheduleDays.trim()) : null;
    updateDemoVariationCostLines({
      variationId: variation.id,
      costLines: lines,
      applyTaxPercent,
      scheduleImpactDays:
        daysParsed !== null && !Number.isNaN(daysParsed) ? daysParsed : null,
      scheduleImpactNote: scheduleNote,
      qsNotes,
    });
    setSaveMessage(
      `Saved deterministic build-up for ${variation.id}: Revised Total ${
        liveSummary.totalAmount !== null
          ? formatInr(liveSummary.totalAmount)
          : "Incomplete (missing inputs excluded)"
      }. Approved/billed/paid figures remain strictly untouched.`
    );
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">
            Contractor View / Variations / {variation.id}
          </div>
          <h1>
            <span className="ref-pill">{variation.id}</span> {variation.title}
          </h1>
          <p className="muted-note">
            Trade: {variation.trade} · Location: {variation.floorLocation}
          </p>
        </div>
        <div className="edit-row">
          <select
            aria-label="Switch variation case"
            className="status-select"
            value={variation.id}
            onChange={(e) => openVariation(e.target.value, "contractor")}
          >
            {projVars.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} — {v.status.replace(/_/g, " ").toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setContractorPage("approval_workflow")}
          >
            Proceed to Approval Workflow
          </button>
        </div>
      </div>

      {/* Strictly Separated Commercial Financial Strip */}
      <div className="financial-strip">
        <div className="fin-cell">
          <span>Proposed</span>
          <strong>{formatInr(variation.proposedAmount, "Incomplete")}</strong>
        </div>
        <div className="fin-cell">
          <span>QS Revised</span>
          <strong>{formatInr(variation.revisedAmount, "—")}</strong>
        </div>
        <div className="fin-cell fin-ok">
          <span>Client Approved</span>
          <strong>{formatInr(variation.approvedAmount, "Not Approved")}</strong>
        </div>
        <div className="fin-cell">
          <span>Executed</span>
          <strong>{formatInr(variation.executedAmount, "—")}</strong>
        </div>
        <div className="fin-cell">
          <span>Billed</span>
          <strong>{formatInr(variation.billedAmount, "—")}</strong>
        </div>
        <div className="fin-cell">
          <span>Paid</span>
          <strong>{formatInr(variation.paidAmount, "—")}</strong>
        </div>
        <div className="fin-cell">
          <span>Lifecycle Status</span>
          <span className="badge badge-phase">
            {variation.status.replace(/_/g, " ").toUpperCase()}
          </span>
        </div>
      </div>

      {saveMessage && (
        <div className="success-banner" role="status">
          {saveMessage}
        </div>
      )}

      {/* Original Instruction & Scope Comparison */}
      <div className="saas-two-col section-spacer">
        <div className="saas-card">
          <h3>Original Site Instruction ({variation.instructionId})</h3>
          <pre className="page-text">
            {instruction?.originalText ?? "Original instruction linked in archive."}
          </pre>
          <div className="sub-section">
            <strong>Scope Comparison &amp; Contractor Basis</strong>
            <p className="muted-note">{variation.scopeComparison}</p>
            <p className="muted-note">{variation.contractorJustification}</p>
          </div>
          <div className="sub-section">
            <strong>Missing Evidence &amp; Approvals</strong>
            {variation.missingEvidence.length === 0 ? (
              <p className="muted-note">No outstanding evidence gaps.</p>
            ) : (
              <ul className="compact-list">
                {variation.missingEvidence.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="saas-card">
          <h3>Contract Clauses &amp; BOQ Source References</h3>
          <div className="sub-section">
            <strong>Contract References</strong>
            {variation.aiAssessment.relevantContractClauses.length === 0 ? (
              <p className="muted-note">None retrieved.</p>
            ) : (
              <ul className="citation-list">
                {variation.aiAssessment.relevantContractClauses.map((c) => (
                  <li key={c.refId} className="finding-item">
                    <strong>{c.clauseRef} — {c.title}</strong>{" "}
                    <span className="ref-pill">{c.pageRef}</span>
                    <div className="evidence-quote">&ldquo;{c.excerpt}&rdquo;</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sub-section">
            <strong>BOQ References</strong>
            {variation.aiAssessment.existingBoqReferences.length === 0 ? (
              <p className="muted-note">No matching BOQ rows.</p>
            ) : (
              <ul className="compact-list">
                {variation.aiAssessment.existingBoqReferences.map((b) => (
                  <li key={b.refId}>
                    <strong>{b.itemCode}</strong>: {b.description} (
                    {b.sheetAndRow}, Base Rate:{" "}
                    {b.baseRate !== null ? formatInr(b.baseRate) : "NULL"})
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Quantity & Rate Breakdown (No zero substitution for missing rates) */}
      <div className="saas-card section-spacer">
        <div className="panel-header">
          <div>
            <h3>Deterministic Quantity &amp; Rate Build-Up</h3>
            <p className="muted-note">
              Missing quantities or rates remain explicitly blank / MISSING and are
              never substituted with zero. Edit rates below during QS review.
            </p>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={applyTaxPercent === 18}
              onChange={(e) => setApplyTaxPercent(e.target.checked ? 18 : null)}
            />
            <span>Apply Explicit 18% GST</span>
          </label>
        </div>

        <div className="table-wrap">
          <table className="boq-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="num-cell">Qty</th>
                <th className="num-cell">Rate (₹)</th>
                <th>Source / Provenance</th>
                <th className="num-cell">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineAmt = computeLineAmount(line);
                const hasMissing = line.quantity === null || line.rate === null;
                return (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.description}</strong>
                      {line.boqRef && (
                        <div className="meta-line">BOQ: {line.boqRef}</div>
                      )}
                    </td>
                    <td>{line.category}</td>
                    <td>{line.unit ?? "—"}</td>
                    <td className="num-cell">
                      <input
                        aria-label={`Quantity for ${line.description}`}
                        type="number"
                        className="input-text qty-input"
                        value={line.quantity ?? ""}
                        placeholder="MISSING"
                        onChange={(e) => handleQtyChange(line.id, e.target.value)}
                      />
                    </td>
                    <td className="num-cell">
                      <input
                        aria-label={`Rate for ${line.description}`}
                        type="number"
                        className="input-text qty-input"
                        value={line.rate ?? ""}
                        placeholder="MISSING"
                        onChange={(e) => handleRateChange(line.id, e.target.value)}
                      />
                    </td>
                    <td>
                      <div className="meta-line">Qty: {line.quantitySource}</div>
                      <div className="meta-line">
                        Rate:{" "}
                        <span className={line.rate === null ? "badge badge-err" : ""}>
                          {line.rateSource}
                        </span>
                      </div>
                    </td>
                    <td className="num-cell">
                      {hasMissing ? (
                        <span className="badge badge-err">MISSING INPUT</span>
                      ) : (
                        <strong>{formatInr(lineAmt)}</strong>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="totals-box">
          <div className="totals-grid">
            <div>
              <div className="kpi-label">Net Subtotal (Excl. Tax)</div>
              <strong>{formatInr(liveSummary.subtotal, "Cannot Calculate")}</strong>
            </div>
            <div>
              <div className="kpi-label">
                Explicit Tax {applyTaxPercent !== null ? `(${applyTaxPercent}% GST)` : "(Not Applied)"}
              </div>
              <strong>{formatInr(liveSummary.taxAmount, "Not applied")}</strong>
            </div>
            <div>
              <div className="kpi-label">Total Proposed Variation</div>
              <strong>{formatInr(liveSummary.totalAmount, "Incomplete")}</strong>
            </div>
            <div>
              <div className="kpi-label">Missing Input Lines</div>
              <strong>
                {liveSummary.missingCount} line(s) excluded from subtotal
              </strong>
            </div>
          </div>
        </div>

        <div className="cost-settings-grid section-spacer">
          <div className="field-group">
            <label htmlFor="var-sched-days">Potential Schedule Impact (Days)</label>
            <input
              id="var-sched-days"
              value={scheduleDays}
              onChange={(e) => setScheduleDays(e.target.value)}
              placeholder="e.g. 5"
            />
          </div>
          <div className="field-group">
            <label htmlFor="var-sched-note">Schedule Impact Note</label>
            <input
              id="var-sched-note"
              value={scheduleNote}
              onChange={(e) => setScheduleNote(e.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="var-qs-note">QS Review Commercial Note</label>
            <input
              id="var-qs-note"
              value={qsNotes}
              onChange={(e) => setQsNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="edit-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveBuildUp}
          >
            Recalculate &amp; Save QS Build-Up
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setContractorPage("approval_workflow")}
          >
            Open Contractor Approval &amp; Notice Workflow
          </button>
        </div>
      </div>

      {/* Supporting Evidence & Activity History */}
      <div className="saas-two-col section-spacer">
        <div className="saas-card">
          <h3>Evidence &amp; Attachments ({variation.evidenceItems.length})</h3>
          {variation.evidenceItems.length === 0 ? (
            <div className="empty-state">No photographic attachments logged for this variation.</div>
          ) : (
            <div className="evidence-grid">
              {variation.evidenceItems.map((ev) => (
                <EvidencePreviewCard key={ev.id} item={ev} />
              ))}
            </div>
          )}
        </div>

        <div className="saas-card">
          <h3>Variation Activity History</h3>
          <ActivityTimeline events={caseActivities} />
        </div>
      </div>
    </div>
  );
}
