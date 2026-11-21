import type {
  CommercialAssessmentRecord,
  CommercialTrackingUpdateRequest,
  ConfirmExtractionRequest,
  CostEstimateResponse,
  CostEstimateUpdateRequest,
  DashboardMetricsResponse,
  DeterministicEstimate,
  DocumentIngestResponse,
  DocumentMetadata,
  EvidencePackRecord,
  GenerateReportRequest,
  HealthResponse,
  LifecycleHistoryEntry,
  LifecycleTransitionRequest,
  LifecycleTransitionResponse,
  QsReviewRequest,
  QsReviewResponse,
  ReviewHistoryEntry,
  VariationCase,
  VariationLifecycleStatus,
} from "../types/domain";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

function formatApiErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const entry = item as { loc?: unknown; msg?: unknown };
          const msg = typeof entry.msg === "string" ? entry.msg.trim() : "";
          const loc = Array.isArray(entry.loc)
            ? entry.loc.map((part) => String(part)).join(".")
            : "";
          return msg ? (loc ? `${loc}: ${msg}` : msg) : "";
        }
        return typeof item === "string" ? item.trim() : "";
      })
      .filter((msg) => msg.length > 0);
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }
  return fallback;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = formatApiErrorDetail(payload.detail, detail);
    } catch {
      // Keep HTTP status detail if response body is not JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/api/health");
}

export function fetchDocuments(projectId?: string): Promise<DocumentMetadata[]> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<DocumentMetadata[]>(`/api/documents${query}`);
}

export function fetchDocumentDetail(
  documentId: string
): Promise<DocumentIngestResponse> {
  return requestJson<DocumentIngestResponse>(
    `/api/documents/${encodeURIComponent(documentId)}`
  );
}

export function uploadContractPdf(
  file: File,
  projectId: string,
  isDemo: boolean
): Promise<DocumentIngestResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("project_id", projectId);
  form.append("is_demo", String(isDemo));
  return requestJson<DocumentIngestResponse>("/api/documents/contract", {
    method: "POST",
    body: form,
  });
}

export function uploadBoqExcel(
  file: File,
  projectId: string,
  isDemo: boolean
): Promise<DocumentIngestResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("project_id", projectId);
  form.append("is_demo", String(isDemo));
  return requestJson<DocumentIngestResponse>("/api/documents/boq", {
    method: "POST",
    body: form,
  });
}

export interface CaseListFilters {
  projectId?: string;
  status?: VariationLifecycleStatus | "";
  dateFrom?: string;
  dateTo?: string;
}

export function fetchCases(
  projectIdOrFilters?: string | CaseListFilters
): Promise<VariationCase[]> {
  const params = new URLSearchParams();
  if (typeof projectIdOrFilters === "string") {
    if (projectIdOrFilters.trim()) {
      params.set("project_id", projectIdOrFilters.trim());
    }
  } else if (projectIdOrFilters) {
    if (projectIdOrFilters.projectId?.trim()) {
      params.set("project_id", projectIdOrFilters.projectId.trim());
    }
    if (projectIdOrFilters.status) {
      params.set("status", projectIdOrFilters.status);
    }
    if (projectIdOrFilters.dateFrom?.trim()) {
      params.set("date_from", projectIdOrFilters.dateFrom.trim());
    }
    if (projectIdOrFilters.dateTo?.trim()) {
      params.set("date_to", projectIdOrFilters.dateTo.trim());
    }
  }
  const qs = params.toString();
  return requestJson<VariationCase[]>(`/api/cases${qs ? `?${qs}` : ""}`);
}

export function fetchCaseDetail(caseId: string): Promise<VariationCase> {
  return requestJson<VariationCase>(
    `/api/cases/${encodeURIComponent(caseId)}`
  );
}

export function submitSiteInstruction(params: {
  projectId: string;
  instructionText: string;
  isDemo: boolean;
  attachment?: File | null;
}): Promise<VariationCase> {
  const form = new FormData();
  form.append("project_id", params.projectId);
  form.append("instruction_text", params.instructionText);
  form.append("is_demo", String(params.isDemo));
  if (params.attachment) {
    form.append("attachment", params.attachment);
  }
  return requestJson<VariationCase>("/api/cases/instructions", {
    method: "POST",
    body: form,
  });
}

