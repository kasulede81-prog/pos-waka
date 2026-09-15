import { useEffect, useState } from "react";
import {
  listFinancialCorrectionRequests,
  setFinancialCorrectionRequestStatus,
  type FinancialCorrectionRequestRow,
  type FinancialCorrectionRequestStatus,
} from "../../../../lib/financialIssueReportApi";
import { FinancialCorrectionPanel } from "./FinancialCorrectionPanel";

function ugx(n: number | null): string {
  return n == null ? "—" : `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

const STATUS_LABEL: Record<FinancialCorrectionRequestStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  correction_applied: "Corrected",
  requires_manual_review: "Needs manual review",
};

const STATUS_TONE: Record<FinancialCorrectionRequestStatus, string> = {
  submitted: "bg-amber-100 text-amber-900",
  under_review: "bg-sky-100 text-sky-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  correction_applied: "bg-emerald-600 text-white",
  requires_manual_review: "bg-orange-100 text-orange-900",
};

/**
 * Reused, not a separate admin system — lives inside the same Business tab section as
 * FinancialCorrectionPanel. Selecting a report opens that panel pre-filled with the
 * report's sale_line_item_id (initialSaleLineItemId) and wires linkedRequestId so a
 * successful correction is automatically recorded back onto this request — the admin
 * never copies a UUID at any point in this flow.
 */
export function FinancialCorrectionRequestQueue({
  shopId,
  actorRole,
  canInvestigate,
  canCorrect,
}: {
  shopId: string;
  actorRole: string;
  /** super_admin / finance_admin / support_admin — matches internal_set_financial_correction_request_status's gate. */
  canInvestigate: boolean;
  /** super_admin / finance_admin only — matches the correction RPC's own gate. */
  canCorrect: boolean;
}) {
  const [requests, setRequests] = useState<FinancialCorrectionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [investigating, setInvestigating] = useState<FinancialCorrectionRequestRow | null>(null);

  async function load() {
    setLoading(true);
    const result = await listFinancialCorrectionRequests();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRequests(result.requests.filter((r) => r.shopId === shopId));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  async function handleStatus(requestId: string, status: "under_review" | "approved" | "rejected" | "requires_manual_review") {
    setBusyId(requestId);
    await setFinancialCorrectionRequestStatus(requestId, status);
    setBusyId(null);
    void load();
  }

  if (!canInvestigate) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black text-foreground">Reported financial issues</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[32px] rounded-xl border border-border bg-card px-3 text-[11px] font-black"
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="text-xs font-semibold text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-xs font-semibold text-rose-700">{error}</p> : null}
      {!loading && requests.length === 0 ? (
        <p className="text-xs font-semibold text-muted-foreground">No reports for this shop.</p>
      ) : null}

      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-black text-foreground">
                {r.productName} · qty {r.quantity} · {new Date(r.saleDate).toLocaleDateString()}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            <p className="mt-1 font-mono text-muted-foreground">
              current: unitCost {ugx(r.currentUnitCostUgx)} · cogs {ugx(r.currentCogsUgx)} · gp{" "}
              {ugx(r.currentGrossProfitUgx)} · revision {r.financialRevision}
            </p>
            <p className="mt-1 text-foreground">{r.reason}</p>
            {r.evidenceNote ? <p className="mt-0.5 italic text-muted-foreground">Evidence: {r.evidenceNote}</p> : null}
            <p className="mt-1 text-[10px] text-muted-foreground">
              reported by {r.reportedByUserId.slice(0, 8)}… · {new Date(r.createdAt).toLocaleString()}
            </p>
            {r.adminNotes ? <p className="mt-1 text-muted-foreground">Admin notes: {r.adminNotes}</p> : null}

            {r.status === "correction_applied" ? (
              <p className="mt-2 font-mono text-emerald-800">correction_id {r.correctionId}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void handleStatus(r.id, "under_review")}
                  className="min-h-[32px] rounded-xl border border-border px-2 text-[11px] font-bold disabled:opacity-50"
                >
                  Under review
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void handleStatus(r.id, "requires_manual_review")}
                  className="min-h-[32px] rounded-xl border border-orange-300 px-2 text-[11px] font-bold text-orange-900 disabled:opacity-50"
                >
                  Needs manual review
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void handleStatus(r.id, "rejected")}
                  className="min-h-[32px] rounded-xl border border-rose-300 px-2 text-[11px] font-bold text-rose-900 disabled:opacity-50"
                >
                  Reject
                </button>
                {canCorrect ? (
                  <button
                    type="button"
                    onClick={() => setInvestigating(r)}
                    className="min-h-[32px] rounded-xl bg-waka-600 px-2 text-[11px] font-black text-white"
                  >
                    Investigate →
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {investigating ? (
        <div className="rounded-2xl border border-waka-300 bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-black text-foreground">
              Investigating report — {investigating.productName}
            </p>
            <button
              type="button"
              onClick={() => setInvestigating(null)}
              className="text-[11px] font-bold text-muted-foreground"
            >
              Close
            </button>
          </div>
          <FinancialCorrectionPanel
            shopId={shopId}
            actorRole={actorRole}
            initialSaleLineItemId={investigating.saleLineItemId}
            linkedRequestId={investigating.id}
            onLinked={() => {
              setInvestigating(null);
              void load();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
