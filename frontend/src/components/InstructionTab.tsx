import { useEffect, useRef, useState } from "react";
import { confirmCaseExtraction, submitSiteInstruction } from "../api/client";
import type {
  ChangeEventFields,
  ExtractedField,
  ExtractedQuantityMention,
  ExtractionFieldStatus,
  VariationCase,
} from "../types/domain";

interface InstructionTabProps {
  projectId: string;
  onProjectIdChange: (value: string) => void;
  cases: VariationCase[];
  selectedCase: VariationCase | null;
  onSelectCase: (caseId: string) => Promise<void>;
  onCaseCreated: (created: VariationCase) => void;
  onCaseUpdated: (updated: VariationCase) => void;
  geminiConfigured: boolean;
}

type SingleFieldKey =
  | "instruction_description"
  | "issuer_name"
  | "issuer_role"
  | "recipient"
  | "project_site_location"
  | "communication_date"
  | "requested_work"
  | "affected_activity";

const CORE_FIELD_LABELS: Array<{ key: SingleFieldKey; label: string }> = [
  { key: "instruction_description", label: "Instruction Description" },
  { key: "issuer_name", label: "Issuer Name" },
  { key: "issuer_role", label: "Issuer Role" },
  { key: "recipient", label: "Recipient" },
  { key: "project_site_location", label: "Project / Site / Location" },
  { key: "communication_date", label: "Communication Date" },
  { key: "requested_work", label: "Requested Work" },
  { key: "affected_activity", label: "Affected Activity" },
];

function statusPillClass(status: ExtractionFieldStatus): string {
  if (status === "extracted") return "badge-ok";
  if (status === "uncertain") return "badge-ai";
  return "badge-err";
}

function statusPillLabel(status: ExtractionFieldStatus): string {
  if (status === "extracted") return "Extracted";
  if (status === "uncertain") return "Uncertain";
  return "Missing";
}

function cloneFields(fields: ChangeEventFields): ChangeEventFields {
  return {
    instruction_description: { ...fields.instruction_description },
    issuer_name: { ...fields.issuer_name },
    issuer_role: { ...fields.issuer_role },
    recipient: { ...fields.recipient },
    project_site_location: { ...fields.project_site_location },
    communication_date: { ...fields.communication_date },
    requested_work: { ...fields.requested_work },
    affected_activity: { ...fields.affected_activity },
    mentioned_quantities: fields.mentioned_quantities.map((q) => ({ ...q })),
    mentioned_materials: fields.mentioned_materials.map((m) => ({ ...m })),
    mentioned_deadlines: fields.mentioned_deadlines.map((d) => ({ ...d })),
    scope_change_indicators: fields.scope_change_indicators.map((s) => ({
      ...s,
    })),
    missing_or_ambiguous_information: [
      ...fields.missing_or_ambiguous_information,
    ],
  };
}

function emptyFields(): ChangeEventFields {
  const blank = (): ExtractedField => ({
    value: null,
    status: "missing",
    note: null,
    evidence_quote: null,
  });
  return {
    instruction_description: blank(),
    issuer_name: blank(),
    issuer_role: blank(),
    recipient: blank(),
    project_site_location: blank(),
    communication_date: blank(),
    requested_work: blank(),
    affected_activity: blank(),
    mentioned_quantities: [],
    mentioned_materials: [],
    mentioned_deadlines: [],
    scope_change_indicators: [],
    missing_or_ambiguous_information: [],
  };
}

function fieldsListToLines(items: ExtractedField[]): string {
  return items
    .map((item) => item.value ?? "")
    .filter((v) => v.trim().length > 0)
    .join("\n");
}

function linesToFieldList(text: string): ExtractedField[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      value: line,
      status: "extracted" as const,
      note: null,
      evidence_quote: null,
    }));
}

