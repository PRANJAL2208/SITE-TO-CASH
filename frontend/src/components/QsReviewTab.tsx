import { useEffect, useState } from "react";
import {
  fetchCaseAssessment,
  fetchCaseCostEstimate,
  fetchCaseReviewHistory,
  saveCaseCostEstimate,
  submitCaseQsReview,
} from "../api/client";
import type {
  CommercialAssessmentRecord,
  CostCategory,
  CostLineItem,
  CostLineItemInput,
  CostLineType,
  CostVerificationStatus,
  DeterministicEstimate,
  PreliminaryAssessmentCategory,
  QsDecisionAction,
  RetrievedBoqItem,
  ReviewHistoryEntry,
  RoundingMode,
  ValueSource,
  VariationCase,
} from "../types/domain";

interface QsReviewTabProps {
  cases: VariationCase[];
  selectedCaseId: string | null;
  onSelectCaseId: (caseId: string) => void;
  onCaseUpdated: (updated: VariationCase) => void;
}

interface EditableCostRow {
  localId: string;
  description: string;
  category: CostCategory;
  line_type: CostLineType;
  unit: string;
  quantity: string;
  rate: string;
  quantity_source: ValueSource;
  quantity_source_note: string;
  rate_source: ValueSource;
  rate_basis_note: string;
  verification_status: CostVerificationStatus;
  boq_reference: CostLineItem["boq_reference"];
  original_boq_item_code: string | null;
  original_boq_unit: string | null;
  original_boq_quantity: string | null;
  original_boq_rate: string | null;
  note: string;
  calculated_amount: string | null;
  missing_fields: string[];
}

function toEditableRows(estimate: DeterministicEstimate | null): EditableCostRow[] {
  if (!estimate) return [];
  return estimate.line_items.map((item, idx) => ({
    localId: item.id || `line-${idx + 1}`,
    description: item.description,
    category: item.category,
    line_type: item.line_type,
    unit: item.unit ?? "",
    quantity: item.quantity ?? "",
    rate: item.rate ?? "",
    quantity_source: item.quantity_source,
    quantity_source_note: item.quantity_source_note ?? "",
    rate_source: item.rate_source,
    rate_basis_note: item.rate_basis_note ?? "",
    verification_status: item.verification_status,
    boq_reference: item.boq_reference,
    original_boq_item_code: item.original_boq_item_code,
    original_boq_unit: item.original_boq_unit,
    original_boq_quantity: item.original_boq_quantity,
    original_boq_rate: item.original_boq_rate,
    note: item.note ?? "",
    calculated_amount: item.amount,
    missing_fields: item.missing_fields,
  }));
}

function formatMoney(amount: string | null, currency: string | null): string {
  if (amount === null || amount === "") return "—";
  return currency ? `${currency} ${amount}` : amount;
}

