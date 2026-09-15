import { useEffect, useState } from "react";
import {
  lookupSaleLineForCorrection,
  regenerateDayCloseForCorrection,
  type SaleLineLookupResult,
} from "../../../../lib/financialCorrectionApi";
import { linkFinancialCorrectionRequest } from "../../../../lib/financialIssueReportApi";
import { FinancialCorrectionDialog, type FinancialCorrectionTarget } from "./FinancialCorrectionDialog";

function ugx(n: number): string {
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

/**
 * Forensic, single-line lookup — not a sales browser. Historical financial correction
 * is a rare, targeted operation on a specific line already identified by investigation
 * (support ticket, audit review, or a user-submitted financial_correction_requests row).
 * The admin supplies the pack-cost/conversion-rate evidence for that one line; the
 * sale_line_item_id itself either comes from manual entry or — when opened from the
 * request queue — is pre-filled and looked up automatically via initialSaleLineItemId,
 * so the admin never has to copy/paste it either.
 */
export function FinancialCorrectionPanel({
  shopId,
  actorRole,
  initialSaleLineItemId,
  linkedRequestId,
  onLinked,
}: {
  shopId: string;
  actorRole: string;
  /** Pre-fills and auto-looks-up this line — set when opened from a user report. */
  initialSaleLineItemId?: string;
  /** When set, a successful correction is automatically linked back to this report via
   * internal_link_financial_correction_request (super_admin/finance_admin only, same
   * gate as the correction RPC itself). */
  linkedRequestId?: string;
  onLinked?: () => void;
}) {
  const [lineIdInput, setLineIdInput] = useState(initialSaleLineItemId ?? "");
  const [packCostInput, setPackCostInput] = useState("");
  const [conversionRateInput, setConversionRateInput] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<Extract<SaleLineLookupResult, { found: true }> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{
    correctionId: string;
    resultingLineRevision: number;
    closedDayRequiresRegeneration: boolean;
    affectedDateKey: string;
    regenStatus?: string;
  } | null>(null);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);

  async function handleLookup() {
    const id = lineIdInput.trim();
    if (!id) return;
    setLooking(true);
    setLookupError(null);
    setFound(null);
    setLastResult(null);
    const result = await lookupSaleLineForCorrection(shopId, id);
    setLooking(false);
    if (!result.found) {
      setLookupError(result.error);
      return;
    }
    setFound(result);
    setConversionRateInput(result.conversionRate != null ? String(result.conversionRate) : "");
  }

  useEffect(() => {
    if (initialSaleLineItemId) void handleLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSaleLineItemId]);

  const packCost = Number(packCostInput);
  const conversionRate = Number(conversionRateInput);
  const basisReady =
    found != null && Number.isFinite(packCost) && packCost > 0 && Number.isFinite(conversionRate) && conversionRate > 0;

  const target: FinancialCorrectionTarget | null =
    found && basisReady
      ? {
          shopId,
          saleId: found.saleId,
          saleLineItemId: found.saleLineItemId,
          productName: found.productName,
          baseUnit: "",
          quantity: found.quantity,
          revenueUgx: found.lineTotalUgx,
          expectedCurrentRevision: found.financialRevision,
          before: found.current,
          packCostUgx: packCost,
          conversionRate,
        }
      : null;

  async function handleRegenerate() {
    if (!lastResult?.affectedDateKey) return;
    setRegenBusy(true);
    const r = await regenerateDayCloseForCorrection(shopId, lastResult.affectedDateKey);
    setRegenBusy(false);
    setLastResult((prev) =>
      prev
        ? {
            ...prev,
            regenStatus: r.ok
              ? "noActiveClose" in r
                ? "no_active_close"
                : "alreadyReflected" in r
                  ? "already_reflected"
                  : "regenerated"
              : `error: ${r.error}`,
          }
        : prev,
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div>
        <h2 className="text-sm font-black text-foreground">Historical financial correction</h2>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          Corrects one already-identified sale line via the immutable, CAS-protected correction RPC. Not a browser —
          you must already know the sale_line_item_id from investigation.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={lineIdInput}
          onChange={(e) => setLineIdInput(e.target.value)}
          placeholder="sale_line_item_id (uuid)"
          className="min-h-[44px] flex-1 rounded-xl border border-border bg-background px-3 font-mono text-xs"
        />
        <button
          type="button"
          disabled={looking || !lineIdInput.trim()}
          onClick={() => void handleLookup()}
          className="min-h-[44px] rounded-xl border border-border bg-card px-4 text-sm font-black disabled:opacity-50"
        >
          {looking ? "Looking up…" : "Look up"}
        </button>
      </div>

      {lookupError ? <p className="text-xs font-semibold text-rose-700">{lookupError}</p> : null}

      {found ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-3">
          <div className="text-xs">
            <p className="font-black text-foreground">
              {found.productName} · qty {found.quantity} · revenue {ugx(found.lineTotalUgx)}
            </p>
            <p className="mt-1 font-mono text-muted-foreground">
              current: unitCost {ugx(found.current.unitCostUgx)} · cogs {ugx(found.current.cogsUgx)} · gp{" "}
              {ugx(found.current.grossProfitUgx)} · financial_revision {found.financialRevision}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-muted-foreground">Pack cost (UGX)</span>
              <input
                value={packCostInput}
                onChange={(e) => setPackCostInput(e.target.value)}
                inputMode="numeric"
                className="mt-1 min-h-[40px] w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-muted-foreground">Conversion rate</span>
              <input
                value={conversionRateInput}
                onChange={(e) => setConversionRateInput(e.target.value)}
                inputMode="numeric"
                className="mt-1 min-h-[40px] w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!basisReady}
            onClick={() => setDialogOpen(true)}
            className="min-h-[44px] w-full rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review correction…
          </button>
        </div>
      ) : null}

      {lastResult ? (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
          <p className="font-black text-emerald-900">
            Correction applied — resulting revision {lastResult.resultingLineRevision}
          </p>
          <p className="font-mono text-emerald-900/80">correction_id {lastResult.correctionId}</p>
          {lastResult.closedDayRequiresRegeneration ? (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-emerald-900">
                Closed day {lastResult.affectedDateKey} needs regeneration.
              </span>
              <button
                type="button"
                disabled={regenBusy}
                onClick={() => void handleRegenerate()}
                className="min-h-[36px] rounded-xl border border-emerald-300 px-3 text-[11px] font-black text-emerald-900 disabled:opacity-50"
              >
                {regenBusy ? "Regenerating…" : "Regenerate close"}
              </button>
            </div>
          ) : (
            <p className="text-emerald-900/70">No active close on {lastResult.affectedDateKey} — nothing to regenerate.</p>
          )}
          {lastResult.regenStatus ? <p className="font-mono text-emerald-900/80">regen: {lastResult.regenStatus}</p> : null}
          {linkStatus ? <p className="font-mono text-emerald-900/80">report link: {linkStatus}</p> : null}
        </div>
      ) : null}

      {target && dialogOpen ? (
        <FinancialCorrectionDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          target={target}
          actorRole={actorRole}
          onCorrected={(result) => {
            setLastResult(result);
            setFound(null);
            setLineIdInput("");
            setPackCostInput("");
            setConversionRateInput("");
            if (linkedRequestId) {
              void linkFinancialCorrectionRequest(linkedRequestId, result.correctionId).then((r) => {
                setLinkStatus(r.ok ? "linked" : `error: ${r.error}`);
                if (r.ok) onLinked?.();
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}
