import { useEffect, useState } from "react";
import { fetchCaseAssessment, runCaseAssessment } from "../api/client";
import type {
  CitedFinding,
  CommercialAssessmentRecord,
  PreliminaryAssessmentCategory,
  VariationCase,
} from "../types/domain";

interface AssessmentTabProps {
  cases: VariationCase[];
  selectedCaseId: string | null;
  onSelectCaseId: (caseId: string) => void;
  onAssessmentSaved: (record: CommercialAssessmentRecord) => void;
  geminiConfigured: boolean;
}

function categoryBadgeClass(category: PreliminaryAssessmentCategory): string {
  if (category === "existing_scope") return "badge-ok";
  if (category === "potential_variation") return "badge-qs";
  if (category === "insufficient_evidence") return "badge-err";
  return "badge-ai";
}

function categoryLabel(category: PreliminaryAssessmentCategory): string {
  switch (category) {
    case "existing_scope":
      return "Existing Scope";
    case "potential_variation":
      return "Potential Variation";
    case "approval_or_notice_missing":
      return "Approval or Notice Missing";
    case "insufficient_evidence":
      return "Insufficient Evidence";
    case "ambiguous":
      return "Ambiguous / Conflicting Evidence";
  }
}

function renderNullable(value: string | null) {
  if (value === null || value === "") {
    return <span className="null-cell">—</span>;
  }
  return value;
}

