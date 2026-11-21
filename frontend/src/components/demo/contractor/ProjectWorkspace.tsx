import { useState } from "react";
import { useDemo } from "../../../demo/DemoContext";
import { formatInr } from "../../../demo/demoSeed";

export default function ProjectWorkspace() {
  const {
    state,
    openVariation,
    selectInstruction,
    setContractorPage,
  } = useDemo();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const project =
    state.projects.find((p) => p.id === state.selectedProjectId) ?? state.projects[0];
  const docs = state.documents.filter((d) => d.projectId === project.id);
  const boqRows = state.boqRows.filter((b) => b.projectId === project.id);
  const instructions = state.instructions.filter((i) => i.projectId === project.id);
  const variations = state.variations.filter((v) => v.projectId === project.id);
  const milestones = state.milestones.filter((m) => m.projectId === project.id);

  const filteredVariations =
    statusFilter === "all"
      ? variations
      : variations.filter((v) => v.status === statusFilter);

  return (
    <div className="saas-page">
      <div className="saas-page-header">
        <div>
          <div className="breadcrumb">
            Contractor View / Projects / {project.name}
          </div>
          <h1>{project.name} — Commercial Workspace</h1>
          <p className="muted-note">
            {project.projectType} · {project.location} · Trade: {project.trade}
          </p>
        </div>
        <span className="badge badge-ok">{project.status}</span>
      </div>

      {/* Overview & Party Cards */}
      <div className="saas-three-col">
        <div className="saas-card">
          <h3>Project Overview</h3>
          <dl className="kv-list">
            <div>
              <dt>Project Code</dt>
              <dd>{project.code}</dd>
            </div>
            <div>
              <dt>Base Subcontract Value</dt>
              <dd>{formatInr(project.baseContractValue)}</dd>
            </div>
            <div>
              <dt>Overall Progress</dt>
              <dd>{project.overallProgressPercent}%</dd>
            </div>
            <div>
              <dt>Target Completion</dt>
              <dd>{project.targetCompletionDate}</dd>
            </div>
          </dl>
        </div>

        <div className="saas-card">
          <h3>Contractor &amp; Client Details</h3>
          <dl className="kv-list">
            <div>
              <dt>Subcontractor</dt>
              <dd>{project.contractor}</dd>
            </div>
            <div>
              <dt>Client Developer</dt>
              <dd>{project.client}</dd>
            </div>
            <div>
              <dt>Covered Trades</dt>
              <dd>{project.trade}</dd>
            </div>
            <div>
              <dt>Site Location</dt>
              <dd>{project.location}</dd>
            </div>
          </dl>
        </div>

        <div className="saas-card">
          <h3>Key Milestones Summary</h3>
          {milestones.length === 0 ? (
            <p className="muted-note">No milestones configured for this demo project.</p>
          ) : (
            <ul className="compact-list">
              {milestones.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong> ({m.targetDate}) —{" "}
                  <span className="badge badge-phase">{m.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Variation Register */}
      <div className="saas-card section-spacer">
        <div className="panel-header">
          <h3>Project Variation Register ({filteredVariations.length})</h3>
          <select
            aria-label="Filter project variations by status"
            className="status-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="qs_review">QS Review</option>
            <option value="ready_for_contractor_approval">Awaiting Approver</option>
            <option value="contractor_approved">Contractor Approved</option>
            <option value="submitted_to_client">Submitted to Client</option>
            <option value="client_approved">Client Approved</option>
            <option value="executed">Executed</option>
            <option value="billed">Billed</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="boq-table">
            <thead>
              <tr>
                <th>Variation ID</th>
                <th>Description</th>
                <th>Trade</th>
                <th>Status</th>
                <th className="num-cell">Proposed / Revised</th>
                <th className="num-cell">Approved</th>
                <th className="num-cell">Paid</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredVariations.map((v) => (
                <tr key={v.id}>
                  <td>
                    <span className="ref-pill">{v.id}</span>
                  </td>
                  <td>
                    <strong>{v.title}</strong>
                    <div className="meta-line">{v.floorLocation}</div>
                  </td>
                  <td>{v.trade}</td>
                  <td>
                    <span className="badge badge-phase">
                      {v.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </td>
                  <td className="num-cell">
                    {formatInr(v.revisedAmount ?? v.proposedAmount, "Incomplete")}
                  </td>
                  <td className="num-cell">
                    {v.approvedAmount !== null ? (
                      <strong>{formatInr(v.approvedAmount)}</strong>
                    ) : (
                      <span className="null-cell">Not approved</span>
                    )}
                  </td>
                  <td className="num-cell">{formatInr(v.paidAmount, "—")}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openVariation(v.id, "contractor")}
                    >
                      Inspect Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Contract Docs & BOQ */}
      <div className="saas-two-col section-spacer">
        <div className="saas-card">
          <h3>Contract &amp; Drawing Repository ({docs.length})</h3>
          <ul className="data-list">
            {docs.map((doc) => (
              <li key={doc.id} className="data-row">
                <div>
                  <strong>{doc.title}</strong>
                  <div className="meta-line">
                    {doc.documentType} · {doc.pagesOrSheets} · Uploaded {doc.uploadedAt}
                  </div>
                  <div className="meta-line">{doc.keyClauseOrNote}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="saas-card">
          <h3>Project Contacts &amp; Approval Authority</h3>
          <ul className="data-list">
            {state.contacts.map((c) => (
              <li key={c.id} className="data-row">
                <div>
                  <strong>{c.name}</strong> — {c.role} ({c.organization})
                  <div className="meta-line">
                    {c.email} · {c.authorityNote}
                  </div>
                </div>
                <span
                  className={`badge ${c.party === "contractor" ? "badge-qs" : "badge-ok"}`}
                >
                  {c.party.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Extracted BOQ Rows & Recent Instructions */}
      <div className="saas-card section-spacer">
        <div className="panel-header">
          <h3>Extracted BOQ Schedule Excerpt (Nulls Preserved)</h3>
        </div>
        <div className="table-wrap">
          <table className="boq-table">
            <thead>
              <tr>
                <th>Sheet &amp; Row</th>
                <th>Code</th>
                <th>Description</th>
                <th>Unit</th>
                <th className="num-cell">Qty</th>
                <th className="num-cell">Rate</th>
                <th className="num-cell">Amount</th>
              </tr>
            </thead>
            <tbody>
              {boqRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="ref-pill">
                      {row.sheetName} · Row {row.rowNumber}
                    </span>
                  </td>
                  <td>{row.itemCode}</td>
                  <td>{row.description}</td>
                  <td>{row.unit ?? "—"}</td>
                  <td className="num-cell">{row.quantity ?? "—"}</td>
                  <td className="num-cell">{formatInr(row.rate, "NULL (Rate Only)")}</td>
                  <td className="num-cell">{formatInr(row.amount, "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="saas-card section-spacer">
        <div className="panel-header">
          <h3>Recent Site Instructions ({instructions.length})</h3>
          <button
            type="button"
            className="btn"
            onClick={() => setContractorPage("inbox")}
          >
            Go to Instruction Inbox
          </button>
        </div>
        <ul className="data-list">
          {instructions.map((ins) => (
            <li key={ins.id} className="data-row">
              <div>
                <strong>{ins.id}: {ins.subjectOrThread}</strong>
                <div className="meta-line">
                  {ins.channel.replace(/_/g, " ").toUpperCase()} · From {ins.senderName} ·{" "}
                  {ins.receivedAt}
                </div>
                <div className="muted-note">&ldquo;{ins.originalText}&rdquo;</div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  selectInstruction(ins.id);
                  setContractorPage("ai_intelligence");
                }}
              >
                Inspect AI Extraction
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