export function confirmCaseExtraction(
  caseId: string,
  payload: ConfirmExtractionRequest
): Promise<VariationCase> {
  return requestJson<VariationCase>(
    `/api/cases/${encodeURIComponent(caseId)}/extraction`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function runCaseAssessment(
  caseId: string,
  projectId?: string
): Promise<CommercialAssessmentRecord> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<CommercialAssessmentRecord>(
    `/api/cases/${encodeURIComponent(caseId)}/assessment${query}`,
    {
      method: "POST",
    }
  );
}

export async function fetchCaseAssessment(
  caseId: string,
  projectId?: string
): Promise<CommercialAssessmentRecord | null> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  const response = await fetch(
    `${API_BASE}/api/cases/${encodeURIComponent(caseId)}/assessment${query}`,
    {
      headers: { Accept: "application/json" },
    }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = formatApiErrorDetail(payload.detail, detail);
    } catch {
      // Keep status text
    }
    throw new Error(detail);
  }
  return (await response.json()) as CommercialAssessmentRecord;
}

export function fetchAssessments(
  projectId?: string
): Promise<CommercialAssessmentRecord[]> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<CommercialAssessmentRecord[]>(`/api/assessments${query}`);
}

export function fetchCaseCostEstimate(
  caseId: string,
  projectId?: string
): Promise<DeterministicEstimate> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<DeterministicEstimate>(
    `/api/cases/${encodeURIComponent(caseId)}/cost-estimate${query}`
  );
}

export function saveCaseCostEstimate(
  caseId: string,
  payload: CostEstimateUpdateRequest,
  projectId?: string
): Promise<CostEstimateResponse> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<CostEstimateResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/cost-estimate${query}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function submitCaseQsReview(
  caseId: string,
  payload: QsReviewRequest,
  projectId?: string
): Promise<QsReviewResponse> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<QsReviewResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/review${query}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function fetchCaseReviewHistory(
  caseId: string,
  projectId?: string
): Promise<ReviewHistoryEntry[]> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<ReviewHistoryEntry[]>(
    `/api/cases/${encodeURIComponent(caseId)}/review-history${query}`
  );
}

export function generateCaseReport(
  caseId: string,
  payload: GenerateReportRequest,
  projectId?: string
): Promise<EvidencePackRecord> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<EvidencePackRecord>(
    `/api/cases/${encodeURIComponent(caseId)}/report${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function fetchCaseReports(
  caseId: string,
  projectId?: string
): Promise<EvidencePackRecord[]> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<EvidencePackRecord[]>(
    `/api/cases/${encodeURIComponent(caseId)}/reports${query}`
  );
}

export function getReportDownloadUrl(
  caseId: string,
  reportId: string,
  projectId: string
): string {
  return `${API_BASE}/api/cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(
    reportId
  )}/download?project_id=${encodeURIComponent(projectId)}`;
}

export async function downloadCaseReport(
  caseId: string,
  reportId: string,
  projectId: string,
  fallbackFilename: string
): Promise<void> {
  const url = getReportDownloadUrl(caseId, reportId, projectId);
  const response = await fetch(url, {
    headers: { Accept: "application/pdf" },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = formatApiErrorDetail(payload.detail, detail);
    } catch {
      // Keep status text
    }
    throw new Error(detail);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function updateCaseLifecycle(
  caseId: string,
  payload: LifecycleTransitionRequest,
  projectId?: string
): Promise<LifecycleTransitionResponse> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<LifecycleTransitionResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/lifecycle${query}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function updateCaseTracking(
  caseId: string,
  payload: CommercialTrackingUpdateRequest,
  projectId?: string
): Promise<VariationCase> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<VariationCase>(
    `/api/cases/${encodeURIComponent(caseId)}/tracking${query}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export function fetchCaseLifecycleHistory(
  caseId: string,
  projectId?: string
): Promise<LifecycleHistoryEntry[]> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<LifecycleHistoryEntry[]>(
    `/api/cases/${encodeURIComponent(caseId)}/lifecycle-history${query}`
  );
}

export function fetchDashboardMetrics(
  projectId?: string
): Promise<DashboardMetricsResponse> {
  const query = projectId?.trim()
    ? `?project_id=${encodeURIComponent(projectId.trim())}`
    : "";
  return requestJson<DashboardMetricsResponse>(`/api/dashboard/metrics${query}`);
}
