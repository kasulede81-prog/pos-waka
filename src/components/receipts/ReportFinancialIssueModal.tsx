import { useState } from "react";
import type { Sale, SaleLine } from "../../types";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { reportFinancialIssue } from "../../lib/financialIssueReportApi";
import { resolveShopCtx } from "../../offline/cloudSync";

/**
 * Shop-user-facing "Report financial issue" — the only financial-correction-adjacent
 * action an ordinary user can take. Captures sale_line_item_id/sale_id/shop_id entirely
 * from context; the user never sees or enters a UUID. Submits via
 * shop_report_financial_issue, which re-derives and validates sale_id/product_id
 * server-side rather than trusting anything this component sends beyond the line id.
 */
export function ReportFinancialIssueModal({
  open,
  sale,
  line,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  sale: Sale | null;
  line: SaleLine | null;
  onClose: () => void;
  onSubmitted?: (requestId: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open || !sale || !line) return null;

  const reset = () => {
    setReason("");
    setEvidenceNote("");
    setError(null);
    setDone(false);
  };

  async function handleSubmit() {
    if (!sale || !line) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setError("Please describe the problem (at least a few words).");
      return;
    }
    if (!line.id) {
      setError("This sale line hasn't finished syncing yet — try again in a moment.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const ctx = await resolveShopCtx();
    if (!ctx) {
      setSubmitting(false);
      setError("Could not determine your shop — check your connection and try again.");
      return;
    }
    const result = await reportFinancialIssue({
      shopId: ctx.shopId,
      saleLineItemId: line.id,
      reason: trimmedReason,
      evidenceNote: evidenceNote.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(
        result.error === "report_already_open_for_line"
          ? "There's already an open report for this item — no need to submit another."
          : result.error === "already_corrected"
            ? "This item's figures have already been corrected — no need to report it again."
            : result.error === "sale_not_completed"
              ? "This sale isn't completed yet, so it can't be reported."
              : "Couldn't submit the report — please try again.",
      );
      return;
    }
    setDone(true);
    onSubmitted?.(result.requestId);
  }

  return (
    <AppModalOverlay
      className="z-[64] flex items-end justify-center bg-overlay/55 sm:items-center"
      role="dialog"
      aria-modal
      onClick={() => {
        reset();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-t-[1.75rem] bg-card p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="py-4 text-center">
            <h2 className="text-xl font-black text-foreground">Report submitted</h2>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">
              An administrator will review this and follow up if a correction is needed.
            </p>
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-600 font-black text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-black text-foreground">Report financial issue</h2>

            <div className="mt-3 rounded-2xl border border-border bg-muted p-3 text-sm">
              <p className="font-black text-foreground">{line.name}</p>
              <p className="mt-1 text-muted-foreground">
                Quantity: {line.quantity} {line.baseUnit ?? ""}
              </p>
              <p className="text-muted-foreground">
                Sale: #{sale.id.slice(0, 8)} · {new Date(sale.createdAt).toLocaleDateString()}
              </p>
            </div>

            <label className="mt-4 block text-sm font-bold text-foreground">
              What is wrong?
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Describe the problem with this sale's figures…"
                className="mt-2 w-full rounded-xl border-2 border-border px-3 py-2 text-base"
              />
            </label>

            <label className="mt-3 block text-sm font-bold text-foreground">
              Supporting evidence (optional)
              <input
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
                placeholder="e.g. reference to a receipt, invoice number, or purchase record"
                className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-base"
              />
            </label>

            {error ? <p className="mt-2 text-sm font-semibold text-danger">{error}</p> : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="min-h-[52px] rounded-2xl border-2 py-3 font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="min-h-[52px] rounded-2xl bg-waka-600 py-3 font-black text-white disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </>
        )}
      </div>
    </AppModalOverlay>
  );
}
