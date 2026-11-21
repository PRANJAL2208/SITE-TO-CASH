import { useCallback, useEffect, useState } from "react";
import {
  fetchCaseDetail,
  fetchCases,
  fetchDocuments,
  fetchHealth,
} from "../api/client";
import type {
  CommercialAssessmentRecord,
  DocumentMetadata,
  HealthResponse,
  VariationCase,
} from "../types/domain";
import AssessmentTab from "./AssessmentTab";
import InstructionTab from "./InstructionTab";
import LiveDocumentsTab from "./LiveDocumentsTab";
import QsReviewTab from "./QsReviewTab";
import RegisterTab from "./RegisterTab";

type LiveTabId =
  | "documents"
  | "instruction"
  | "review"
  | "qs_workbench"
  | "register";

export default function LiveEngineWorkspace() {
  const [activeTab, setActiveTab] = useState<LiveTabId>("documents");
  const [projectId, setProjectId] = useState<string>("default-project");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [cases, setCases] = useState<VariationCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<VariationCase | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaceState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthPayload, docsPayload, casesPayload] = await Promise.all([
        fetchHealth(),
        fetchDocuments(),
        fetchCases(),
      ]);
      setHealth(healthPayload);
      setDocuments(docsPayload);
      setCases(casesPayload);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to reach backend API.";
      setError(message);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceState();
  }, [loadWorkspaceState]);

  const handleSelectCase = async (caseId: string) => {
    try {
      const detail = await fetchCaseDetail(caseId);
      setSelectedCase(detail);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load site-change event.";
      setError(message);
    }
  };

  const handleCaseCreated = (created: VariationCase) => {
    setSelectedCase(created);
    setCases((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
    void fetchDocuments().then(setDocuments).catch(() => {});
  };

  const handleCaseUpdated = (updated: VariationCase) => {
    setSelectedCase(updated);
    setCases((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  };

  const handleAssessmentSaved = (record: CommercialAssessmentRecord) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === record.case_id
          ? { ...c, latest_assessment_id: record.id }
          : c
      )
    );
    setSelectedCase((prev) =>
      prev && prev.id === record.case_id
        ? { ...prev, latest_assessment_id: record.id }
        : prev
    );
  };

  return (
    <div className="live-engine-shell">
      <div className="panel-header">
        <div>
          <h2>Live Backend Commercial Engine (Phases 1–7 API)</h2>
          <p className="muted-note">
            Connected directly to FastAPI (`/api/*`). Data created here is
            persisted in the real backend repository and completely separate
            from the simulated Buildathon Panel Demo store.
          </p>
        </div>
        <div className="status-strip">
          {health ? (
            <>
              <span className="badge badge-ok">
                API Connected ({health.version})
              </span>
              <span className="badge badge-phase">
                Storage: {health.storage_backend}
                {health.storage_ready ? " (ready)" : " (not ready)"}
              </span>
              <span
                className={`badge ${
                  health.gemini_configured ? "badge-ok" : "badge-ai"
                }`}
              >
                Gemini:{" "}
                {health.gemini_configured ? "Configured" : "Not configured"}
              </span>
            </>
          ) : (
            <span className="badge badge-err">
              {loading ? "Connecting..." : "API Disconnected"}
            </span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void loadWorkspaceState()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh Live API"}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <strong>Live Backend Unreachable:</strong> {error}. The Buildathon
          Panel Demo screens remain fully interactive offline; start FastAPI on
          port 8000 to exercise live ingestion, Gemini extraction, and PDF
          report generation.
        </div>
      )}

      <div className="guardrails-strip">
        <span>
          <strong>Backend Guardrails:</strong>
        </span>
        <span>No invented rates, quantities, clauses, or approvals</span>
        <span>Mandatory source references</span>
        <span>Deterministic Python Decimal calculations</span>
        <span>AI suggestions separated from QS human decisions</span>
      </div>

      <nav className="tabs" aria-label="Live Engine Workflow">
        <button
          type="button"
          className={`tab-btn ${activeTab === "documents" ? "active" : ""}`}
          onClick={() => setActiveTab("documents")}
        >
          1. Project Documents ({documents.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "instruction" ? "active" : ""}`}
          onClick={() => setActiveTab("instruction")}
        >
          2. Site Instruction
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "review" ? "active" : ""}`}
          onClick={() => setActiveTab("review")}
        >
          3. Contract Assessment
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "qs_workbench" ? "active" : ""}`}
          onClick={() => setActiveTab("qs_workbench")}
        >
          4. QS Review Workbench
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "register" ? "active" : ""}`}
          onClick={() => setActiveTab("register")}
        >
          5. Variation Register ({cases.length})
        </button>
      </nav>

      <div className="panel">
        {activeTab === "documents" && (
          <LiveDocumentsTab
            projectId={projectId}
            onProjectIdChange={setProjectId}
            documents={documents}
            onDocumentsChange={setDocuments}
          />
        )}

        {activeTab === "instruction" && (
          <InstructionTab
            projectId={projectId}
            onProjectIdChange={setProjectId}
            cases={cases}
            selectedCase={selectedCase}
            onSelectCase={handleSelectCase}
            onCaseCreated={handleCaseCreated}
            onCaseUpdated={handleCaseUpdated}
            geminiConfigured={health?.gemini_configured ?? false}
          />
        )}

        {activeTab === "review" && (
          <AssessmentTab
            cases={cases}
            selectedCaseId={selectedCase?.id ?? null}
            onSelectCaseId={(caseId) => {
              void handleSelectCase(caseId);
            }}
            onAssessmentSaved={handleAssessmentSaved}
            geminiConfigured={health?.gemini_configured ?? false}
          />
        )}

        {activeTab === "qs_workbench" && (
          <QsReviewTab
            cases={cases}
            selectedCaseId={selectedCase?.id ?? null}
            onSelectCaseId={(caseId) => {
              void handleSelectCase(caseId);
            }}
            onCaseUpdated={handleCaseUpdated}
          />
        )}

        {activeTab === "register" && (
          <RegisterTab
            allCases={cases}
            selectedCaseId={selectedCase?.id ?? null}
            onSelectCaseId={(caseId) => {
              void handleSelectCase(caseId);
            }}
            onCaseUpdated={handleCaseUpdated}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}
      </div>
    </div>
  );
}
