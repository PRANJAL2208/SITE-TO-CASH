import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadCaseReport,
  fetchCaseLifecycleHistory,
  fetchCaseReports,
  fetchCases,
  fetchDashboardMetrics,
  generateCaseReport,
  updateCaseLifecycle,
  updateCaseTracking,
} from "../api/client";
import type {
  DashboardMetricsResponse,
  EvidencePackRecord,
  LifecycleHistoryEntry,
  VariationCase,
  VariationLifecycleStatus,
} from "../types/domain";

type TabId = "documents" | "instruction" | "review" | "qs_workbench" | "register";

interface RegisterTabProps {
  allCases: VariationCase[];
  selectedCaseId: string | null;
  onSelectCaseId: (caseId: string) => void;
  onCaseUpdated: (updated: VariationCase) => void;
  onNavigateTab: (tab: TabId) => void;
}

const ALL_STATUSES: VariationLifecycleStatus[] = [
  "detected",
  "under_review",
  "drafted",
  "submitted",
  "approved",
  "rejected",
  "executed",
  "billed",
  "paid",
];

const ALLOWED_TRANSITIONS: Record<
  VariationLifecycleStatus,
  VariationLifecycleStatus[]
> = {
  detected: ["under_review", "rejected"],
  under_review: ["drafted", "rejected"],
  drafted: ["under_review", "submitted", "rejected"],
  submitted: ["approved", "rejected", "under_review"],
  approved: ["executed", "billed"],
  executed: ["billed"],
  billed: ["paid"],
  rejected: ["under_review"],
  paid: [],
};

const APPROVED_OR_LATER = new Set<VariationLifecycleStatus>([
  "approved",
  "executed",
  "billed",
  "paid",
]);

function lifecycleBadgeClass(status: VariationLifecycleStatus): string {
  if (status === "approved" || status === "executed" || status === "paid") {
    return "badge-ok";
  }
  if (status === "submitted" || status === "billed") {
    return "badge-phase";
  }
  if (status === "rejected") {
    return "badge-err";
  }
  return "badge-ai";
}

function lifecycleLabel(status: VariationLifecycleStatus): string {
  return status.replace(/_/g, " ").toUpperCase();
}

function effectiveRef(item: VariationCase): string {
  if (item.variation_reference && item.variation_reference.trim()) {
    return item.variation_reference.trim();
  }
  return `VAR-${item.id.slice(-6).toUpperCase()}`;
}

function formatMoney(
  amount: string | null | undefined,
  currency: string | null | undefined,
  fallback = "—"
): string {
  if (amount === null || amount === undefined || amount === "") {
    return fallback;
  }
  const cleanCurrency = currency && currency.trim() && currency !== "UNSPECIFIED"
    ? `${currency.trim().toUpperCase()} `
    : "";
  return `${cleanCurrency}${amount}`;
}

function formatIsoDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function computeClientActionHint(item: VariationCase): string {
  const st = item.lifecycle_status;
  if (st === "paid") return "Closed — Paid";
  if (st === "billed") {
    return `Await payment (Inv: ${item.commercial_tracking.invoice_reference || "pending"})`;
  }
  if (st === "executed") return "Raise variation invoice / running bill";
  if (st === "approved") return "Record execution or raise invoice";
  if (st === "submitted") {
    return item.commercial_tracking.submission_reference
      ? `Await client response (${item.commercial_tracking.submission_reference})`
      : "Await client response";
  }
  if (st === "rejected") return "Closed — Rejected";
  if (st === "drafted") {
    return item.latest_report_id
      ? "Review draft pack & submit"
      : "Generate draft evidence pack PDF";
  }
  if (item.confirmed_extraction?.confirmation_status !== "confirmed") {
    return "Confirm extracted instruction";
  }
  if (!item.latest_assessment_id) {
    return "Run contract/BOQ assessment";
  }
  if (
    !item.deterministic_estimate ||
    item.deterministic_estimate.total_estimated_amount === null ||
    item.deterministic_estimate.is_partial_estimate
  ) {
    return "Complete cost build-up";
  }
  if (
    item.qs_decision.review_status === "pending_review" ||
    item.qs_decision.review_status === "needs_more_info"
  ) {
    return "Complete QS decision";
  }
  return "Advance to Drafted & generate pack";
}

