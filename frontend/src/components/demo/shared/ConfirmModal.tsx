import { useEffect, useState } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "primary" | "danger" | "warning";
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  initialReason?: string;
  showAmountInput?: boolean;
  amountLabel?: string;
  initialAmount?: string;
  disclaimerNote?: string;
  onCancel: () => void;
  onConfirm: (payload: { reason: string; amount: number | null }) => void;
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  confirmTone = "primary",
  requireReason = false,
  reasonLabel = "Commercial Notes / Written Reason",
  reasonPlaceholder = "Enter written justification or instruction note...",
  initialReason = "",
  showAmountInput = false,
  amountLabel = "Approved Amount (INR)",
  initialAmount = "",
  disclaimerNote,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const [reason, setReason] = useState(initialReason);
  const [amountStr, setAmountStr] = useState(initialAmount);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(initialReason);
      setAmountStr(initialAmount);
      setError(null);
    }
  }, [open, initialReason, initialAmount]);

  if (!open) return null;

  const handleSubmit = () => {
    if (requireReason && !reason.trim()) {
      setError("A written reason is required before confirming this decision.");
      return;
    }
    let parsedAmount: number | null = null;
    if (showAmountInput) {
      const cleaned = amountStr.replace(/,/g, "").trim();
      const num = Number(cleaned);
      if (!cleaned || Number.isNaN(num) || num <= 0) {
        setError("Enter a valid positive amount.");
        return;
      }
      parsedAmount = Math.round(num * 100) / 100;
    }
    onConfirm({ reason: reason.trim(), amount: parsedAmount });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="confirm-modal-title">{title}</h3>
          <button
            type="button"
            className="btn-icon"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
          >
            ✕
          </button>
        </div>

        <p className="modal-desc">{description}</p>

        {disclaimerNote && (
          <div className="demo-inline-alert">{disclaimerNote}</div>
        )}

        {showAmountInput && (
          <div className="field-group" style={{ marginTop: 12 }}>
            <label htmlFor="modal-amount-input">{amountLabel}</label>
            <input
              id="modal-amount-input"
              type="text"
              className="input-text"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="e.g. 185000"
            />
          </div>
        )}

        <div className="field-group" style={{ marginTop: 12 }}>
          <label htmlFor="modal-reason-input">
            {reasonLabel}
            {requireReason ? " *" : " (Optional)"}
          </label>
          <textarea
            id="modal-reason-input"
            className="input-text"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
          />
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${
              confirmTone === "danger"
                ? "btn-danger"
                : confirmTone === "warning"
                  ? "btn-warning"
                  : "btn-primary"
            }`}
            onClick={handleSubmit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
