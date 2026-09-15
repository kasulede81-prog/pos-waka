import { useMemo, useState } from "react";
import clsx from "clsx";
import { BottomSheet, RoleGate } from "../primitives";
import { canCorrectFinancials } from "../adminRoles";
import { correctSaleLineFinancials, type CorrectionFinancialValues } from "../../../../lib/financialCorrectionApi";
import { deriveCorrectionFromPackCost, validateCorrectionForm } from "../../../../lib/financialCorrectionForm";

function ugx(n: number): string {
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

export type FinancialCorrectionTarget = {
  shopId: string;
  saleId: string;
  saleLineItemId: string;
  productName: string;
  baseUnit: string;
  quantity: number;
  revenueUgx: number;
  expectedCurrentRevision: number;
  before: CorrectionFinancialValues;
  /** Pack-cost/conversion-rate evidence for the pre-filled correction (§ correction basis). */
  packCostUgx: number;
  conversionRate: number;
};

/**
 * The exclusive internal-admin UI for applying a historical financial correction.
 * super_admin / finance_admin only — never reachable from the shop-facing POS UI.
 * Always shows before/after side by side and the arithmetic basis; the reason field is
 * mandatory (validateCorrectionForm rejects an empty or unchanged submission) — this is
 * deliberately NOT a generic "fix data" tool, it corrects exactly one line at a time
 * with a fully typed, auditable basis.
 */
export function FinancialCorrectionDialog({
  open,
  onClose,
  target,
  actorRole,
  onCorrected,
}: {
  open: boolean;
  onClose: () => void;
  target: FinancialCorrectionTarget;
  actorRole: string;
  onCorrected?: (result: {
    correctionId: string;
    resultingLineRevision: number;
    closedDayRequiresRegeneration: boolean;
    affectedDateKey: string;
  }) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { corrected, basis } = useMemo(
    () =>
      deriveCorrectionFromPackCost(
        { quantity: target.quantity, packCostUgx: target.packCostUgx, conversionRate: target.conversionRate },
        target.revenueUgx,
      ),
    [target.quantity, target.packCostUgx, target.conversionRate, target.revenueUgx],
  );

  const validationError = validateCorrectionForm({ reason, before: target.before, corrected });

  async function handleSubmit() {
    if (validationError) return;
    setSubmitting(true);
    setErrorMessage(null);
    const result = await correctSaleLineFinancials({
      shopId: target.shopId,
      saleId: target.saleId,
      saleLineItemId: target.saleLineItemId,
      expectedCurrentRevision: target.expectedCurrentRevision,
      expectedBefore: target.before,
      correctionBasis: basis,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }
    onCorrected?.({
      correctionId: result.correctionId,
      resultingLineRevision: result.resultingLineRevision,
      closedDayRequiresRegeneration: result.closedDayRequiresRegeneration,
      affectedDateKey: result.affectedDateKey,
    });
    onClose();
  }

  return (
    <RoleGate show={canCorrectFinancials(actorRole)}>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Correct historical financial data"
        subtitle={`${target.productName} · ${target.quantity} ${target.baseUnit}`}
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
            Revenue: <span className="font-mono font-black text-foreground">{ugx(target.revenueUgx)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-rose-700">Before</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-rose-900/70">Unit cost</dt>
                  <dd className="font-mono font-black text-rose-950">{ugx(target.before.unitCostUgx)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-rose-900/70">COGS</dt>
                  <dd className="font-mono font-black text-rose-950">{ugx(target.before.cogsUgx)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-rose-900/70">Gross profit</dt>
                  <dd className="font-mono font-black text-rose-950">{ugx(target.before.grossProfitUgx)}</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700">After</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-emerald-900/70">Unit cost</dt>
                  <dd className="font-mono font-black text-emerald-950">{ugx(corrected.unitCostUgx)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-emerald-900/70">COGS</dt>
                  <dd className="font-mono font-black text-emerald-950">{ugx(corrected.cogsUgx)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-emerald-900/70">Gross profit</dt>
                  <dd className="font-mono font-black text-emerald-950">{ugx(corrected.grossProfitUgx)}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
            <p className="font-bold text-foreground">Basis</p>
            <p className="mt-1 font-mono">
              {target.packCostUgx.toLocaleString("en-UG")} / {target.conversionRate} = {corrected.unitCostUgx.toLocaleString("en-UG")} per unit
            </p>
            <p className="font-mono">
              {corrected.unitCostUgx.toLocaleString("en-UG")} × {target.quantity} = {corrected.cogsUgx.toLocaleString("en-UG")}
            </p>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-foreground">Correction reason (required)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Explain the historical evidence for this correction (e.g. pack cost at sale time, purchase record, audit log)."
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          {validationError === "reason_too_short" && reason.trim().length > 0 ? (
            <p className="text-xs font-semibold text-rose-700">Reason is too short — explain the evidence.</p>
          ) : null}
          {validationError === "cost_unchanged" ? (
            <p className="text-xs font-semibold text-rose-700">Corrected values are identical to the current values — nothing to apply.</p>
          ) : null}
          {errorMessage ? <p className="text-xs font-semibold text-rose-700">{errorMessage}</p> : null}

          <button
            type="button"
            disabled={Boolean(validationError) || submitting}
            onClick={handleSubmit}
            className={clsx(
              "min-h-[44px] w-full rounded-xl bg-waka-600 px-4 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {submitting ? "Applying correction…" : "Apply correction"}
          </button>
        </div>
      </BottomSheet>
    </RoleGate>
  );
}