export default function InstructionTab({
  projectId,
  onProjectIdChange,
  cases,
  selectedCase,
  onSelectCase,
  onCaseCreated,
  onCaseUpdated,
  geminiConfigured,
}: InstructionTabProps) {
  const [instructionText, setInstructionText] = useState<string>("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isDemo, setIsDemo] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitMessage, setSubmitMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Editable human review draft state
  const [draftFields, setDraftFields] =
    useState<ChangeEventFields>(emptyFields);
  const [materialsText, setMaterialsText] = useState<string>("");
  const [deadlinesText, setDeadlinesText] = useState<string>("");
  const [scopeIndicatorsText, setScopeIndicatorsText] = useState<string>("");
  const [missingInfoText, setMissingInfoText] = useState<string>("");
  const [confirmedBy, setConfirmedBy] = useState<string>("");
  const [reviewerNotes, setReviewerNotes] = useState<string>("");
  const [savingReview, setSavingReview] = useState<boolean>(false);
  const [reviewMessage, setReviewMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setReviewMessage(null);
    if (!selectedCase) {
      setDraftFields(emptyFields());
      setMaterialsText("");
      setDeadlinesText("");
      setScopeIndicatorsText("");
      setMissingInfoText("");
      setConfirmedBy("");
      setReviewerNotes("");
      return;
    }

    const baseFields =
      selectedCase.confirmed_extraction?.fields ??
      selectedCase.ai_extraction?.fields ??
      emptyFields();
    const cloned = cloneFields(baseFields);
    setDraftFields(cloned);
    setMaterialsText(fieldsListToLines(cloned.mentioned_materials));
    setDeadlinesText(fieldsListToLines(cloned.mentioned_deadlines));
    setScopeIndicatorsText(fieldsListToLines(cloned.scope_change_indicators));
    setMissingInfoText(cloned.missing_or_ambiguous_information.join("\n"));
    setConfirmedBy(selectedCase.confirmed_extraction?.confirmed_by ?? "");
    setReviewerNotes(selectedCase.confirmed_extraction?.reviewer_notes ?? "");
  }, [selectedCase?.id, selectedCase?.updated_at]);

  const handleSubmit = async () => {
    if (!instructionText.trim() && !attachment) return;
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      const created = await submitSiteInstruction({
        projectId: projectId.trim() || "default-project",
        instructionText,
        isDemo,
        attachment,
      });
      onCaseCreated(created);
      setInstructionText("");
      setAttachment(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSubmitMessage({
        kind: "success",
        text: `Extracted site-change event '${created.id}'. Review and confirm below before downstream use.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Instruction extraction failed.";
      setSubmitMessage({ kind: "error", text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const updateCoreField = (
    key: SingleFieldKey,
    patch: Partial<ExtractedField>
  ) => {
    setDraftFields((prev) => {
      const current = prev[key];
      const next: ExtractedField = { ...current, ...patch };
      if (patch.status === "missing") {
        next.value = null;
      } else if (
        patch.value !== undefined &&
        patch.value !== null &&
        patch.value.trim().length > 0 &&
        next.status === "missing"
      ) {
        next.status = "extracted";
      }
      return { ...prev, [key]: next };
    });
  };

  const updateQuantityRow = (
    idx: number,
    patch: Partial<ExtractedQuantityMention>
  ) => {
    setDraftFields((prev) => ({
      ...prev,
      mentioned_quantities: prev.mentioned_quantities.map((row, i) =>
        i === idx ? { ...row, ...patch } : row
      ),
    }));
  };

  const addQuantityRow = () => {
    setDraftFields((prev) => ({
      ...prev,
      mentioned_quantities: [
        ...prev.mentioned_quantities,
        {
          item_or_material: "",
          quantity: "",
          unit: "",
          status: "extracted",
          note: null,
          evidence_quote: null,
        },
      ],
    }));
  };

  const removeQuantityRow = (idx: number) => {
    setDraftFields((prev) => ({
      ...prev,
      mentioned_quantities: prev.mentioned_quantities.filter(
        (_, i) => i !== idx
      ),
    }));
  };

  const handleSaveReview = async (confirm: boolean) => {
    if (!selectedCase) return;
    setSavingReview(true);
    setReviewMessage(null);
    try {
      const normalizedFields: ChangeEventFields = {
        ...draftFields,
        mentioned_materials: linesToFieldList(materialsText),
        mentioned_deadlines: linesToFieldList(deadlinesText),
        scope_change_indicators: linesToFieldList(scopeIndicatorsText),
        missing_or_ambiguous_information: missingInfoText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
      };

      const updated = await confirmCaseExtraction(selectedCase.id, {
        fields: normalizedFields,
        confirmed_by: confirmedBy.trim() || null,
        reviewer_notes: reviewerNotes.trim() || null,
        confirm,
      });
      onCaseUpdated(updated);
      setReviewMessage({
        kind: "success",
        text: confirm
          ? `Confirmed by ${updated.confirmed_extraction?.confirmed_by ?? "QS"}. Original input and AI suggestion remain preserved.`
          : "Draft edits saved (pending confirmation).",
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save extraction review.";
      setReviewMessage({ kind: "error", text: msg });
    } finally {
      setSavingReview(false);
    }
  };

  return (
    <section>
      <div className="panel-header">
        <h2>Site Instruction Intake &amp; Gemini Extraction</h2>
        <span className="badge badge-ok">Phase 3 Active</span>
      </div>

      {!geminiConfigured && (
        <div className="warning-banner">
          <strong>Gemini API Key Not Configured:</strong> Set{" "}
          <code>GEMINI_API_KEY</code> in the backend environment (`.env`) to run
          live extraction. Existing saved events can still be inspected and
          confirmed below.
        </div>
      )}

      <div className="scope-bar">
        <div className="field-group">
          <label htmlFor="instr-project-id">Project ID</label>
          <input
            id="instr-project-id"
            className="input-text"
            type="text"
            value={projectId}
            onChange={(e) => onProjectIdChange(e.target.value)}
            placeholder="e.g. default-project"
          />
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isDemo}
            onChange={(e) => setIsDemo(e.target.checked)}
          />
          <span>Label instruction as DEMO DATA</span>
        </label>
      </div>

      <div className="card">
        <h3>
          Submit Informal Site Instruction
          <span className="badge badge-ai">AI Extraction</span>
        </h3>
        <p className="muted">
          Paste site emails, WhatsApp messages, or verbal instruction notes
          (mandatory), with an optional site photo or voice recording. Gemini
          extracts structured facts without inventing missing details or making
          contractual/cost decisions.
        </p>

        <div className="field-group">
          <label htmlFor="instruction-text-input">
            Site Instruction Text (Required unless attaching image/audio below)
          </label>
          <textarea
            id="instruction-text-input"
            className="input-text"
            rows={4}
            value={instructionText}
            onChange={(e) => setInstructionText(e.target.value)}
            placeholder="Example: WhatsApp from Mike (Site PM) 18 Nov: Please add 12m of 100mm chilled water pipe on Level 3 East Corridor before Friday. Formal VO to follow."
          />
        </div>

        <div className="field-group">
          <label htmlFor="instruction-attachment-input">
            Optional Audio or Image Attachment (.mp3, .wav, .m4a, .png, .jpg)
          </label>
          <input
            ref={fileInputRef}
            id="instruction-attachment-input"
            className="file-input"
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,.webm,.png,.jpg,.jpeg,.webp,audio/*,image/*"
            onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="inline-controls">
          <button
            type="button"
            className="btn btn-primary"
            disabled={(!instructionText.trim() && !attachment) || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? "Extracting with Gemini..."
              : "Extract Site-Change Event"}
          </button>
        </div>

        {submitMessage && (
          <div
            className={
              submitMessage.kind === "error" ? "error-banner" : "success-banner"
            }
            role="status"
          >
            {submitMessage.text}
          </div>
        )}
      </div>

      <div className="section-spacer">
        <h3>Saved Site-Change Events ({cases.length})</h3>
        {cases.length === 0 ? (
          <div className="empty-state">
            No site-change events extracted yet. Submit an instruction above to
            create the first event.
          </div>
        ) : (
          <ul className="data-list">
            {cases.map((item) => {
              const isSelected = selectedCase?.id === item.id;
              const isConfirmed =
                item.confirmed_extraction?.confirmation_status === "confirmed";

              return (
                <li
                  key={item.id}
                  className={`data-row ${isSelected ? "selected" : ""}`}
                >
                  <div>
                    <strong>{item.title}</strong>{" "}
                    <span className="badge badge-phase">
                      Project: {item.project_id}
                    </span>
                    {item.original_input && (
                      <div className="meta-line">
                        Source: {item.original_input.source_type} · Submitted:{" "}
                        {new Date(
                          item.original_input.submitted_at
                        ).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="status-strip">
                    {item.is_demo && (
                      <span className="badge badge-ai">DEMO DATA</span>
                    )}
                    <span
                      className={`badge ${
                        isConfirmed ? "badge-qs" : "badge-ai"
                      }`}
                    >
                      {isConfirmed
                        ? "Human Confirmed"
                        : "AI Suggestion — Pending Confirmation"}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void onSelectCase(item.id)}
                    >
                      {isSelected ? "Open" : "Review"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedCase && (
        <div className="inspector">
          <div className="inspector-header">
            <div>
              <h3>Event Review: {selectedCase.title}</h3>
              <div className="meta-line">
                Case ID: {selectedCase.id} · Project: {selectedCase.project_id}
              </div>
            </div>
            <div className="status-strip">
              {selectedCase.is_demo && (
                <span className="badge badge-ai">DEMO DATA</span>
              )}
              <span
                className={`badge ${
                  selectedCase.confirmed_extraction?.confirmation_status ===
                  "confirmed"
                    ? "badge-qs"
                    : "badge-ai"
                }`}
              >
                {selectedCase.confirmed_extraction?.confirmation_status ===
                "confirmed"
                  ? `Confirmed by ${selectedCase.confirmed_extraction.confirmed_by}`
                  : "Pending Human Confirmation"}
              </span>
            </div>
          </div>

          {/* 1. Original Input Preserved Unchanged */}
          <div className="card">
            <h3>
              Original Instruction Input (Preserved Unchanged)
              <span className="badge badge-phase">
                {selectedCase.original_input?.source_type ?? "text"}
              </span>
            </h3>
            {selectedCase.original_input?.submitted_at && (
              <div className="meta-line">
                Submitted:{" "}
                {new Date(
                  selectedCase.original_input.submitted_at
                ).toLocaleString()}
              </div>
            )}
            <pre className="page-text">
              {selectedCase.original_input?.raw_text ??
                selectedCase.instruction_text ??
                "[No text input]"}
            </pre>
            {selectedCase.original_input?.attachment_filename && (
              <div className="meta-line">
                Attachment: {selectedCase.original_input.attachment_filename} (
                {selectedCase.original_input.attachment_mime_type}) · Stored:{" "}
                {selectedCase.original_input.attachment_storage_uri}
              </div>
            )}
          </div>

          <div className="two-col-stack">
            {/* 2. AI Suggestion Card */}
            <div className="card card-ai">
              <h3>
                AI Extraction Suggestion
                <span className="badge badge-ai">origin: ai_suggestion</span>
              </h3>
              {selectedCase.ai_extraction ? (
                <>
                  <div className="warning-banner">
                    {selectedCase.ai_extraction.disclaimer}
                  </div>
                  <div className="meta-line">
                    Model: {selectedCase.ai_extraction.model_name} · Extracted:{" "}
                    {new Date(
                      selectedCase.ai_extraction.extracted_at
                    ).toLocaleString()}
                  </div>

                  <div className="extraction-grid">
                    {CORE_FIELD_LABELS.map(({ key, label }) => {
                      const field = selectedCase.ai_extraction!.fields[key];
                      return (
                        <div key={key} className="field-card">
                          <div className="page-card-head">
                            <strong>{label}</strong>
                            <span
                              className={`badge ${statusPillClass(
                                field.status
                              )}`}
                            >
                              {statusPillLabel(field.status)}
                            </span>
                          </div>
                          <div>
                            {field.value ?? (
                              <span className="null-cell">— Not stated</span>
                            )}
                          </div>
                          {field.note && (
                            <div className="meta-line">Note: {field.note}</div>
                          )}
                          {field.evidence_quote && (
                            <div className="evidence-quote">
                              &ldquo;{field.evidence_quote}&rdquo;
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="sub-section">
                    <strong>Quantities &amp; Units Mentioned</strong>
                    {selectedCase.ai_extraction.fields.mentioned_quantities
                      .length === 0 ? (
                      <div className="meta-line">
                        None explicitly stated in instruction.
                      </div>
                    ) : (
                      <ul className="compact-list">
                        {selectedCase.ai_extraction.fields.mentioned_quantities.map(
                          (q, idx) => (
                            <li key={idx}>
                              <span
                                className={`badge ${statusPillClass(q.status)}`}
                              >
                                {statusPillLabel(q.status)}
                              </span>{" "}
                              {q.item_or_material ?? "Item"} — Qty:{" "}
                              {q.quantity ?? "—"} {q.unit ?? ""}{" "}
                              {q.note ? `(${q.note})` : ""}
                            </li>
                          )
                        )}
                      </ul>
                    )}
                  </div>

                  <div className="sub-section">
                    <strong>Materials Mentioned:</strong>{" "}
                    {selectedCase.ai_extraction.fields.mentioned_materials
                      .length === 0
                      ? "None stated"
                      : selectedCase.ai_extraction.fields.mentioned_materials
                          .map((m) => m.value)
                          .filter(Boolean)
                          .join(", ")}
                  </div>

                  <div className="sub-section">
                    <strong>Mentioned Deadlines:</strong>{" "}
                    {selectedCase.ai_extraction.fields.mentioned_deadlines
                      .length === 0
                      ? "None stated"
                      : selectedCase.ai_extraction.fields.mentioned_deadlines
                          .map((d) => `${d.value} (${d.status})`)
                          .join("; ")}
                  </div>

                  <div className="sub-section">
                    <strong>Potential Scope-Change Indicators:</strong>
                    {selectedCase.ai_extraction.fields.scope_change_indicators
                      .length === 0 ? (
                      <div className="meta-line">None detected.</div>
                    ) : (
                      <ul className="compact-list">
                        {selectedCase.ai_extraction.fields.scope_change_indicators.map(
                          (s, idx) => (
                            <li key={idx}>
                              {s.value}{" "}
                              <span
                                className={`badge ${statusPillClass(s.status)}`}
                              >
                                {statusPillLabel(s.status)}
                              </span>
                            </li>
                          )
                        )}
                      </ul>
                    )}
                  </div>

                  <div className="warning-banner">
                    <strong>Missing or Ambiguous Information</strong>
                    {selectedCase.ai_extraction.fields
                      .missing_or_ambiguous_information.length === 0 ? (
                      <div>None reported.</div>
                    ) : (
                      <ul className="compact-list">
                        {selectedCase.ai_extraction.fields.missing_or_ambiguous_information.map(
                          (gap, idx) => (
                            <li key={idx}>{gap}</li>
                          )
                        )}
                      </ul>
                    )}
                  </div>

                  <div className="sub-section">
                    <strong>Supporting Evidence / Source References</strong>
                    <ul className="compact-list">
                      {selectedCase.ai_extraction.evidence_references.map(
                        (ref, idx) => (
                          <li key={idx}>
                            <span className="ref-pill">{ref.location}</span>{" "}
                            &ldquo;{ref.excerpt}&rdquo;
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  No AI extraction attached to this case.
                </div>
              )}
            </div>

            {/* 3. QS / User Edit & Confirmation Card */}
            <div className="card card-qs">
              <h3>
                QS / User Review &amp; Confirmation
                <span className="badge badge-qs">origin: human_confirmed</span>
              </h3>
              <p className="muted">
                Edit any AI-suggested fields, resolve uncertainties, or confirm
                what is missing. Saving updates the human-confirmed event while
                preserving the original instruction and AI suggestion unchanged.
              </p>

              <div className="extraction-grid">
                {CORE_FIELD_LABELS.map(({ key, label }) => {
                  const field = draftFields[key];
                  return (
                    <div key={key} className="field-card">
                      <div className="page-card-head">
                        <label htmlFor={`edit-${key}`}>
                          <strong>{label}</strong>
                        </label>
                        <select
                          aria-label={`${label} status`}
                          className="status-select"
                          value={field.status}
                          onChange={(e) =>
                            updateCoreField(key, {
                              status: e.target.value as ExtractionFieldStatus,
                            })
                          }
                        >
                          <option value="extracted">Extracted</option>
                          <option value="uncertain">Uncertain</option>
                          <option value="missing">Missing</option>
                        </select>
                      </div>
                      <input
                        id={`edit-${key}`}
                        className="input-text small-input"
                        type="text"
                        disabled={field.status === "missing"}
                        value={field.value ?? ""}
                        placeholder={
                          field.status === "missing"
                            ? "Marked missing (null)"
                            : "Enter verified value..."
                        }
                        onChange={(e) =>
                          updateCoreField(key, { value: e.target.value })
                        }
                      />
                    </div>
                  );
                })}
              </div>

              <div className="sub-section">
                <div className="page-card-head">
                  <strong>Confirmed Quantities &amp; Units</strong>
                  <button
                    type="button"
                    className="btn"
                    onClick={addQuantityRow}
                  >
                    + Add Row
                  </button>
                </div>
                {draftFields.mentioned_quantities.map((row, idx) => (
                  <div key={idx} className="edit-row">
                    <input
                      className="input-text small-input"
                      placeholder="Item / Material"
                      value={row.item_or_material ?? ""}
                      onChange={(e) =>
                        updateQuantityRow(idx, {
                          item_or_material: e.target.value,
                        })
                      }
                    />
                    <input
                      className="input-text small-input qty-input"
                      placeholder="Qty"
                      value={row.quantity ?? ""}
                      onChange={(e) =>
                        updateQuantityRow(idx, { quantity: e.target.value })
                      }
                    />
                    <input
                      className="input-text small-input qty-input"
                      placeholder="Unit"
                      value={row.unit ?? ""}
                      onChange={(e) =>
                        updateQuantityRow(idx, { unit: e.target.value })
                      }
                    />
                    <select
                      className="status-select"
                      value={row.status}
                      onChange={(e) =>
                        updateQuantityRow(idx, {
                          status: e.target.value as ExtractionFieldStatus,
                        })
                      }
                    >
                      <option value="extracted">Extracted</option>
                      <option value="uncertain">Uncertain</option>
                      <option value="missing">Missing</option>
                    </select>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => removeQuantityRow(idx)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="field-group">
                <label htmlFor="edit-materials">
                  Materials Mentioned (one per line)
                </label>
                <textarea
                  id="edit-materials"
                  className="input-text"
                  rows={2}
                  value={materialsText}
                  onChange={(e) => setMaterialsText(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="edit-deadlines">
                  Mentioned Deadlines (one per line)
                </label>
                <textarea
                  id="edit-deadlines"
                  className="input-text"
                  rows={2}
                  value={deadlinesText}
                  onChange={(e) => setDeadlinesText(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="edit-scope-indicators">
                  Potential Scope-Change Indicators (one per line)
                </label>
                <textarea
                  id="edit-scope-indicators"
                  className="input-text"
                  rows={2}
                  value={scopeIndicatorsText}
                  onChange={(e) => setScopeIndicatorsText(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="edit-missing-info">
                  Missing or Ambiguous Information (one per line)
                </label>
                <textarea
                  id="edit-missing-info"
                  className="input-text"
                  rows={2}
                  value={missingInfoText}
                  onChange={(e) => setMissingInfoText(e.target.value)}
                />
              </div>

              <div className="grid-two">
                <div className="field-group">
                  <label htmlFor="confirmed-by-input">
                    Confirmed By (QS / Reviewer Name)
                  </label>
                  <input
                    id="confirmed-by-input"
                    className="input-text"
                    type="text"
                    value={confirmedBy}
                    onChange={(e) => setConfirmedBy(e.target.value)}
                    placeholder="e.g. A. Patel (QS)"
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="reviewer-notes-input">Reviewer Notes</label>
                  <input
                    id="reviewer-notes-input"
                    className="input-text"
                    type="text"
                    value={reviewerNotes}
                    onChange={(e) => setReviewerNotes(e.target.value)}
                    placeholder="Optional site log / clarification note"
                  />
                </div>
              </div>

              <div className="inline-controls">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!confirmedBy.trim() || savingReview}
                  onClick={() => void handleSaveReview(true)}
                >
                  {savingReview ? "Saving..." : "Save & Confirm Extraction"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={savingReview}
                  onClick={() => void handleSaveReview(false)}
                >
                  Save Draft Edits
                </button>
              </div>

              {reviewMessage && (
                <div
                  className={
                    reviewMessage.kind === "error"
                      ? "error-banner"
                      : "success-banner"
                  }
                  role="status"
                >
                  {reviewMessage.text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