function FindingsSection({
  title,
  findings,
  emptyText,
}: {
  title: string;
  findings: CitedFinding[];
  emptyText: string;
}) {
  return (
    <div className="sub-section">
      <strong>{title}</strong>
      {findings.length === 0 ? (
        <div className="meta-line">{emptyText}</div>
      ) : (
        <ul className="citation-list">
          {findings.map((finding, idx) => (
            <li key={idx} className="finding-item">
              <div>
                {finding.statement}
                {finding.grounding_status &&
                  finding.grounding_status !== "verified" && (
                    <>
                      {" "}
                      <span className="badge badge-err">
                        Unsupported / Unverified AI Claim
                      </span>
                    </>
                  )}
              </div>
              {finding.grounding_status &&
                finding.grounding_status !== "verified" &&
                finding.grounding_note && (
                  <div className="meta-line">{finding.grounding_note}</div>
                )}
              {finding.source_references.length > 0 && (
                <div className="status-strip" style={{ marginTop: 6 }}>
                  {finding.source_references.map((ref, refIdx) => (
                    <span
                      key={`${ref.document_id}-${ref.location}-${refIdx}`}
                      className="citation-chip"
                      title={ref.excerpt}
                    >
                      [{finding.source_ref_ids[refIdx] ?? "REF"}] {ref.document_name} ·{" "}
                      {ref.location}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AssessmentTab({
  cases,
  selectedCaseId,
  onSelectCaseId,
  onAssessmentSaved,
  geminiConfigured,
}: AssessmentTabProps) {
  const confirmedCases = cases.filter(
    (c) => c.confirmed_extraction?.confirmation_status === "confirmed"
  );
  const activeCase =
    confirmedCases.find((c) => c.id === selectedCaseId) ??
    confirmedCases[0] ??
    null;

  const [assessment, setAssessment] =
    useState<CommercialAssessmentRecord | null>(null);
  const [loadingExisting, setLoadingExisting] = useState<boolean>(false);
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCase) {
      setAssessment(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoadingExisting(true);
    setError(null);
    void fetchCaseAssessment(activeCase.id, activeCase.project_id)
      .then((record) => {
        if (!cancelled) {
          setAssessment(record);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to load saved assessment.";
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingExisting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCase?.id, activeCase?.project_id]);

  const handleRunAssessment = async () => {
    if (!activeCase) return;
    setRunning(true);
    setError(null);
    try {
      const created = await runCaseAssessment(
        activeCase.id,
        activeCase.project_id
      );
      setAssessment(created);
      onAssessmentSaved(created);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Preliminary commercial assessment failed.";
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section>
      <div className="panel-header">
        <h2>Contract Intelligence &amp; Preliminary Commercial Assessment</h2>
        <span className="badge badge-ok">Phase 4 Active</span>
      </div>

      {!geminiConfigured && (
        <div className="warning-banner">
          <strong>Gemini API Key Not Configured:</strong> Set{" "}
          <code>GEMINI_API_KEY</code> in the backend environment (`.env`) to run
          live preliminary assessments. Previously saved assessments can still
          be inspected below.
        </div>
      )}

      {confirmedCases.length === 0 ? (
        <div className="empty-state">
          No human-confirmed site-change events available yet. Confirm an
          extracted instruction in <strong>2. Site Instruction</strong> before
          running Contract &amp; BOQ retrieval and assessment.
        </div>
      ) : (
        <>
          <div className="scope-bar">
            <div className="field-group" style={{ flex: 1 }}>
              <label htmlFor="assess-case-select">
                Confirmed Site-Change Event ({confirmedCases.length})
              </label>
              <select
                id="assess-case-select"
                className="input-text"
                value={activeCase?.id ?? ""}
                onChange={(e) => onSelectCaseId(e.target.value)}
              >
                {confirmedCases.map((item) => (
                  <option key={item.id} value={item.id}>
                    [{item.project_id}] {item.title}
                    {item.is_demo ? " (DEMO DATA)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={!activeCase || running}
              onClick={() => void handleRunAssessment()}
            >
              {running
                ? "Retrieving & Assessing..."
                : assessment
                  ? "Re-run Preliminary Assessment"
                  : "Run Preliminary Assessment"}
            </button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          {activeCase && (
            <div className="two-col-stack">
              {/* 1. Confirmed Site Instruction */}
              <div className="card card-qs">
                <h3>
                  1. Confirmed Site Instruction (Human-Verified Input)
                  <div className="status-strip">
                    {activeCase.is_demo && (
                      <span className="badge badge-ai">DEMO DATA</span>
                    )}
                    <span className="badge badge-qs">
                      Confirmed by{" "}
                      {activeCase.confirmed_extraction?.confirmed_by ?? "QS"}
                    </span>
                  </div>
                </h3>
                <div className="meta-line">
                  Case ID: {activeCase.id} · Project: {activeCase.project_id}
                </div>
                <div className="extraction-grid">
                  <div className="field-card">
                    <strong>Requested Work</strong>
                    <div>
                      {activeCase.confirmed_extraction?.fields.requested_work
                        .value ?? "—"}
                    </div>
                  </div>
                  <div className="field-card">
                    <strong>Location</strong>
                    <div>
                      {activeCase.confirmed_extraction?.fields
                        .project_site_location.value ?? "—"}
                    </div>
                  </div>
                  <div className="field-card">
                    <strong>Issuer / Role</strong>
                    <div>
                      {activeCase.confirmed_extraction?.fields.issuer_name
                        .value ?? "—"}{" "}
                      {activeCase.confirmed_extraction?.fields.issuer_role.value
                        ? `(${activeCase.confirmed_extraction.fields.issuer_role.value})`
                        : ""}
                    </div>
                  </div>
                  <div className="field-card">
                    <strong>Communication Date</strong>
                    <div>
                      {activeCase.confirmed_extraction?.fields
                        .communication_date.value ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="sub-section">
                  <strong>Original Instruction (Preserved Unchanged)</strong>
                  <pre className="page-text">
                    {activeCase.original_input?.raw_text ??
                      activeCase.instruction_text ??
                      "[No text input]"}
                  </pre>
                </div>
              </div>

              {loadingExisting ? (
                <div className="empty-state">
                  Loading saved commercial assessment...
                </div>
              ) : !assessment ? (
                <div className="empty-state">
                  No commercial assessment saved for this confirmed event yet.
                  Click <strong>Run Preliminary Assessment</strong> to retrieve
                  project contract clauses and BOQ rows.
                </div>
              ) : (
                <>
                  {/* 2. Directly Documented Facts: Retrieved Contract & BOQ Evidence */}
                  <div className="card">
                    <h3>
                      2. Retrieved Source Evidence (Directly Documented Facts)
                      <span className="badge badge-phase">
                        {assessment.retrieved_contract_clauses.length} clause(s)
                        · {assessment.retrieved_boq_items.length} BOQ row(s)
                      </span>
                    </h3>

                    <div className="sub-section">
                      <strong>Retrieved Contract Clauses</strong>
                      {assessment.retrieved_contract_clauses.length === 0 ? (
                        <div className="warning-banner">
                          No matching contract clauses were retrieved in project{" "}
                          <code>{assessment.project_id}</code>. Absence of a
                          retrieved clause does not prove no contractual
                          requirement exists.
                        </div>
                      ) : (
                        <div className="page-list">
                          {assessment.retrieved_contract_clauses.map(
                            (clause) => (
                              <div key={clause.ref_id} className="clause-card">
                                <div className="page-card-head">
                                  <div className="status-strip">
                                    <span className="badge badge-phase">
                                      [{clause.ref_id}]
                                    </span>
                                    <span className="ref-pill">
                                      {clause.source_reference.location}
                                    </span>
                                    <strong>{clause.document_name}</strong>
                                    {clause.clause_title && (
                                      <span>— {clause.clause_title}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="meta-line">
                                  {clause.relevance_reason}
                                </div>
                                <pre
                                  className="page-text"
                                  style={{ marginTop: 8 }}
                                >
                                  {clause.verbatim_text}
                                </pre>
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    <div className="sub-section">
                      <strong>Retrieved BOQ Rows</strong>
                      {assessment.retrieved_boq_items.length === 0 ? (
                        <div className="warning-banner">
                          No matching BOQ rows were retrieved in project{" "}
                          <code>{assessment.project_id}</code>.
                        </div>
                      ) : (
                        <div className="table-wrap" style={{ marginTop: 8 }}>
                          <table className="boq-table">
                            <thead>
                              <tr>
                                <th>Ref</th>
                                <th>Source Reference</th>
                                <th>Workbook</th>
                                <th>Item</th>
                                <th>Description</th>
                                <th>Unit</th>
                                <th className="num-cell">Qty</th>
                                <th className="num-cell">Rate</th>
                                <th className="num-cell">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {assessment.retrieved_boq_items.map((item) => (
                                <tr key={item.ref_id}>
                                  <td>
                                    <span className="badge badge-phase">
                                      [{item.ref_id}]
                                    </span>
                                  </td>
                                  <td>
                                    <span className="ref-pill">
                                      {item.source_reference.location}
                                    </span>
                                  </td>
                                  <td>{item.workbook_name}</td>
                                  <td>{renderNullable(item.item_code)}</td>
                                  <td>
                                    <div>{renderNullable(item.description)}</div>
                                    <div className="meta-line">
                                      {item.caution_note}
                                    </div>
                                  </td>
                                  <td>{renderNullable(item.unit)}</td>
                                  <td className="num-cell">
                                    {renderNullable(item.quantity)}
                                  </td>
                                  <td className="num-cell">
                                    {renderNullable(item.rate)}
                                  </td>
                                  <td className="num-cell">
                                    {renderNullable(item.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3. AI Preliminary Commercial Assessment */}
                  <div className="card card-ai">
                    <div className="assessment-banner">
                      <div className="status-strip">
                        <span className="badge badge-ai">
                          AI-Generated Suggestion — Preliminary Only
                        </span>
                        <span
                          className={`badge category-pill ${categoryBadgeClass(
                            assessment.ai_assessment.assessment_category
                          )}`}
                        >
                          {categoryLabel(
                            assessment.ai_assessment.assessment_category
                          )}
                        </span>
                      </div>
                      <div className="meta-line">
                        Model: {assessment.model_name} · Assessed:{" "}
                        {new Date(assessment.assessed_at).toLocaleString()}
                      </div>
                    </div>

                    <div className="warning-banner">
                      {assessment.ai_assessment.disclaimer}
                    </div>

                    {assessment.ai_assessment.guardrail_warnings &&
                      assessment.ai_assessment.guardrail_warnings.length >
                        0 && (
                        <div className="warning-banner" role="alert">
                          <strong>Commercial Guardrail Alert:</strong>
                          <ul className="compact-list">
                            {assessment.ai_assessment.guardrail_warnings.map(
                              (warn, wIdx) => (
                                <li key={wIdx}>{warn}</li>
                              )
                            )}
                          </ul>
                        </div>
                      )}

                    <div className="sub-section">
                      <strong>Requested Work Summary</strong>
                      <div>
                        {assessment.ai_assessment.requested_work_summary}
                      </div>
                    </div>

                    <div className="sub-section">
                      <strong>Scope Comparison (AI Interpretation)</strong>
                      <div>{assessment.ai_assessment.scope_comparison}</div>
                    </div>

                    <div className="sub-section">
                      <strong>AI Interpretation Summary</strong>
                      <div>
                        {assessment.ai_assessment.ai_interpretation_summary}
                      </div>
                    </div>

                    <FindingsSection
                      title="Directly Documented Facts (Cited)"
                      findings={assessment.ai_assessment.documented_facts}
                      emptyText="No directly documented facts cited."
                    />

                    <div className="grid-two" style={{ marginTop: 12 }}>
                      <FindingsSection
                        title="Explicit Inclusions"
                        findings={assessment.ai_assessment.explicit_inclusions}
                        emptyText="No explicit inclusions cited."
                      />
                      <FindingsSection
                        title="Explicit Exclusions"
                        findings={assessment.ai_assessment.explicit_exclusions}
                        emptyText="No explicit exclusions cited."
                      />
                    </div>

                    <FindingsSection
                      title="Potential Scope Overlap"
                      findings={assessment.ai_assessment.potential_scope_overlap}
                      emptyText="No potential scope overlap identified."
                    />

                    <div className="grid-two" style={{ marginTop: 12 }}>
                      <FindingsSection
                        title="Written Approval Requirements"
                        findings={
                          assessment.ai_assessment.written_approval_requirements
                        }
                        emptyText="No written approval clause retrieved (verify contract manually)."
                      />
                      <FindingsSection
                        title="Issuer Authority Requirements"
                        findings={
                          assessment.ai_assessment.issuer_authority_requirements
                        }
                        emptyText="No issuer authority clause retrieved (verify contract manually)."
                      />
                    </div>

                    <FindingsSection
                      title="Notice Requirements & Deadlines"
                      findings={
                        assessment.ai_assessment
                          .notice_requirements_and_deadlines
                      }
                      emptyText="No notice requirement clause retrieved (verify contract manually)."
                    />

                    <FindingsSection
                      title="Conflicting or Ambiguous Contract Evidence"
                      findings={
                        assessment.ai_assessment
                          .conflicting_or_ambiguous_evidence
                      }
                      emptyText="No conflicting evidence identified."
                    />

                    <div className="warning-banner">
                      <strong>Missing Evidence &amp; Information</strong>
                      {assessment.ai_assessment.missing_evidence_and_information
                        .length === 0 ? (
                        <div>None reported.</div>
                      ) : (
                        <ul className="compact-list">
                          {assessment.ai_assessment.missing_evidence_and_information.map(
                            (gap, idx) => (
                              <li key={idx}>{gap}</li>
                            )
                          )}
                        </ul>
                      )}
                    </div>

                    <div className="sub-section">
                      <strong>Recommended QS Follow-Up</strong>
                      {assessment.ai_assessment.recommended_qs_followup
                        .length === 0 ? (
                        <div className="meta-line">None listed.</div>
                      ) : (
                        <ul className="compact-list">
                          {assessment.ai_assessment.recommended_qs_followup.map(
                            (step, idx) => (
                              <li key={idx}>{step}</li>
                            )
                          )}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* 4. QS Commercial Decision Status (Phases 5-6) */}
                  <div className="card card-qs">
                    <h3>
                      4. QS Commercial Decision &amp; Deterministic Calculation
                      <span className="badge badge-qs">
                        Human Review: {assessment.human_review_status}
                      </span>
                    </h3>
                    <p className="muted">
                      This AI assessment is a preliminary suggestion only. QS
                      override/confirmation, deterministic `Decimal` valuation
                      from verified BOQ rates, and Draft Variation Report
                      generation arrive in Phases 5–6.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
