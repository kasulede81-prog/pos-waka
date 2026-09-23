import { QrCode, X } from "lucide-react";
import type { LoyaltyCheckoutPreview } from "../../hooks/useLoyaltyCheckoutPreview";
import type { LoyaltyAttachState } from "../../hooks/useLoyaltyCheckoutAttach";
import { t, tTemplate } from "../../lib/i18n";
import type { Language } from "../../types";

type Props = {
  lang: Language;
  /** Empty string when no member is attached to the draft sale. */
  customerId: string;
  /** Name to show for the attached member (store draft customer name). */
  customerName: string;
  /** Read-only preview owned by the page, so the post-sale note can reuse it. */
  preview: LoyaltyCheckoutPreview;
  attachState: LoyaltyAttachState;
  onScan: () => void;
  onDetach: () => void;
  /** Camera scanning unavailable on this device — hide the scan action. */
  canScan: boolean;
};

/**
 * The checkout loyalty surface (Phases 1–3).
 *
 * Renders for EVERY payment method, so a cash sale can carry a member just as
 * a credit sale can. Nothing here credits points: the balance and the expected
 * earn are reads, and the award itself happens server-side when the completed
 * sale reaches the database. Renders nothing when the shop has no live program,
 * and every failure path inside the hooks resolves to an empty state, so
 * loyalty can never block checkout.
 */
export function PosLoyaltyCustomerRow({
  lang,
  customerId,
  customerName,
  preview,
  attachState,
  onScan,
  onDetach,
  canScan,
}: Props) {
  const { program, account, expectedPoints, fromCache } = preview;

  if (!program || !program.enabled) return null;

  const resolving = attachState.status === "resolving";
  const error = attachState.status === "error" ? attachState.errorKey : null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900">
      {customerId ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-black">{customerName.trim() || t(lang, "loyaltyBalanceLabel")}</span>
          <span>
            {account ? account.balancePoints.toLocaleString() : "—"} {t(lang, "loyaltyPointsUnit")}
          </span>
          {expectedPoints > 0 ? (
            <span className="text-amber-800">
              (+{expectedPoints.toLocaleString()} {t(lang, "loyaltyPointsUnit")}{" "}
              {t(lang, "loyaltyEarnsSuffix")})
            </span>
          ) : null}
          {fromCache ? (
            <span className="text-amber-700/70">({t(lang, "loyaltyOfflineEstimate")})</span>
          ) : null}
          <button
            type="button"
            onClick={onDetach}
            aria-label={t(lang, "loyaltyDetachAction")}
            className="ml-auto flex min-h-[28px] items-center gap-1 rounded-md border border-amber-300 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-amber-900"
          >
            <X aria-hidden className="h-3 w-3" />
            {t(lang, "loyaltyDetachAction")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1">{t(lang, "loyaltyAttachCustomerHint")}</span>
          {canScan ? (
            <button
              type="button"
              onClick={onScan}
              disabled={resolving}
              className="flex min-h-[32px] items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-black text-amber-900 disabled:opacity-60"
            >
              <QrCode aria-hidden className="h-3.5 w-3.5" />
              {resolving ? t(lang, "loyaltyScanResolving") : t(lang, "loyaltyScanAction")}
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mt-1 rounded bg-danger-muted px-1.5 py-0.5 text-[10px] font-bold text-danger">
          {t(lang, error)}
        </p>
      ) : null}
    </div>
  );
}

type AwardProps = {
  lang: Language;
  earnedPoints: number;
  balancePoints: number | null;
  confirmed: boolean;
};

/**
 * Post-sale award result (Phase 3).
 *
 * `confirmed` is true only once the server's own ledger row has been read back.
 * Until then this is explicitly an estimate — the cashier is never told points
 * are banked before the database has actually awarded them.
 */
export function PosLoyaltyAwardNote({ lang, earnedPoints, balancePoints, confirmed }: AwardProps) {
  if (earnedPoints <= 0) return null;
  return (
    <div
      className={
        confirmed
          ? "rounded-lg bg-success-muted px-3 py-2 text-sm font-black text-success"
          : "rounded-lg bg-warning-muted px-3 py-2 text-sm font-black text-warning-foreground"
      }
    >
      <span>
        {tTemplate(lang, "loyaltyEarnedPointsLabel", { points: earnedPoints.toLocaleString() })}
      </span>
      {confirmed && balancePoints != null ? (
        <span className="ml-2 font-bold">
          {t(lang, "loyaltyNewBalanceLabel")}: {balancePoints.toLocaleString()}{" "}
          {t(lang, "loyaltyPointsUnit")}
        </span>
      ) : (
        <span className="ml-2 text-xs font-bold opacity-80">
          ({t(lang, "loyaltyAwardEstimatedLabel")}) {t(lang, "loyaltyAwardPendingNote")}
        </span>
      )}
    </div>
  );
}
