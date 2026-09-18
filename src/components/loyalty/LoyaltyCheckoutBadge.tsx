import { useLoyaltyCheckoutPreview } from "../../hooks/useLoyaltyCheckoutPreview";
import { t } from "../../lib/i18n";
import type { Language } from "../../types";

type Props = {
  lang: Language;
  /** Empty string when no customer is attached to the draft sale. */
  customerId: string;
  /** Gross payable for the current draft (preview only). */
  totalUgx: number;
  /** Hide the "attach a customer" hint (e.g. when the flow already shows it). */
  hideAttachHint?: boolean;
};

/**
 * Checkout loyalty badge (Phase 03).
 *
 * Renders nothing when the shop has no enabled loyalty program. Never blocks
 * checkout — every failure path resolves to null state inside the hook.
 */
export function LoyaltyCheckoutBadge({ lang, customerId, totalUgx, hideAttachHint }: Props) {
  const { program, account, expectedPoints, fromCache } = useLoyaltyCheckoutPreview(
    customerId,
    totalUgx,
  );

  if (!program || !program.enabled) return null;

  if (!customerId) {
    if (hideAttachHint) return null;
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900">
        {t(lang, "loyaltyAttachCustomerHint")}
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900">
      <span>
        {t(lang, "loyaltyBalanceLabel")}:{" "}
        <strong className="font-black">
          {account ? account.balancePoints.toLocaleString() : "—"} {t(lang, "loyaltyPointsUnit")}
        </strong>
      </span>
      {expectedPoints > 0 ? (
        <span className="text-amber-800">
          (+{expectedPoints.toLocaleString()} {t(lang, "loyaltyPointsUnit")} {t(lang, "loyaltyEarnsSuffix")})
        </span>
      ) : null}
      {fromCache ? <span className="text-amber-700/70">({t(lang, "loyaltyOfflineEstimate")})</span> : null}
    </p>
  );
}
