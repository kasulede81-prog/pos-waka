import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCheckoutTotals } from "../../lib/draftCart";

type Props = {
  lang: Language;
  checkoutTotals: DraftCheckoutTotals;
  /** Shown only when > 0 — retail Sell normally omits (no invented tax). */
  taxUgx?: number;
  /** Shown only when > 0 — hospitality may pass; Sell defaults to 0. */
  serviceChargeUgx?: number;
  changeDue?: number;
  sidebarCompact?: boolean;
};

/**
 * Phase 33.1 — sticky enterprise totals hierarchy.
 * Uses existing `computeDraftCheckoutTotals` values only (no engine changes).
 */
export function DraftCartTotalsStack({
  lang,
  checkoutTotals,
  taxUgx = 0,
  serviceChargeUgx = 0,
  changeDue = 0,
  sidebarCompact = false,
}: Props) {
  const lineDiscount = Math.max(0, checkoutTotals.lineDiscountUgx);
  const cartDiscount = Math.max(0, checkoutTotals.cartDiscountUgx);
  const totalDiscount = lineDiscount + cartDiscount;
  // Gross before line discounts; payable already equals post-discount amount from the engine.
  const subtotalUgx = checkoutTotals.lineSubtotalUgx + lineDiscount;
  const tax = Math.max(0, Math.floor(taxUgx));
  const service = Math.max(0, Math.floor(serviceChargeUgx));
  const payable = checkoutTotals.payableUgx;
  const showChange = changeDue > 0;

  const rowClass = clsx(
    "flex items-baseline justify-between gap-3 font-semibold tabular-nums",
    sidebarCompact ? "text-[11px]" : "text-xs",
  );

  return (
    <section
      className={clsx(
        "rounded-xl border border-waka-200 bg-card shadow-sm",
        sidebarCompact ? "px-2.5 py-2" : "px-3 py-2.5",
      )}
      aria-label={t(lang, "payableTotalLabel")}
    >
      <div className={clsx("space-y-1", sidebarCompact ? "text-muted-foreground" : "text-muted-foreground")}>
        <div className={rowClass}>
          <span>{t(lang, "checkoutSubtotalLabel")}</span>
          <span className="text-foreground">UGX {subtotalUgx.toLocaleString()}</span>
        </div>

        {totalDiscount > 0 ? (
          <div className={clsx(rowClass, "text-warning-foreground")}>
            <span>
              {t(lang, "cartDiscountApplied")}
              {lineDiscount > 0 && cartDiscount > 0
                ? ` (−${lineDiscount.toLocaleString()} / −${cartDiscount.toLocaleString()})`
                : null}
            </span>
            <span>− UGX {totalDiscount.toLocaleString()}</span>
          </div>
        ) : null}

        {tax > 0 ? (
          <div className={rowClass}>
            <span>{t(lang, "restaurantBillTax")}</span>
            <span className="text-foreground">UGX {tax.toLocaleString()}</span>
          </div>
        ) : null}

        {service > 0 ? (
          <div className={rowClass}>
            <span>{t(lang, "restaurantBillServiceCharge")}</span>
            <span className="text-foreground">UGX {service.toLocaleString()}</span>
          </div>
        ) : null}
      </div>

      <div
        className={clsx(
          "mt-2 border-t border-waka-300 pt-2",
          "flex items-baseline justify-between gap-3",
        )}
      >
        <span
          className={clsx(
            "font-black uppercase tracking-wide text-waka-950",
            sidebarCompact ? "text-xs" : "text-sm",
          )}
        >
          {t(lang, "payableTotalLabel")}
        </span>
        <span
          className={clsx(
            "font-black tabular-nums text-waka-800",
            sidebarCompact ? "text-lg" : "text-2xl",
          )}
          data-testid="draft-cart-payable"
        >
          UGX {payable.toLocaleString()}
        </span>
      </div>

      {showChange ? (
        <p
          className={clsx(
            "mt-1.5 rounded-md bg-success-muted font-black text-success",
            sidebarCompact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-sm",
          )}
        >
          {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}
