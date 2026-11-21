import { useRef, useState } from "react";
import {
  fetchDocumentDetail,
  fetchDocuments,
  uploadBoqExcel,
  uploadContractPdf,
} from "../api/client";
import type {
  DocumentIngestResponse,
  DocumentMetadata,
  DocumentProcessingStatus,
} from "../types/domain";

interface LiveDocumentsTabProps {
  projectId: string;
  onProjectIdChange: (value: string) => void;
  documents: DocumentMetadata[];
  onDocumentsChange: (docs: DocumentMetadata[]) => void;
}

interface FeedbackBanner {
  kind: "success" | "warning" | "error";
  text: string;
}

function statusBadgeClass(status: DocumentProcessingStatus): string {
  if (status === "extracted") return "badge-ok";
  if (status === "partial") return "badge-ai";
  return "badge-err";
}

function statusLabel(status: DocumentProcessingStatus): string {
  if (status === "extracted") return "Extracted";
  if (status === "partial") return "Partial";
  return "Unreadable / Scanned";
}

function renderNullableCell(value: string | null) {
  if (value === null || value === "") {
    return <span className="null-cell">—</span>;
  }
  return value;
}

export default function LiveDocumentsTab({
  projectId,
  onProjectIdChange,
  documents,
  onDocumentsChange,
}: LiveDocumentsTabProps) {
  const [isDemoUpload, setIsDemoUpload] = useState<boolean>(false);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [boqFile, setBoqFile] = useState<File | null>(null);
  const [uploadingType, setUploadingType] = useState<"contract" | "boq" | null>(
    null
  );
  const [feedback, setFeedback] = useState<FeedbackBanner | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<DocumentIngestResponse | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const contractInputRef = useRef<HTMLInputElement | null>(null);
  const boqInputRef = useRef<HTMLInputElement | null>(null);

  const handleSelectDocument = async (documentId: string) => {
    setDetailLoadingId(documentId);
    setFeedback(null);
    try {
      const detail = await fetchDocumentDetail(documentId);
      setSelectedDetail(detail);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load document details.";
      setFeedback({ kind: "error", text: message });
    } finally {
      setDetailLoadingId(null);
    }
  };

  const handleContractUpload = async () => {
    if (!contractFile) return;
    setUploadingType("contract");
    setFeedback(null);
    try {
      const result = await uploadContractPdf(
        contractFile,
        projectId.trim() || "default-project",
        isDemoUpload
      );
      setSelectedDetail(result);
      setContractFile(null);
      if (contractInputRef.current) {
        contractInputRef.current.value = "";
      }
      const docs = await fetchDocuments();
      onDocumentsChange(docs);
      const status = result.document.processing_status;
      setFeedback({
        kind: status === "extracted" ? "success" : "warning",
        text:
          result.document.status_message ||
          `Uploaded '${result.document.filename}'.`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Contract PDF upload failed.";
      setFeedback({ kind: "error", text: message });
    } finally {
      setUploadingType(null);
    }
  };

  const handleBoqUpload = async () => {
    if (!boqFile) return;
    setUploadingType("boq");
    setFeedback(null);
    try {
      const result = await uploadBoqExcel(
        boqFile,
        projectId.trim() || "default-project",
        isDemoUpload
      );
      setSelectedDetail(result);
      setBoqFile(null);
      if (boqInputRef.current) {
        boqInputRef.current.value = "";
      }
      const docs = await fetchDocuments();
      onDocumentsChange(docs);
      const status = result.document.processing_status;
      setFeedback({
        kind: status === "extracted" ? "success" : "warning",
        text:
          result.document.status_message ||
          `Uploaded '${result.document.filename}'.`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "BOQ Excel upload failed.";
      setFeedback({ kind: "error", text: message });
    } finally {
      setUploadingType(null);
    }
  };

  return (
    <section>
      <div className="panel-header">
        <h2>Project Contract &amp; BOQ Documents</h2>
        <span className="badge badge-ok">Phase 2 Active (Live API)</span>
      </div>

      <div className="scope-bar">
        <div className="field-group">
          <label htmlFor="project-id-input">Project ID</label>
          <input
            id="project-id-input"
            className="input-text"
            type="text"
            value={projectId}
            onChange={(e) => onProjectIdChange(e.target.value)}
            placeholder="e.g. proj-001"
          />
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isDemoUpload}
            onChange={(e) => setIsDemoUpload(e.target.checked)}
          />
          <span>Label upload as DEMO DATA</span>
        </label>
      </div>

      <div className="grid-two">
        <div className="card">
          <h3>
            Subcontract PDF
            <span className="badge badge-ok">PDF Extraction</span>
          </h3>
          <p className="muted">
            Upload a project contract PDF. Extracts text per page while
            preserving exact page numbers and reporting scanned pages.
          </p>
          <div className="upload-controls">
            <input
              ref={contractInputRef}
              className="file-input"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setContractFile(file);
                if (file && file.name.toLowerCase().startsWith("demo_")) {
                  setIsDemoUpload(true);
                }
              }}
            />
            <div className="inline-controls">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!contractFile || uploadingType !== null}
                onClick={() => void handleContractUpload()}
              >
                {uploadingType === "contract"
                  ? "Uploading & Extracting..."
                  : "Upload Contract PDF"}
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>
            Bill of Quantities (Excel)
            <span className="badge badge-ok">.xlsx Extraction</span>
          </h3>
          <p className="muted">
            Upload a BOQ workbook (.xlsx). Preserves sheet names and row
            numbers, handles merged cells/blank rows, and keeps missing
            quantities/rates null.
          </p>
          <div className="upload-controls">
            <input
              ref={boqInputRef}
              className="file-input"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setBoqFile(file);
                if (file && file.name.toLowerCase().startsWith("demo_")) {
                  setIsDemoUpload(true);
                }
              }}
            />
            <div className="inline-controls">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!boqFile || uploadingType !== null}
                onClick={() => void handleBoqUpload()}
              >
                {uploadingType === "boq"
                  ? "Uploading & Extracting..."
                  : "Upload BOQ Excel"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={
            feedback.kind === "error"
              ? "error-banner"
              : feedback.kind === "warning"
                ? "warning-banner"
                : "success-banner"
          }
          role="status"
        >
          {feedback.text}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="empty-state">
          No documents uploaded yet. Upload a contract PDF or BOQ `.xlsx`
          workbook (including sample files in `samples/` with DEMO DATA
          enabled).
        </div>
      ) : (
        <ul className="data-list">
          {documents.map((doc) => {
            const isSelected = selectedDetail?.document.id === doc.id;
            const summaryText =
              doc.document_type === "contract_pdf"
                ? `${doc.readable_page_count ?? 0}/${doc.page_count ?? 0} readable page(s)`
                : `${doc.sheet_count ?? 0} sheet(s) · ${doc.row_count ?? 0} row(s)`;

            return (
              <li
                key={doc.id}
                className={`data-row ${isSelected ? "selected" : ""}`}
              >
                <div>
                  <strong>{doc.filename}</strong>{" "}
                  <span className="badge badge-phase">
                    {doc.document_type === "contract_pdf"
                      ? "Contract PDF"
                      : "BOQ Excel"}
                  </span>{" "}
                  <span className="badge badge-phase">
                    Project: {doc.project_id}
                  </span>
                  <div className="meta-line">{summaryText}</div>
                </div>

                <div className="status-strip">
                  {doc.is_demo && (
                    <span className="badge badge-ai">DEMO DATA</span>
                  )}
                  <span
                    className={`badge ${statusBadgeClass(
                      doc.processing_status
                    )}`}
                  >
                    {statusLabel(doc.processing_status)}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    disabled={detailLoadingId === doc.id}
                    onClick={() => void handleSelectDocument(doc.id)}
                  >
                    {detailLoadingId === doc.id
                      ? "Loading..."
                      : isSelected
                        ? "Inspecting"
                        : "Inspect"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selectedDetail && (
        <div className="inspector">
          <div className="inspector-header">
            <div>
              <h3>Extraction Results: {selectedDetail.document.filename}</h3>
              <div className="meta-line">
                Project: {selectedDetail.document.project_id} · Stored at:{" "}
                {selectedDetail.document.storage_uri}
              </div>
            </div>
            <div className="status-strip">
              {selectedDetail.document.is_demo && (
                <span className="badge badge-ai">DEMO DATA</span>
              )}
              <span
                className={`badge ${statusBadgeClass(
                  selectedDetail.document.processing_status
                )}`}
              >
                {statusLabel(selectedDetail.document.processing_status)}
              </span>
            </div>
          </div>

          {selectedDetail.document.status_message &&
            selectedDetail.document.processing_status !== "extracted" && (
              <div className="warning-banner">
                <strong>Notice:</strong>{" "}
                {selectedDetail.document.status_message}
              </div>
            )}

          {selectedDetail.contract_extraction && (
            <div className="page-list">
              {selectedDetail.contract_extraction.warnings.map(
                (warning, idx) => (
                  <div key={idx} className="warning-banner">
                    {warning}
                  </div>
                )
              )}
              {selectedDetail.contract_extraction.pages.map((page) => (
                <div key={page.page_number} className="page-card">
                  <div className="page-card-head">
                    <div className="status-strip">
                      <span className="ref-pill">
                        {page.source_reference.location}
                      </span>
                      <span
                        className={`badge ${
                          page.is_readable ? "badge-ok" : "badge-err"
                        }`}
                      >
                        {page.is_readable
                          ? "Text extracted"
                          : "No extractable text"}
                      </span>
                    </div>
                    <span className="meta-line">
                      {page.character_count} chars
                    </span>
                  </div>
                  {page.is_readable ? (
                    <pre className="page-text">{page.text}</pre>
                  ) : (
                    <div className="empty-state">
                      No extractable text on {page.source_reference.location} (scanned or blank page).
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {selectedDetail.boq_extraction && (
            <div>
              {selectedDetail.boq_extraction.sheets.map((sheet) => (
                <div key={sheet.sheet_name} className="sheet-block">
                  <div className="page-card-head">
                    <strong>Sheet: {sheet.sheet_name}</strong>
                    <span className="badge badge-phase">
                      {sheet.rows.length} extracted row(s)
                    </span>
                  </div>

                  <div className="sheet-meta">
                    <span>
                      Header row: {sheet.header_row_number ?? "Not detected"}
                    </span>
                    <span>Blank rows skipped: {sheet.blank_rows_skipped}</span>
                    {sheet.merged_ranges.length > 0 && (
                      <span>
                        Merged ranges: {sheet.merged_ranges.join(", ")}
                      </span>
                    )}
                  </div>

                  {sheet.warnings.map((warning, idx) => (
                    <div key={idx} className="warning-banner">
                      {warning}
                    </div>
                  ))}

                  {sheet.rows.length === 0 ? (
                    <div className="empty-state">
                      No extractable BOQ rows in sheet &apos;{sheet.sheet_name}
                      &apos;.
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table className="boq-table">
                        <thead>
                          <tr>
                            <th>Source Reference</th>
                            <th>Item</th>
                            <th>Description</th>
                            <th>Unit</th>
                            <th className="num-cell">Qty</th>
                            <th className="num-cell">Rate</th>
                            <th className="num-cell">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.rows.map((row) => (
                            <tr key={row.row_number}>
                              <td>
                                <span className="ref-pill">
                                  {row.source_reference.location}
                                </span>
                              </td>
                              <td>{renderNullableCell(row.item_code)}</td>
                              <td>
                                {row.description
                                  ? row.description
                                  : sheet.header_row_number === null
                                    ? row.source_reference.excerpt
                                    : renderNullableCell(null)}
                              </td>
                              <td>{renderNullableCell(row.unit)}</td>
                              <td className="num-cell">
                                {renderNullableCell(row.quantity)}
                              </td>
                              <td className="num-cell">
                                {renderNullableCell(row.rate)}
                              </td>
                              <td className="num-cell">
                                {renderNullableCell(row.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