export default function RegisterTab({
  allCases,
  selectedCaseId,
  onSelectCaseId,
  onCaseUpdated,
  onNavigateTab,
}: RegisterTabProps) {
  // Filter bar state
  const [filterProject, setFilterProject] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<VariationLifecycleStatus | "">("");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");

  const [filteredCases, setFilteredCases] = useState<VariationCase[]>(allCases);
  const [metrics, setMetrics] = useState<DashboardMetricsResponse | null>(null);
  const [loadingRegister, setLoadingRegister] = useState<boolean>(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Selected case detail state
  const [reports, setReports] = useState<EvidencePackRecord[]>([]);
  const [lifecycleHistory, setLifecycleHistory] = useState<LifecycleHistoryEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailFeedback, setDetailFeedback] = useState<{
    kind: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  // Report generation form state
  const [preparedBy, setPreparedBy] = useState<string>("");
  const [reportProjectName, setReportProjectName] = useState<string>("");
  const [reportSubcontractor, setReportSubcontractor] = useState<string>("");
  const [reportVarRef, setReportVarRef] = useState<string>("");
  const [generatingReport, setGeneratingReport] = useState<boolean>(false);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);

  // Lifecycle & tracking form state
  const [targetStatus, setTargetStatus] = useState<VariationLifecycleStatus | "">("");
  const [responsiblePerson, setResponsiblePerson] = useState<string>("");
  const [transitionReason, setTransitionReason] = useState<string>("");
  const [submissionRef, setSubmissionRef] = useState<string>("");
  const [submissionDate, setSubmissionDate] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");
  const [claimedAmount, setClaimedAmount] = useState<string>("");
  const [approvedAmount, setApprovedAmount] = useState<string>("");
  const [executionStatus, setExecutionStatus] = useState<string>("");
  const [invoiceRef, setInvoiceRef] = useState<string>("");
  const [billedAmount, setBilledAmount] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>("");
  const [paidAmount, setPaidAmount] = useState<string>("");
  const [trackingNotes, setTrackingNotes] = useState<string>("");
  const [updatingLifecycle, setUpdatingLifecycle] = useState<boolean>(false);

  const knownProjects = useMemo(() => {
    const unique = new Set<string>();
    for (const item of allCases) {
      if (item.project_id) unique.add(item.project_id);
    }
    return Array.from(unique).sort();
  }, [allCases]);

  const loadRegisterData = useCallback(async () => {
    setLoadingRegister(true);
    setRegisterError(null);
    try {
      const cleanProj = filterProject.trim() || undefined;
      const [casesResp, metricsResp] = await Promise.all([
        fetchCases({
          projectId: cleanProj,
          status: filterStatus,
          dateFrom: filterDateFrom || undefined,
          dateTo: filterDateTo || undefined,
        }),
        fetchDashboardMetrics(cleanProj),
      ]);
      setFilteredCases(casesResp);
      setMetrics(metricsResp);
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : "Failed to load variation register."
      );
    } finally {
      setLoadingRegister(false);
    }
  }, [filterProject, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => {
    void loadRegisterData();
  }, [loadRegisterData, allCases.length]);

  const selectedCase = useMemo(() => {
    if (!selectedCaseId) return null;
    return (
      filteredCases.find((c) => c.id === selectedCaseId) ||
      allCases.find((c) => c.id === selectedCaseId) ||
      null
    );
  }, [selectedCaseId, filteredCases, allCases]);

  const syncCaseForms = useCallback((item: VariationCase) => {
    const tr = item.commercial_tracking;
    setPreparedBy(item.qs_decision.reviewer_name || tr.responsible_person || "");
    setReportProjectName(tr.project_name || "");
    setReportSubcontractor(tr.subcontractor_name || "");
    setReportVarRef(item.variation_reference || "");

    const allowed = ALLOWED_TRANSITIONS[item.lifecycle_status] || [];
    setTargetStatus(allowed.length > 0 ? allowed[0] : "");
    setResponsiblePerson(tr.responsible_person || item.qs_decision.reviewer_name || "");
    setTransitionReason("");
    setSubmissionRef(tr.submission_reference || "");
    setSubmissionDate(tr.submission_date || "");
    setRecipient(tr.recipient || "");
    setClaimedAmount(tr.claimed_amount ?? "");
    setApprovedAmount(tr.approved_amount ?? "");
    setExecutionStatus(tr.execution_status || "");
    setInvoiceRef(tr.invoice_reference || "");
    setBilledAmount(tr.billed_amount ?? "");
    setPaymentStatus(tr.payment_status || "");
    setPaymentDate(tr.payment_date || "");
    setPaidAmount(tr.paid_amount ?? "");
    setTrackingNotes(tr.notes || "");
  }, []);

  const loadSelectedCaseDetails = useCallback(
    async (item: VariationCase) => {
      setDetailLoading(true);
      setDetailFeedback(null);
      syncCaseForms(item);
      try {
        const [reps, hist] = await Promise.all([
          fetchCaseReports(item.id, item.project_id),
          fetchCaseLifecycleHistory(item.id, item.project_id),
        ]);
        setReports(reps);
        setLifecycleHistory(hist);
      } catch (err) {
        setDetailFeedback({
          kind: "error",
          text:
            err instanceof Error
              ? err.message
              : "Failed to load evidence packs or lifecycle history.",
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [syncCaseForms]
  );

  useEffect(() => {
    if (selectedCase) {
      void loadSelectedCaseDetails(selectedCase);
    } else {
      setReports([]);
      setLifecycleHistory([]);
    }
  }, [selectedCase?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateReport = async () => {
    if (!selectedCase) return;
    if (!preparedBy.trim()) {
      setDetailFeedback({
        kind: "error",
        text: "Prepared By is required to generate an evidence pack PDF.",
      });
      return;
    }
    setGeneratingReport(true);
    setDetailFeedback(null);
    try {
      const record = await generateCaseReport(
        selectedCase.id,
        {
          prepared_by: preparedBy.trim(),
          project_name: reportProjectName.trim() || null,
          subcontractor_name: reportSubcontractor.trim() || null,
          variation_reference: reportVarRef.trim() || null,
        },
        selectedCase.project_id
      );
      const updatedCase: VariationCase = {
        ...selectedCase,
        variation_reference: record.variation_reference,
        latest_report_id: record.id,
        commercial_tracking: {
          ...selectedCase.commercial_tracking,
          project_name: record.project_name,
          subcontractor_name: record.subcontractor_name,
        },
      };
      onCaseUpdated(updatedCase);
      await loadSelectedCaseDetails(updatedCase);
      await loadRegisterData();
      setDetailFeedback({
        kind: "success",
        text: `Generated ${record.filename} (${record.page_count} pages) [${record.status_label}].`,
      });
    } catch (err) {
      setDetailFeedback({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to generate evidence pack PDF.",
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleDownloadPdf = async (rep: EvidencePackRecord) => {
    setDownloadingReportId(rep.id);
    setDetailFeedback(null);
    try {
      await downloadCaseReport(rep.case_id, rep.id, rep.project_id, rep.filename);
    } catch (err) {
      setDetailFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to download PDF.",
      });
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleAdvanceLifecycle = async () => {
    if (!selectedCase || !targetStatus) return;
    if (!responsiblePerson.trim()) {
      setDetailFeedback({
        kind: "error",
        text: "Responsible Person is required to change lifecycle status.",
      });
      return;
    }
    setUpdatingLifecycle(true);
    setDetailFeedback(null);
    try {
      const effectiveTargetApproved = APPROVED_OR_LATER.has(targetStatus);
      const result = await updateCaseLifecycle(
        selectedCase.id,
        {
          target_status: targetStatus,
          responsible_person: responsiblePerson.trim(),
          reason: transitionReason.trim() || null,
          project_name: reportProjectName.trim() || null,
          subcontractor_name: reportSubcontractor.trim() || null,
          variation_reference: reportVarRef.trim() || null,
          submission_reference: submissionRef.trim() || null,
          submission_date: submissionDate.trim() || null,
          recipient: recipient.trim() || null,
          claimed_amount: claimedAmount.trim() || null,
          approved_amount:
            effectiveTargetApproved && approvedAmount.trim()
              ? approvedAmount.trim()
              : null,
          billed_amount:
            (targetStatus === "billed" || targetStatus === "paid") &&
            billedAmount.trim()
              ? billedAmount.trim()
              : null,
          paid_amount:
            targetStatus === "paid" && paidAmount.trim()
              ? paidAmount.trim()
              : null,
          execution_status: executionStatus.trim() || null,
          invoice_reference: invoiceRef.trim() || null,
          payment_status: paymentStatus.trim() || null,
          payment_date: paymentDate.trim() || null,
          notes: trackingNotes.trim() || null,
        },
        selectedCase.project_id
      );
      onCaseUpdated(result.case);
      syncCaseForms(result.case);
      await loadSelectedCaseDetails(result.case);
      await loadRegisterData();
      setDetailFeedback({
        kind: "success",
        text: `Lifecycle updated to '${result.case.lifecycle_status}' by ${result.history_entry.changed_by}.`,
      });
    } catch (err) {
      setDetailFeedback({
        kind: "error",
        text:
          err instanceof Error ? err.message : "Failed to advance lifecycle status.",
      });
    } finally {
      setUpdatingLifecycle(false);
    }
  };

  const handleSaveTrackingOnly = async () => {
    if (!selectedCase) return;
    if (!responsiblePerson.trim()) {
      setDetailFeedback({
        kind: "error",
        text: "Responsible Person is required to update tracking details.",
      });
      return;
    }
    setUpdatingLifecycle(true);
    setDetailFeedback(null);
    try {
      const canApprove = APPROVED_OR_LATER.has(selectedCase.lifecycle_status);
      const isBilledOrPaid =
        selectedCase.lifecycle_status === "billed" ||
        selectedCase.lifecycle_status === "paid";
      const isPaid = selectedCase.lifecycle_status === "paid";

      const updated = await updateCaseTracking(
        selectedCase.id,
        {
          updated_by: responsiblePerson.trim(),
          project_name: reportProjectName.trim() || null,
          subcontractor_name: reportSubcontractor.trim() || null,
          variation_reference: reportVarRef.trim() || null,
          responsible_person: responsiblePerson.trim(),
          submission_reference: submissionRef.trim() || null,
          submission_date: submissionDate.trim() || null,
          recipient: recipient.trim() || null,
          claimed_amount: claimedAmount.trim() || null,
          approved_amount: canApprove && approvedAmount.trim() ? approvedAmount.trim() : null,
          billed_amount: isBilledOrPaid && billedAmount.trim() ? billedAmount.trim() : null,
          paid_amount: isPaid && paidAmount.trim() ? paidAmount.trim() : null,
          execution_status: canApprove ? executionStatus.trim() || null : null,
          invoice_reference: isBilledOrPaid ? invoiceRef.trim() || null : null,
          payment_status: isPaid ? paymentStatus.trim() || null : null,
          payment_date: isPaid ? paymentDate.trim() || null : null,
          notes: trackingNotes.trim() || null,
        },
        selectedCase.project_id
      );
      onCaseUpdated(updated);
      syncCaseForms(updated);
      await loadRegisterData();
      setDetailFeedback({
        kind: "success",
        text: `Saved commercial tracking updates without changing lifecycle status (${updated.lifecycle_status}).`,
      });
    } catch (err) {
      setDetailFeedback({
        kind: "error",
        text:
          err instanceof Error ? err.message : "Failed to save tracking details.",
      });
    } finally {
      setUpdatingLifecycle(false);
    }
  };

  const allowedNext = selectedCase
    ? ALLOWED_TRANSITIONS[selectedCase.lifecycle_status] || []
    : [];
  const nextOrCurrentAllowsApproval = Boolean(
    selectedCase &&
      (APPROVED_OR_LATER.has(selectedCase.lifecycle_status) ||
        (targetStatus && APPROVED_OR_LATER.has(targetStatus)))
  );

  return (
    <section>
      <div className="panel-header">
        <h2>Commercial Dashboard &amp; Variation Register</h2>
        <div className="status-strip">
          <span className="badge badge-phase">
            Phase 6: Evidence Packs &amp; Lifecycle
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => void loadRegisterData()}
            disabled={loadingRegister}
          >
            {loadingRegister ? "Refreshing..." : "Refresh Register"}
          </button>
        </div>
      </div>

      {registerError && (
        <div className="feedback-banner feedback-error" role="alert">
          {registerError}
        </div>
      )}

      {/* Commercial Dashboard Metrics */}
      {metrics && (
        <div className="sub-card">
          <div className="panel-header">
            <h3>Commercial Summary Dashboard</h3>
            <div className="status-strip">
              <span className="badge badge-ok">
                Live Records: {metrics.live_case_count}
              </span>
              {metrics.contains_demo_data && (
                <span className="badge badge-ai">
                  DEMO DATA: {metrics.demo_case_count} synthetic record
                  {metrics.demo_case_count === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          {metrics.contains_demo_data && (
            <div className="feedback-banner feedback-warning">
              <strong>DEMO DATA:</strong> Summary figures include{" "}
              {metrics.demo_case_count} synthetic sample case(s). Sample data must
              not be mistaken for confirmed project commercial positions.
            </div>
          )}

          <div className="dashboard-kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Awaiting QS Review</div>
              <div className="kpi-value">{metrics.awaiting_qs_review_count}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Drafted (Not Submitted)</div>
              <div className="kpi-value">{metrics.drafted_not_submitted_count}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Submitted (Awaiting Response)</div>
              <div className="kpi-value">
                {metrics.submitted_awaiting_response_count}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Approved (Not Billed)</div>
              <div className="kpi-value">{metrics.approved_not_billed_count}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Billed (Unpaid)</div>
              <div className="kpi-value">{metrics.billed_unpaid_count}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Incomplete Evidence</div>
              <div className="kpi-value">{metrics.incomplete_evidence_count}</div>
            </div>
          </div>

          {metrics.amounts_by_currency.length > 0 ? (
            <div className="table-wrap section-spacer">
              <table className="boq-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th className="num-cell">Potential Variation Value (Open Pre-Approval)</th>
                    <th className="num-cell">Proposed / Claimed Total</th>
                    <th className="num-cell">Client-Approved Total</th>
                    <th className="num-cell">Approved (Unbilled)</th>
                    <th className="num-cell">Billed Total</th>
                    <th className="num-cell">Billed (Unpaid)</th>
                    <th className="num-cell">Paid Total</th>
                    <th className="num-cell">Unpriced Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.amounts_by_currency.map((row) => (
                    <tr key={row.currency}>
                      <td>
                        <strong>{row.currency}</strong>
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.potential_variation_value, row.currency)}
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.proposed_total, row.currency)} ({row.proposed_case_count})
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.approved_total, row.currency)} ({row.approved_case_count})
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.approved_unbilled_total, row.currency)}
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.billed_total, row.currency)} ({row.billed_case_count})
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.billed_unpaid_total, row.currency)}
                      </td>
                      <td className="num-cell">
                        {formatMoney(row.paid_total, row.currency)} ({row.paid_case_count})
                      </td>
                      <td className="num-cell">{row.unpriced_case_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted-note section-spacer">
              No variation cases persisted for this filter scope yet.
            </p>
          )}
          <p className="muted-note">{metrics.disclaimer}</p>
        </div>
      )}

      {/* Filter Bar */}
      <div className="sub-card section-spacer">
        <h3>Register Filters</h3>
        <div className="cost-settings-grid">
          <div className="field-group">
            <label htmlFor="reg-filter-project">Project ID</label>
            <input
              id="reg-filter-project"
              list="known-project-ids"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              placeholder="All projects"
            />
            <datalist id="known-project-ids">
              {knownProjects.map((proj) => (
                <option key={proj} value={proj} />
              ))}
            </datalist>
          </div>
          <div className="field-group">
            <label htmlFor="reg-filter-status">Lifecycle Status</label>
            <select
              id="reg-filter-status"
              className="status-select small-input"
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(e.target.value as VariationLifecycleStatus | "")
              }
            >
              <option value="">All lifecycle statuses</option>
              {ALL_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {lifecycleLabel(st)}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="reg-filter-from">Created From</label>
            <input
              id="reg-filter-from"
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="reg-filter-to">Created To</label>
            <input
              id="reg-filter-to"
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>
        </div>
        <div className="edit-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void loadRegisterData()}
            disabled={loadingRegister}
          >
            Apply Filters
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFilterProject("");
              setFilterStatus("");
              setFilterDateFrom("");
              setFilterDateTo("");
            }}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Commercial Variation Register Table */}
      <div className="sub-card section-spacer">
        <div className="panel-header">
          <h3>Variation Register ({filteredCases.length})</h3>
        </div>
        {filteredCases.length === 0 ? (
          <div className="empty-state">
            No variation cases match the active filters.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="boq-table">
              <thead>
                <tr>
                  <th>Variation Ref</th>
                  <th>Project</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th className="num-cell">Proposed Amount</th>
                  <th className="num-cell">Approved Amount</th>
                  <th>Submission Date</th>
                  <th>Outstanding Action</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((item) => {
                  const isSelected = selectedCase?.id === item.id;
                  const currency = item.deterministic_estimate?.currency;
                  const proposed =
                    item.commercial_tracking.claimed_amount ??
                    item.deterministic_estimate?.total_estimated_amount ??
                    null;
                  const approved = APPROVED_OR_LATER.has(item.lifecycle_status)
                    ? item.commercial_tracking.approved_amount
                    : null;
                  return (
                    <tr
                      key={item.id}
                      className={isSelected ? "selected-row" : undefined}
                    >
                      <td>
                        <span className="ref-pill">{effectiveRef(item)}</span>
                      </td>
                      <td>{item.project_id}</td>
                      <td>
                        <strong>{item.title}</strong>
                        {item.is_demo && (
                          <div>
                            <span className="badge badge-ai">DEMO DATA</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${lifecycleBadgeClass(item.lifecycle_status)}`}
                        >
                          {lifecycleLabel(item.lifecycle_status)}
                        </span>
                      </td>
                      <td className="num-cell">
                        {formatMoney(proposed, currency, "Unpriced")}
                      </td>
                      <td className="num-cell">
                        {approved !== null ? (
                          <strong>{formatMoney(approved, currency)}</strong>
                        ) : (
                          <span className="null-cell">Not approved</span>
                        )}
                      </td>
                      <td>
                        {item.commercial_tracking.submission_date || (
                          <span className="null-cell">—</span>
                        )}
                      </td>
                      <td>{computeClientActionHint(item)}</td>
                      <td>{formatIsoDateTime(item.updated_at)}</td>
                      <td>
                        <div className="edit-row">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => onSelectCaseId(item.id)}
                          >
                            {isSelected ? "Inspecting" : "Open Details"}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              onSelectCaseId(item.id);
                              onNavigateTab("qs_workbench");
                            }}
                          >
                            QS Review
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              onSelectCaseId(item.id);
                              onNavigateTab("review");
                            }}
                          >
                            Assessment
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              onSelectCaseId(item.id);
                              onNavigateTab("instruction");
                            }}
                          >
                            Event
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Case Detail Workbench: Evidence Packs & Commercial Lifecycle */}
      {selectedCase && (
        <div className="sub-card section-spacer">
          <div className="panel-header">
            <div>
              <h3>
                {effectiveRef(selectedCase)} — {selectedCase.title}
              </h3>
              <p className="muted-note">
                Project: <strong>{selectedCase.project_id}</strong> | Case ID:{" "}
                <code>{selectedCase.id}</code> | QS Review:{" "}
                <strong>{selectedCase.qs_decision.review_status}</strong>
              </p>
            </div>
            <div className="status-strip">
              {selectedCase.is_demo && (
                <span className="badge badge-ai">DEMO DATA</span>
              )}
              <span
                className={`badge ${lifecycleBadgeClass(selectedCase.lifecycle_status)}`}
              >
                {lifecycleLabel(selectedCase.lifecycle_status)}
              </span>
            </div>
          </div>

          {detailFeedback && (
            <div
              className={`feedback-banner feedback-${detailFeedback.kind}`}
              role="status"
            >
              {detailFeedback.text}
            </div>
          )}

          {/* 1. Evidence Pack Generation & Download */}
          <div className="sub-section">
            <h4>1. Draft &amp; Variation Evidence Pack PDFs</h4>
            <div className="cost-settings-grid">
              <div className="field-group">
                <label htmlFor="pack-prepared-by">Prepared By *</label>
                <input
                  id="pack-prepared-by"
                  value={preparedBy}
                  onChange={(e) => setPreparedBy(e.target.value)}
                  placeholder="QS / Engineer full name"
                />
              </div>
              <div className="field-group">
                <label htmlFor="pack-project-name">Project Name (Optional)</label>
                <input
                  id="pack-project-name"
                  value={reportProjectName}
                  onChange={(e) => setReportProjectName(e.target.value)}
                  placeholder="e.g. Marina Tower MEP Package"
                />
              </div>
              <div className="field-group">
                <label htmlFor="pack-subcontractor">Subcontractor Name (Optional)</label>
                <input
                  id="pack-subcontractor"
                  value={reportSubcontractor}
                  onChange={(e) => setReportSubcontractor(e.target.value)}
                  placeholder="e.g. Apex Mechanical Ltd"
                />
              </div>
              <div className="field-group">
                <label htmlFor="pack-var-ref">Variation Reference</label>
                <input
                  id="pack-var-ref"
                  value={reportVarRef}
                  onChange={(e) => setReportVarRef(e.target.value)}
                  placeholder={effectiveRef(selectedCase)}
                />
              </div>
            </div>
            <div className="edit-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleGenerateReport()}
                disabled={generatingReport}
              >
                {generatingReport
                  ? "Generating PDF..."
                  : "Generate Draft Evidence Pack (PDF)"}
              </button>
            </div>

            {detailLoading ? (
              <p className="muted-note">Loading generated evidence packs...</p>
            ) : reports.length === 0 ? (
              <p className="muted-note">
                No evidence pack PDFs generated for this variation yet.
              </p>
            ) : (
              <ul className="data-list section-spacer">
                {reports.map((rep) => (
                  <li key={rep.id} className="data-row">
                    <div>
                      <strong>{rep.filename}</strong>{" "}
                      <span
                        className={`badge ${
                          rep.is_draft ? "badge-ai" : "badge-ok"
                        }`}
                      >
                        {rep.status_label}
                      </span>
                      {rep.is_demo && (
                        <span className="badge badge-ai"> DEMO DATA</span>
                      )}
                      <div className="muted-note">
                        Prepared by {rep.prepared_by} | {rep.page_count} page(s) |{" "}
                        {formatIsoDateTime(rep.generated_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleDownloadPdf(rep)}
                      disabled={downloadingReportId === rep.id}
                    >
                      {downloadingReportId === rep.id
                        ? "Downloading..."
                        : "Download PDF"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 2. Commercial Lifecycle & Tracking Update */}
          <div className="sub-section section-spacer">
            <h4>2. Variation Lifecycle Transition &amp; Commercial Tracking</h4>
            <p className="muted-note">
              Cases never auto-advance to submitted, approved, executed, billed, or
              paid. Explicit human updates are recorded in an append-only history.
            </p>
            <div className="cost-settings-grid">
              <div className="field-group">
                <label htmlFor="lc-responsible">Responsible Person *</label>
                <input
                  id="lc-responsible"
                  value={responsiblePerson}
                  onChange={(e) => setResponsiblePerson(e.target.value)}
                  placeholder="Commercial manager / QS"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-target">Next Valid Status</label>
                <select
                  id="lc-target"
                  className="status-select small-input"
                  value={targetStatus}
                  onChange={(e) =>
                    setTargetStatus(e.target.value as VariationLifecycleStatus | "")
                  }
                  disabled={allowedNext.length === 0}
                >
                  {allowedNext.length === 0 ? (
                    <option value="">Terminal state ({selectedCase.lifecycle_status})</option>
                  ) : (
                    allowedNext.map((st) => (
                      <option key={st} value={st}>
                        {lifecycleLabel(st)}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="lc-reason">Status Change Reason (Required if rejecting)</label>
                <input
                  id="lc-reason"
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                  placeholder="Reason / instruction basis"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-sub-ref">Submission Reference</label>
                <input
                  id="lc-sub-ref"
                  value={submissionRef}
                  onChange={(e) => setSubmissionRef(e.target.value)}
                  placeholder="Required for Submitted"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-sub-date">Submission Date</label>
                <input
                  id="lc-sub-date"
                  type="date"
                  value={submissionDate}
                  onChange={(e) => setSubmissionDate(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-recipient">Submission Recipient</label>
                <input
                  id="lc-recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Main contractor QS / PM"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-claimed">Claimed / Proposed Amount</label>
                <input
                  id="lc-claimed"
                  value={claimedAmount}
                  onChange={(e) => setClaimedAmount(e.target.value)}
                  placeholder={
                    selectedCase.deterministic_estimate?.total_estimated_amount ||
                    "e.g. 2450.00"
                  }
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-approved">Client-Approved Amount (Approved+ only)</label>
                <input
                  id="lc-approved"
                  value={approvedAmount}
                  onChange={(e) => setApprovedAmount(e.target.value)}
                  disabled={!nextOrCurrentAllowsApproval}
                  placeholder={
                    nextOrCurrentAllowsApproval
                      ? "Confirmed approved value"
                      : "Locked until approved"
                  }
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-exec">Execution Status</label>
                <input
                  id="lc-exec"
                  value={executionStatus}
                  onChange={(e) => setExecutionStatus(e.target.value)}
                  disabled={!nextOrCurrentAllowsApproval}
                  placeholder="e.g. Completed on site"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-inv-ref">Invoice / Running-Bill Ref</label>
                <input
                  id="lc-inv-ref"
                  value={invoiceRef}
                  onChange={(e) => setInvoiceRef(e.target.value)}
                  placeholder="Required for Billed"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-billed-amt">Billed Amount</label>
                <input
                  id="lc-billed-amt"
                  value={billedAmount}
                  onChange={(e) => setBilledAmount(e.target.value)}
                  placeholder="Invoiced amount"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-pay-status">Payment Status</label>
                <input
                  id="lc-pay-status"
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                  placeholder="e.g. Settled by EFT"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-pay-date">Payment Date</label>
                <input
                  id="lc-pay-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-paid-amt">Paid Amount</label>
                <input
                  id="lc-paid-amt"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="Settled cash amount"
                />
              </div>
              <div className="field-group">
                <label htmlFor="lc-notes">Commercial Notes</label>
                <input
                  id="lc-notes"
                  value={trackingNotes}
                  onChange={(e) => setTrackingNotes(e.target.value)}
                  placeholder="Commercial correspondence notes"
                />
              </div>
            </div>
            <div className="edit-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAdvanceLifecycle()}
                disabled={updatingLifecycle || allowedNext.length === 0 || !targetStatus}
              >
                {updatingLifecycle
                  ? "Updating..."
                  : targetStatus
                    ? `Advance Status -> ${lifecycleLabel(targetStatus)}`
                    : "Terminal Status"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleSaveTrackingOnly()}
                disabled={updatingLifecycle}
              >
                Update Tracking Only (Keep Status)
              </button>
            </div>
          </div>

          {/* 3. Append-Only Lifecycle History */}
          <div className="sub-section section-spacer">
            <h4>3. Append-Only Lifecycle Status History</h4>
            {lifecycleHistory.length === 0 ? (
              <p className="muted-note">No lifecycle history entries recorded.</p>
            ) : (
              <ul className="data-list">
                {lifecycleHistory.map((entry) => (
                  <li key={entry.id} className="data-row">
                    <div>
                      <strong>
                        {entry.from_status
                          ? `${lifecycleLabel(entry.from_status)} -> `
                          : "INITIAL -> "}
                        {lifecycleLabel(entry.to_status)}
                      </strong>
                      <div className="muted-note">
                        By {entry.changed_by} at {formatIsoDateTime(entry.changed_at)}
                        {entry.reason ? ` | Reason: ${entry.reason}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
