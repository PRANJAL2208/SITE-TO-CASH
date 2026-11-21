import type { DemoEvidenceItem } from "../../../demo/demoTypes";

function PreviewGraphic({ kind }: { kind: DemoEvidenceItem["kind"] }) {
  if (kind === "ceiling_markup") {
    return (
      <svg viewBox="0 0 320 150" className="evidence-svg" aria-label="Revised ceiling soffit markup diagram">
        <rect x="0" y="0" width="320" height="150" fill="#f8fafc" />
        <line x1="20" y1="30" x2="300" y2="30" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth="1.5" />
        <text x="24" y="23" fontSize="9" fill="#64748b">Existing Slab Soffit (+3,820mm)</text>
        <rect x="35" y="42" width="110" height="24" fill="#cbd5e1" stroke="#475569" strokeWidth="1.5" />
        <text x="43" y="57" fontSize="9" fill="#1e293b">Old Duct +3,450mm</text>
        <line x1="20" y1="88" x2="300" y2="88" stroke="#dc2626" strokeWidth="2" />
        <text x="24" y="82" fontSize="9" fontWeight="bold" fill="#b91c1c">
          RCP Rev C New Ceiling (-280mm clash)
        </text>
        <path d="M145 54 L175 54 L195 104 L285 104" fill="none" stroke="#0f766e" strokeWidth="12" strokeLinejoin="round" opacity="0.28" />
        <rect x="195" y="96" width="90" height="22" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1.5" />
        <text x="200" y="110" fontSize="9" fontWeight="bold" fill="#115e59">Relocated Offset</text>
      </svg>
    );
  }
  if (kind === "site_photo") {
    return (
      <svg viewBox="0 0 320 150" className="evidence-svg" aria-label="Site installation photograph preview">
        <rect x="0" y="0" width="320" height="150" fill="#1e293b" />
        <rect x="16" y="20" width="288" height="18" fill="#475569" />
        <rect x="40" y="48" width="240" height="36" rx="2" fill="#94a3b8" stroke="#e2e8f0" strokeWidth="1.5" />
        <line x1="80" y1="20" x2="80" y2="48" stroke="#cbd5e1" strokeWidth="2" />
        <line x1="160" y1="20" x2="160" y2="48" stroke="#cbd5e1" strokeWidth="2" />
        <line x1="240" y1="20" x2="240" y2="48" stroke="#cbd5e1" strokeWidth="2" />
        <rect x="118" y="92" width="64" height="26" fill="#0284c7" stroke="#bae6fd" strokeWidth="1.5" />
        <text x="126" y="109" fontSize="9" fill="#ffffff" fontWeight="bold">VAV Box #4</text>
        <text x="18" y="138" fontSize="9" fill="#94a3b8">Site Photo Evidence (Demo Illustration — Second Floor Corridor)</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 150" className="evidence-svg" aria-label="Captured communication preview">
      <rect x="0" y="0" width="320" height="150" fill="#f1f5f9" />
      <rect x="16" y="14" width="288" height="24" rx="4" fill="#0f172a" />
      <text x="26" y="30" fontSize="10" fontWeight="bold" fill="#f8fafc">Skyline 2F MEP Coordination Thread</text>
      <rect x="22" y="48" width="268" height="72" rx="6" fill="#ffffff" stroke="#cbd5e1" />
      <text x="32" y="66" fontSize="9.5" fontWeight="bold" fill="#0f766e">Vikram Malhotra (Client PM):</text>
      <text x="32" y="82" fontSize="9" fill="#1e293b">&quot;Please relocate the HVAC ducting on the second</text>
      <text x="32" y="95" fontSize="9" fill="#1e293b">floor due to the revised ceiling layout. Coordinate</text>
      <text x="32" y="108" fontSize="9" fill="#1e293b">with the site team and proceed.&quot;</text>
      <text x="22" y="137" fontSize="8.5" fill="#64748b">Captured as immutable source snapshot (Demo)</text>
    </svg>
  );
}

export default function EvidencePreviewCard({ item }: { item: DemoEvidenceItem }) {
  return (
    <div className="evidence-card">
      <PreviewGraphic kind={item.kind} />
      <div className="evidence-body">
        <div className="evidence-title">{item.title}</div>
        <p className="muted-note">{item.caption}</p>
        <div className="meta-line">
          <span className="ref-pill">{item.sourceRef}</span> · {item.location}
        </div>
        <div className="meta-line">
          Captured by {item.capturedBy} · {item.capturedAt}
        </div>
      </div>
    </div>
  );
}
