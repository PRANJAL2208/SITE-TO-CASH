import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import { SAMPLE_INSTRUCTION_TEMPLATES } from "../../../demo/demoSeed";
import type { DemoInstructionChannel } from "../../../demo/demoTypes";

const CHANNELS: Array<{ id: DemoInstructionChannel; label: string }> = [
  { id: "whatsapp", label: "WhatsApp Export" },
  { id: "email", label: "Email" },
  { id: "meeting_minutes", label: "Meeting Minutes" },
  { id: "voice_transcript", label: "Voice Transcript" },
  { id: "site_note", label: "Site Engineer Note" },
  { id: "photo", label: "Photo / Drawing Markup" },
];

export default function InstructionInbox() {
  const {
    state,
    selectInstruction,
    submitDemoInstruction,
    runDemoAiAnalysis,
    setContractorPage,
  } = useDemo();

  const projInstructions = state.instructions.filter(
    (i) => i.projectId === state.selectedProjectId
  );
  const selected =
    projInstructions.find((i) => i.id === state.selectedInstructionId) ??
    projInstructions[0] ??
    null;

  const [channel, setChannel] = useState<DemoInstructionChannel>("whatsapp");
  const [senderName, setSenderName] = useState("Vikram Malhotra");
  const [senderRole, setSenderRole] = useState("Client PM (Skyline Developers)");
  const [subjectOrThread, setSubjectOrThread] = useState(
    "2F Revised Ceiling Layout — HVAC Duct Relocation"
  );
  const [originalText, setOriginalText] = useState(
    SAMPLE_INSTRUCTION_TEMPLATES[0].text
  );
  const [attachmentNames, setAttachmentNames] = useState<string[]>(
    SAMPLE_INSTRUCTION_TEMPLATES[0].attachmentNames
  );
  const [analyzing, setAnalyzing] = useState(false);

  const loadTemplate = (tmplId: string) => {
    const found = SAMPLE_INSTRUCTION_TEMPLATES.find((t) => t.id === tmplId);
    if (!found) return;
    setChannel(found.channel);
    setSenderName(found.senderName);
    setSenderRole(found.senderRole);
    setSubjectOrThread(found.subjectOrThread);
    setOriginalText(found.text);
    setAttachmentNames(found.attachmentNames);
  };

  const handleCaptureInstruction = () => {
    if (!originalText.trim()) return;
    setAnalyzing(true);
    const created = submitDemoInstruction({
      projectId: state.selectedProjectId,
      channel,
      senderName: senderName.trim() || "Unknown Sender",
      senderRole: senderRole.trim() || "Site Representative",
      subjectOrThread: subjectOrThread.trim() || "Site Instruction Capture",
      originalText: originalText.trim(),
      attachmentNames,
    });
    window.setTimeout(() => {
      runDemoAiAnalysis(created.instructionId);
      setAnalyzing(false);
      setContractorPage("ai_intelligence");
    }, 550);
  };

  const handleAnalyzeExisting = (instructionId: string) => {
    setAnalyzing(true);
    window.setTimeout(() => {
      runDemoAiAnalysis(instructionId);
      setAnalyzing(false);
      setContractorPage("ai_intelligence");
    }, 450);
  };

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">Contractor View / Site Instruction Inbox</div>
          <h1>Multi-Channel Site Instruction Inbox</h1>
          <p className="muted-note">
            Capture informal instructions from WhatsApp, email, meeting minutes,
            voice transcripts, and site photos — always preserving the verbatim
            original record separately from AI extraction.
          </p>
        </div>
        <span className="badge badge-ai">DEMO MODE — Simulated Channel Capture</span>
      </div>

      <div className="saas-two-col">
        {/* Left: Inbox Stream & Verbatim Viewer */}
        <div className="saas-col">
          <div className="saas-card">
            <div className="panel-header">
              <h3>Incoming Instructions ({projInstructions.length})</h3>
            </div>
            <ul className="data-list">
              {projInstructions.map((ins) => (
                <li
                  key={ins.id}
                  className={`data-row ${selected?.id === ins.id ? "selected" : ""}`}
                >
                  <div>
                    <strong>{ins.id}: {ins.subjectOrThread}</strong>
                    <div className="meta-line">
                      <span className="badge badge-phase">
                        {ins.channel.replace(/_/g, " ").toUpperCase()}
                      </span>{" "}
                      From {ins.senderName} ({ins.receivedAt})
                    </div>
                    <div className="muted-note">&ldquo;{ins.originalText}&rdquo;</div>
                  </div>
                  <div className="edit-row">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => selectInstruction(ins.id)}
                    >
                      {selected?.id === ins.id ? "Inspecting" : "View Original"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        selectInstruction(ins.id);
                        setContractorPage("ai_intelligence");
                      }}
                    >
                      Open AI Analysis
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <div className="saas-card card-qs">
              <div className="panel-header">
                <h3>Original Captured Instruction (Immutable)</h3>
                <span className="badge badge-phase">{selected.id}</span>
              </div>
              <dl className="kv-list">
                <div>
                  <dt>Channel</dt>
                  <dd>{selected.channel.replace(/_/g, " ").toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Sender &amp; Role</dt>
                  <dd>
                    {selected.senderName} ({selected.senderRole})
                  </dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{selected.receivedAt}</dd>
                </div>
                <div>
                  <dt>Attachments</dt>
                  <dd>
                    {selected.attachmentNames.length > 0
                      ? selected.attachmentNames.join(", ")
                      : "None attached"}
                  </dd>
                </div>
              </dl>
              <div className="sub-section">
                <strong>Verbatim Original Text (Separated from AI Extraction):</strong>
                <pre className="page-text">{selected.originalText}</pre>
              </div>
              <div className="edit-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={analyzing}
                  onClick={() => handleAnalyzeExisting(selected.id)}
                >
                  {analyzing
                    ? "Running AI Change Intelligence..."
                    : selected.aiAnalyzed
                      ? "Inspect / Re-run AI Change Intelligence"
                      : "Run AI Change Intelligence (Demo)"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Capture / Upload Sample Instruction */}
        <div className="saas-col">
          <div className="saas-card">
            <h3>Capture New / Sample Site Instruction</h3>
            <p className="muted-note">
              For live backend Gemini extraction using real PDF/BOQ uploads, switch
              to <strong>Live Engine (Phases 1–7 API)</strong> in the sidebar.
            </p>

            <div className="sub-section">
              <label htmlFor="sample-template-select">
                <strong>Quick Load Demo Instruction Template</strong>
              </label>
              <select
                id="sample-template-select"
                className="status-select small-input"
                defaultValue={SAMPLE_INSTRUCTION_TEMPLATES[0].id}
                onChange={(e) => loadTemplate(e.target.value)}
              >
                {SAMPLE_INSTRUCTION_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group" style={{ marginTop: 12 }}>
              <label htmlFor="demo-channel-select">Instruction Channel</label>
              <select
                id="demo-channel-select"
                className="status-select small-input"
                value={channel}
                onChange={(e) => setChannel(e.target.value as DemoInstructionChannel)}
              >
                {CHANNELS.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="cost-settings-grid">
              <div className="field-group">
                <label htmlFor="demo-sender-name">Sender Name</label>
                <input
                  id="demo-sender-name"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="demo-sender-role">Sender Role / Authority</label>
                <input
                  id="demo-sender-role"
                  value={senderRole}
                  onChange={(e) => setSenderRole(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="demo-subject">Thread / Subject</label>
              <input
                id="demo-subject"
                value={subjectOrThread}
                onChange={(e) => setSubjectOrThread(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="demo-original-text">Original Site Instruction Text</label>
              <textarea
                id="demo-original-text"
                className="input-text"
                rows={4}
                value={originalText}
                onChange={(e) => setOriginalText(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="demo-attach-upload">
                Attach Site Photo / Audio / Document (Demo Filename Capture)
              </label>
              <input
                id="demo-attach-upload"
                type="file"
                className="file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && !attachmentNames.includes(file.name)) {
                    setAttachmentNames((prev) => [...prev, file.name]);
                  }
                }}
              />
              {attachmentNames.length > 0 && (
                <div className="meta-line">
                  Attached: {attachmentNames.join(", ")}
                </div>
              )}
            </div>

            <div className="edit-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!originalText.trim() || analyzing}
                onClick={handleCaptureInstruction}
              >
                {analyzing
                  ? "Extracting Event & Retrieving Clauses..."
                  : "Capture & Run AI Change Intelligence (Demo)"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