export default function QsReviewTab({
  cases,
  selectedCaseId,
  onSelectCaseId,
  onCaseUpdated,
}: QsReviewTabProps) {
  const activeCase =
    cases.find((c) => c.id === selectedCaseId) ?? cases[0] ?? null;

  const [assessment, setAssessment] =
    useState<CommercialAssessmentRecord | null>(null);
  const [savedEstimate, setSavedEstimate] =
    useState<DeterministicEstimate | null>(null);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Cost build-up editable state
  const [currency, setCurrency] = useState<string>("");
  const [taxRatePercent, setTaxRatePercent] = useState<string>("");
  const [roundingMode, setRoundingMode] = useState<RoundingMode>("HALF_UP");
  const [decimalPlaces, setDecimalPlaces] = useState<number>(2);
  const [costRows, setCostRows] = useState<EditableCostRow[]>([]);
  const [costReason, setCostReason] = useState<string>("");
  const [savingCost, setSavingCost] = useState<boolean>(false);
  const [costFeedback, setCostFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // QS Decision state
  const [reviewerName, setReviewerName] = useState<string>("");
  const [decisionAction, setDecisionAction] =
    useState<QsDecisionAction>("accept_assessment");
  const [confirmedCategory, setConfirmedCategory] = useState<
    PreliminaryAssessmentCategory | ""
  >("");
  const [decisionReason, setDecisionReason] = useState<string>("");
  const [decisionNotes, setDecisionNotes] = useState<string>("");
  const [savingDecision, setSavingDecision] = useState<boolean>(false);
  const [decisionFeedback, setDecisionFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!activeCase) {
      setAssessment(null);
      setSavedEstimate(null);
      setHistory([]);
      setCostRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setCostFeedback(null);
    setDecisionFeedback(null);

    void Promise.all([
      fetchCaseAssessment(activeCase.id, activeCase.project_id),
      fetchCaseCostEstimate(activeCase.id, activeCase.project_id),
      fetchCaseReviewHistory(activeCase.id, activeCase.project_id),
    ])
      .then(([assessRec, estRec, histRec]) => {
        if (cancelled) return;
        setAssessment(assessRec);
        setSavedEstimate(estRec);
        setHistory(histRec);
        setCurrency(estRec.currency ?? "");
        setTaxRatePercent(estRec.tax_rate_percent ?? "");
        setRoundingMode(estRec.rounding_mode);
        setDecimalPlaces(estRec.decimal_places);
        setCostRows(toEditableRows(estRec));
        setReviewerName(
          activeCase.qs_decision.reviewer_name ??
            activeCase.confirmed_extraction?.confirmed_by ??
            ""
        );
        setDecisionAction(
          activeCase.qs_decision.decision_action ?? "accept_assessment"
        );
        setConfirmedCategory(
          activeCase.qs_decision.confirmed_category ??
            assessRec?.ai_assessment.assessment_category ??
            ""
        );
        setDecisionReason(activeCase.qs_decision.reason ?? "");
        setDecisionNotes(activeCase.qs_decision.notes ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to load QS workbench data.";
          setCostFeedback({ kind: "error", text: msg });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCase?.id, activeCase?.project_id]);

  const addBlankCostRow = () => {
    setCostRows((prev) => [
      ...prev,
      {
        localId: `line-${Date.now()}-${prev.length + 1}`,
        description: "",
        category: "material",
        line_type: "addition",
        unit: "",
        quantity: "",
        rate: "",
        quantity_source: "qs_entered",
        quantity_source_note: "",
        rate_source: "qs_proposed",
        rate_basis_note: "",
        verification_status: "unverified",
        boq_reference: null,
        original_boq_item_code: null,
        original_boq_unit: null,
        original_boq_quantity: null,
        original_boq_rate: null,
        note: "",
        calculated_amount: null,
        missing_fields: [],
      },
    ]);
  };

  const addBoqReferenceRow = (boq: RetrievedBoqItem) => {
    setCostRows((prev) => [
      ...prev,
      {
        localId: `boq-${Date.now()}-${prev.length + 1}`,
        description: boq.description ?? `BOQ Item ${boq.item_code ?? boq.row_number}`,
        category: "material",
        line_type: "addition",
        unit: boq.unit ?? "",
        quantity: "",
        rate: boq.rate ?? "",
        quantity_source: "qs_entered",
        quantity_source_note: "QS to confirm measured variation quantity",
        rate_source: boq.rate ? "boq_reference" : "missing",
        rate_basis_note: `Referenced from ${boq.source_reference.location} (QS to verify applicability)`,
        verification_status: "unverified",
        boq_reference: boq.source_reference,
        original_boq_item_code: boq.item_code,
        original_boq_unit: boq.unit,
        original_boq_quantity: boq.quantity,
        original_boq_rate: boq.rate,
        note: "",
        calculated_amount: null,
        missing_fields: [],
      },
    ]);
  };

  const updateCostRow = (idx: number, patch: Partial<EditableCostRow>) => {
    setCostRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };

  const removeCostRow = (idx: number) => {
    setCostRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveCostEstimate = async () => {
    if (!activeCase) return;
    setSavingCost(true);
    setCostFeedback(null);
    try {
      const lineItems: CostLineItemInput[] = costRows.map((r) => ({
        id: r.localId,
        description: r.description,
        category: r.category,
        line_type: r.line_type,
        unit: r.unit.trim() || null,
        quantity: r.quantity.trim() || null,
        rate: r.rate.trim() || null,
        quantity_source: r.quantity.trim() ? r.quantity_source : "missing",
        quantity_source_note: r.quantity_source_note.trim() || null,
        rate_source: r.rate.trim() ? r.rate_source : "missing",
        rate_basis_note: r.rate_basis_note.trim() || null,
        verification_status: r.verification_status,
        boq_reference: r.boq_reference,
        original_boq_item_code: r.original_boq_item_code,
        original_boq_unit: r.original_boq_unit,
        original_boq_quantity: r.original_boq_quantity,
        original_boq_rate: r.original_boq_rate,
        note: r.note.trim() || null,
      }));

      const resp = await saveCaseCostEstimate(
        activeCase.id,
        {
          reviewer_name: reviewerName.trim() || null,
          reason: costReason.trim() || null,
          currency: currency.trim() || null,
          decimal_places: decimalPlaces,
          rounding_mode: roundingMode,
          tax_rate_percent: taxRatePercent.trim() || null,
          line_items: lineItems,
        },
        activeCase.project_id
      );

      setSavedEstimate(resp.deterministic_estimate);
      setCostRows(toEditableRows(resp.deterministic_estimate));
      setHistory((prev) => [...prev, resp.history_entry]);
      onCaseUpdated({
        ...activeCase,
        deterministic_estimate: resp.deterministic_estimate,
      });
      setCostReason("");
      setCostFeedback({
        kind: "success",
        text: "Deterministic cost build-up recalculated server-side and saved to audit history.",
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to calculate cost build-up.";
      setCostFeedback({ kind: "error", text: msg });
    } finally {
      setSavingCost(false);
    }
  };

  const handleSaveDecision = async (isDraft: boolean) => {
    if (!activeCase) return;
    setSavingDecision(true);
    setDecisionFeedback(null);
    try {
      const resp = await submitCaseQsReview(
        activeCase.id,
        {
          reviewer_name: reviewerName,
          decision_action: decisionAction,
          confirmed_category:
            confirmedCategory === "" ? null : confirmedCategory,
          reason: decisionReason.trim() || null,
          notes: decisionNotes.trim() || null,
          is_draft: isDraft,
          assessment_id: assessment?.id ?? null,
        },
        activeCase.project_id
      );
      onCaseUpdated(resp.case);
      if (resp.assessment) {
        setAssessment(resp.assessment);
      }
      setHistory((prev) => [...prev, resp.history_entry]);
      setDecisionFeedback({
        kind: "success",
        text: isDraft
          ? "QS review draft saved to audit history."
          : `QS decision confirmed (${resp.case.qs_decision.review_status}) by ${resp.case.qs_decision.reviewer_name}.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save QS decision.";
      setDecisionFeedback({ kind: "error", text: msg });
    } finally {
      setSavingDecision(false);
    }
  };

  return (
    <section>
      <div className="panel-header">
        <h2>QS Human Review Workbench &amp; Deterministic Costing</h2>
        <span className="badge badge-ok">Phase 5 Active</span>
      </div>

      {cases.length === 0 ? (
        <div className="empty-state">
          No variation cases available yet. Submit a site instruction in{" "}
          <strong>2. Site Instruction</strong> first.
        </div>
      ) : (
        <>
          <div className="scope-bar">
            <div className="field-group" style={{ flex: 1 }}>
              <label htmlFor="qs-case-select">
                Select Variation Case ({cases.length})
              </label>
              <select
                id="qs-case-select"
                className="input-text"
                value={activeCase?.id ?? ""}
                onChange={(e) => onSelectCaseId(e.target.value)}
              >
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    [{item.project_id}] {item.title} — QS:{" "}
                    {item.qs_decision.review_status}
                    {item.is_demo ? " (DEMO DATA)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="qs-reviewer-input">QS Reviewer Name</label>
              <input
                id="qs-reviewer-input"
                className="input-text"
                type="text"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="e.g. A. Patel (QS)"
              />
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading QS workbench...</div>
          ) : (
            activeCase && (
              <div className="two-col-stack">
                {/* 1. Evidence & Preliminary Assessment Context */}
                <div className="card">
                  <h3>
                    1. Evidence &amp; Preliminary Assessment Context
                    <div className="status-strip">
                      {activeCase.is_demo && (
                        <span className="badge badge-ai">DEMO DATA</span>
                      )}
                      {assessment && (
                        <span className="badge badge-ai">
                          AI Suggestion:{" "}
                          {assessment.ai_assessment.assessment_category}
                        </span>
                      )}
                      <span className="badge badge-qs">
                        QS Status: {activeCase.qs_decision.review_status}
                      </span>
                    </div>
                  </h3>

                  <div className="sub-section">
                    <strong>Original Site Instruction (Immutable)</strong>
                    <pre className="page-text">
                      {activeCase.original_input?.raw_text ??
                        activeCase.instruction_text ??
                        "[No text input]"}
                    </pre>
                  </div>

                  {activeCase.confirmed_extraction && (
                    <div className="sub-section">
                      <strong>Human-Confirmed Fields</strong>
                      <div className="meta-line">
                        Requested Work:{" "}
                        {activeCase.confirmed_extraction.fields.requested_work
                          .value ?? "—"}{" "}
                        · Location:{" "}
                        {activeCase.confirmed_extraction.fields
                          .project_site_location.value ?? "—"}{" "}
                        · Confirmed by:{" "}
                        {activeCase.confirmed_extraction.confirmed_by ?? "—"}
                      </div>
                    </div>
                  )}

                  {assessment ? (
                    <>
                      <div className="warning-banner">
                        <strong>AI Assessment Missing Information:</strong>
                        {assessment.ai_assessment
                          .missing_evidence_and_information.length === 0 ? (
                          <span> None reported.</span>
                        ) : (
                          <ul className="compact-list">
                            {assessment.ai_assessment.missing_evidence_and_information.map(
                              (gap, i) => (
                                <li key={i}>{gap}</li>
                              )
                            )}
                          </ul>
                        )}
                      </div>

                      {assessment.retrieved_contract_clauses.length > 0 && (
                        <div className="sub-section">
                          <strong>Retrieved Contract Clauses</strong>
                          <ul className="compact-list">
                            {assessment.retrieved_contract_clauses.map((c) => (
                              <li key={c.ref_id}>
                                <span className="ref-pill">
                                  [{c.ref_id}] {c.source_reference.location}
                                </span>{" "}
                                {c.verbatim_text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {assessment.retrieved_boq_items.length > 0 && (
                        <div className="sub-section">
                          <strong>
                            Potentially Relevant BOQ Reference Rates (Reference
                            Only)
                          </strong>
                          <ul className="citation-list">
                            {assessment.retrieved_boq_items.map((b) => (
                              <li
                                key={b.ref_id}
                                className="data-row"
                                style={{ alignItems: "flex-start" }}
                              >
                                <div>
                                  <span className="ref-pill">
                                    [{b.ref_id}] {b.source_reference.location}
                                  </span>{" "}
                                  <strong>{b.description ?? "—"}</strong> (Unit:{" "}
                                  {b.unit ?? "—"} · BOQ Qty:{" "}
                                  {b.quantity ?? "—"} · BOQ Rate:{" "}
                                  {b.rate ?? "—"})
                                  <div className="meta-line">
                                    {b.caution_note}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => addBoqReferenceRow(b)}
                                >
                                  + Use as BOQ Reference Line
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      No Phase 4 assessment linked yet (QS can still build
                      deterministic cost lines or request additional info).
                    </div>
                  )}
                </div>

                {/* 2. Deterministic Cost Build-Up */}
                <div className="card">
                  <h3>
                    2. Deterministic Cost Build-Up (Pure Decimal Server Math)
                    <button
                      type="button"
                      className="btn"
                      onClick={addBlankCostRow}
                    >
                      + Add Cost Line
                    </button>
                  </h3>

                  <div className="cost-settings-grid">
                    <div className="field-group">
                      <label htmlFor="cost-currency">Currency (3-letter)</label>
                      <input
                        id="cost-currency"
                        className="input-text small-input"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        placeholder="e.g. USD, GBP (optional)"
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="cost-tax">
                        Tax Rate % (blank = no tax)
                      </label>
                      <input
                        id="cost-tax"
                        className="input-text small-input"
                        value={taxRatePercent}
                        onChange={(e) => setTaxRatePercent(e.target.value)}
                        placeholder="e.g. 5 or 20"
                      />
                    </div>
                    <div className="field-group">
                      <label htmlFor="cost-rounding">Rounding Mode</label>
                      <select
                        id="cost-rounding"
                        className="input-text small-input"
                        value={roundingMode}
                        onChange={(e) =>
                          setRoundingMode(e.target.value as RoundingMode)
                        }
                      >
                        <option value="HALF_UP">HALF_UP</option>
                        <option value="HALF_EVEN">HALF_EVEN</option>
                      </select>
                    </div>
                    <div className="field-group">
                      <label htmlFor="cost-decimals">Decimal Places</label>
                      <input
                        id="cost-decimals"
                        type="number"
                        min={0}
                        max={4}
                        className="input-text small-input"
                        value={decimalPlaces}
                        onChange={(e) =>
                          setDecimalPlaces(Number(e.target.value))
                        }
                      />
                    </div>
                  </div>

                  {costRows.length === 0 ? (
                    <div className="empty-state">
                      No cost lines added yet. Click{" "}
                      <strong>+ Add Cost Line</strong> or reference a BOQ row
                      above.
                    </div>
                  ) : (
                    <div className="table-wrap" style={{ marginTop: 10 }}>
                      <table className="boq-table">
                        <thead>
                          <tr>
                            <th>Description / BOQ Ref</th>
                            <th>Category &amp; Type</th>
                            <th>Qty &amp; Source</th>
                            <th>Unit</th>
                            <th>Unit Rate &amp; Source</th>
                            <th>Status</th>
                            <th className="num-cell">Calculated Amount</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {costRows.map((row, idx) => (
                            <tr key={row.localId}>
                              <td style={{ minWidth: 200 }}>
                                <input
                                  className="input-text small-input"
                                  value={row.description}
                                  placeholder="Cost line description"
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      description: e.target.value,
                                    })
                                  }
                                />
                                {row.boq_reference && (
                                  <div className="meta-line">
                                    BOQ Ref: {row.boq_reference.location} (Orig
                                    Rate: {row.original_boq_rate ?? "—"}, Orig
                                    Qty: {row.original_boq_quantity ?? "—"})
                                  </div>
                                )}
                                <input
                                  className="input-text small-input"
                                  style={{ marginTop: 4 }}
                                  value={row.rate_basis_note}
                                  placeholder="Rate basis / justification note"
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      rate_basis_note: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <select
                                  className="status-select"
                                  value={row.category}
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      category: e.target.value as CostCategory,
                                    })
                                  }
                                >
                                  <option value="labour">Labour</option>
                                  <option value="material">Material</option>
                                  <option value="equipment">Equipment</option>
                                  <option value="subcontract">
                                    Subcontract
                                  </option>
                                  <option value="other">Other</option>
                                </select>
                                <select
                                  className="status-select"
                                  style={{ marginTop: 4, display: "block" }}
                                  value={row.line_type}
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      line_type: e.target.value as CostLineType,
                                    })
                                  }
                                >
                                  <option value="addition">Addition (+)</option>
                                  <option value="deduction">
                                    Deduction (-)
                                  </option>
                                </select>
                              </td>
                              <td>
                                <input
                                  className="input-text small-input qty-input"
                                  value={row.quantity}
                                  placeholder="Missing"
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      quantity: e.target.value,
                                    })
                                  }
                                />
                                <select
                                  className="status-select"
                                  style={{ marginTop: 4, display: "block" }}
                                  value={row.quantity_source}
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      quantity_source: e.target
                                        .value as ValueSource,
                                    })
                                  }
                                >
                                  <option value="confirmed_instruction">
                                    Confirmed Instr.
                                  </option>
                                  <option value="site_measurement">
                                    Site Measurement
                                  </option>
                                  <option value="qs_entered">QS Entered</option>
                                  <option value="boq_reference">
                                    BOQ Reference
                                  </option>
                                  <option value="missing">Missing</option>
                                </select>
                              </td>
                              <td>
                                <input
                                  className="input-text small-input"
                                  style={{ width: 70 }}
                                  value={row.unit}
                                  placeholder="m, nr..."
                                  onChange={(e) =>
                                    updateCostRow(idx, { unit: e.target.value })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="input-text small-input qty-input"
                                  value={row.rate}
                                  placeholder="Missing"
                                  onChange={(e) =>
                                    updateCostRow(idx, { rate: e.target.value })
                                  }
                                />
                                <select
                                  className="status-select"
                                  style={{ marginTop: 4, display: "block" }}
                                  value={row.rate_source}
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      rate_source: e.target
                                        .value as ValueSource,
                                    })
                                  }
                                >
                                  <option value="boq_reference">
                                    BOQ Reference
                                  </option>
                                  <option value="qs_proposed">
                                    QS Proposed
                                  </option>
                                  <option value="subcontractor_quote">
                                    Subcontractor Quote
                                  </option>
                                  <option value="contract_schedule">
                                    Contract Schedule
                                  </option>
                                  <option value="missing">Missing</option>
                                </select>
                              </td>
                              <td>
                                <select
                                  className="status-select"
                                  value={row.verification_status}
                                  onChange={(e) =>
                                    updateCostRow(idx, {
                                      verification_status: e.target
                                        .value as CostVerificationStatus,
                                    })
                                  }
                                >
                                  <option value="verified">Verified</option>
                                  <option value="unverified">Unverified</option>
                                  <option value="missing_data">
                                    Missing Data
                                  </option>
                                </select>
                              </td>
                              <td className="num-cell">
                                {row.calculated_amount ?? (
                                  <span className="null-cell">—</span>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => removeCostRow(idx)}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="inline-controls" style={{ marginTop: 12 }}>
                    <input
                      className="input-text"
                      style={{ flex: 1, minWidth: 220 }}
                      value={costReason}
                      onChange={(e) => setCostReason(e.target.value)}
                      placeholder="Reason for cost build-up edit (optional)"
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!reviewerName.trim() || savingCost}
                      onClick={() => void handleSaveCostEstimate()}
                    >
                      {savingCost
                        ? "Recalculating..."
                        : "Save & Recalculate Totals"}
                    </button>
                  </div>

                  {costFeedback && (
                    <div
                      className={
                        costFeedback.kind === "error"
                          ? "error-banner"
                          : "success-banner"
                      }
                      role="status"
                    >
                      {costFeedback.text}
                    </div>
                  )}

                  {savedEstimate && savedEstimate.line_items.length > 0 && (
                    <div className="totals-box">
                      <div className="totals-grid">
                        <div>
                          <span className="meta-line">Additions Subtotal</span>
                          <div>
                            <strong>
                              {formatMoney(
                                savedEstimate.additions_subtotal,
                                savedEstimate.currency
                              )}
                            </strong>
                          </div>
                        </div>
                        <div>
                          <span className="meta-line">Deductions Subtotal</span>
                          <div>
                            <strong>
                              {formatMoney(
                                savedEstimate.deductions_subtotal,
                                savedEstimate.currency
                              )}
                            </strong>
                          </div>
                        </div>
                        <div>
                          <span className="meta-line">Net Subtotal</span>
                          <div>
                            <strong>
                              {formatMoney(
                                savedEstimate.subtotal,
                                savedEstimate.currency
                              )}
                            </strong>
                          </div>
                        </div>
                        <div>
                          <span className="meta-line">
                            Tax{" "}
                            {savedEstimate.tax_rate_percent
                              ? `(${savedEstimate.tax_rate_percent}%)`
                              : "(Not applied)"}
                          </span>
                          <div>
                            <strong>
                              {formatMoney(
                                savedEstimate.tax_amount,
                                savedEstimate.currency
                              )}
                            </strong>
                          </div>
                        </div>
                        <div>
                          <span className="meta-line">
                            Total Estimated Amount
                          </span>
                          <div style={{ fontSize: "1.05rem" }}>
                            <strong>
                              {formatMoney(
                                savedEstimate.total_estimated_amount,
                                savedEstimate.currency
                              )}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {(savedEstimate.is_partial_estimate ||
                        savedEstimate.has_unverified_inputs) && (
                        <div className="warning-banner">
                          <strong>Caution:</strong> {savedEstimate.disclaimer}
                          {savedEstimate.missing_inputs.length > 0 && (
                            <ul className="compact-list">
                              {savedEstimate.missing_inputs.map((m, idx) => (
                                <li key={idx}>{m}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. QS Human Decision */}
                <div className="card card-qs">
                  <h3>
                    3. QS Human Decision
                    <span className="badge badge-qs">
                      origin: human_qs_decision ({activeCase.qs_decision.review_status})
                    </span>
                  </h3>

                  <div className="grid-two">
                    <div className="field-group">
                      <label htmlFor="qs-action-select">Decision Action</label>
                      <select
                        id="qs-action-select"
                        className="input-text"
                        value={decisionAction}
                        onChange={(e) =>
                          setDecisionAction(e.target.value as QsDecisionAction)
                        }
                      >
                        <option value="accept_assessment">
                          Accept Assessment
                        </option>
                        <option value="reject_assessment">
                          Reject Assessment
                        </option>
                        <option value="mark_existing_scope">
                          Mark as Existing Scope
                        </option>
                        <option value="request_additional_info">
                          Request Additional Information
                        </option>
                      </select>
                    </div>

                    <div className="field-group">
                      <label htmlFor="qs-category-select">
                        Confirmed Commercial Category (optional override)
                      </label>
                      <select
                        id="qs-category-select"
                        className="input-text"
                        value={confirmedCategory}
                        onChange={(e) =>
                          setConfirmedCategory(
                            e.target.value as PreliminaryAssessmentCategory | ""
                          )
                        }
                      >
                        <option value="">-- Match AI / Unspecified --</option>
                        <option value="potential_variation">
                          Potential Variation
                        </option>
                        <option value="existing_scope">Existing Scope</option>
                        <option value="approval_or_notice_missing">
                          Approval or Notice Missing
                        </option>
                        <option value="insufficient_evidence">
                          Insufficient Evidence
                        </option>
                        <option value="ambiguous">Ambiguous</option>
                      </select>
                    </div>
                  </div>

                  <div className="field-group">
                    <label htmlFor="qs-reason-input">
                      Decision Reason (required for Reject, Existing Scope,
                      Request Info, or Override)
                    </label>
                    <input
                      id="qs-reason-input"
                      className="input-text"
                      value={decisionReason}
                      onChange={(e) => setDecisionReason(e.target.value)}
                      placeholder="Explain commercial basis for QS decision..."
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="qs-notes-input">QS Notes</label>
                    <textarea
                      id="qs-notes-input"
                      className="input-text"
                      rows={2}
                      value={decisionNotes}
                      onChange={(e) => setDecisionNotes(e.target.value)}
                      placeholder="Optional follow-up notes..."
                    />
                  </div>

                  <div className="inline-controls">
                    <button
                      type="button"
                      className="btn"
                      disabled={!reviewerName.trim() || savingDecision}
                      onClick={() => void handleSaveDecision(true)}
                    >
                      Save Draft
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!reviewerName.trim() || savingDecision}
                      onClick={() => void handleSaveDecision(false)}
                    >
                      {savingDecision ? "Saving..." : "Confirm QS Decision"}
                    </button>
                  </div>

                  {decisionFeedback && (
                    <div
                      className={
                        decisionFeedback.kind === "error"
                          ? "error-banner"
                          : "success-banner"
                      }
                      role="status"
                    >
                      {decisionFeedback.text}
                    </div>
                  )}
                </div>

                {/* 4. Append-Only Review History */}
                <div className="card">
                  <h3>
                    4. Append-Only Review &amp; Cost Audit History (
                    {history.length})
                  </h3>
                  {history.length === 0 ? (
                    <div className="empty-state">
                      No review or cost audit entries recorded yet.
                    </div>
                  ) : (
                    <ul className="citation-list">
                      {history.map((entry) => (
                        <li key={entry.id} className="finding-item">
                          <div className="page-card-head">
                            <div className="status-strip">
                              <span className="badge badge-phase">
                                {entry.entry_type}
                              </span>
                              <strong>{entry.reviewer_name}</strong>
                              {entry.decision_action && (
                                <span className="badge badge-qs">
                                  {entry.decision_action}
                                </span>
                              )}
                            </div>
                            <span className="meta-line">
                              {new Date(entry.timestamp).toLocaleString()}
                            </span>
                          </div>
                          {entry.reason && (
                            <div className="meta-line">
                              Reason: {entry.reason}
                            </div>
                          )}
                          {entry.cost_estimate_snapshot && (
                            <div className="meta-line">
                              Cost Snapshot Total:{" "}
                              {formatMoney(
                                entry.cost_estimate_snapshot
                                  .total_estimated_amount,
                                entry.cost_estimate_snapshot.currency
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
