import { AnnualIntervalNote } from "./AnnualIntervalNote";
import type { Language } from "../../types";
import type { ComputedPlanPrice } from "../../lib/subscriptionPricing";
import { formatUgx } from "../../lib/subscriptionPricing";

type Props = {
  price: ComputedPlanPrice;
  interval?: "month" | "year";
  size?: "sm" | "lg";
  /**
   * Print the one-line explanation that the annual price is priced separately
   * from monthly promotions. Opt-in, because a caller that shows several annual
   * prices inside ONE card should state it once rather than under each figure —
   * and because adding copy to every existing call site silently would be a
   * change to pages that did not ask for one.
   *
   * Ignored for the monthly interval: the note is about annual pricing and there
   * is no prop that can put it on a monthly card.
   */
  showIntervalNote?: boolean;
  /** Language for the note. English until a translation exists. */
  lang?: Language;
  /** Tone for the note, so it can follow the surface it sits on. */
  noteClassName?: string;
};

export function PlanPriceDisplay({
  price,
  interval = "month",
  size = "lg",
  showIntervalNote = false,
  lang = "en",
  noteClassName,
}: Props) {
  /**
   * Struck-through original + "Save …" whenever the price is genuinely below
   * list — read from the two prices, not from a mechanism flag. A discount can
   * arrive from a campaign OR from a live global administrative discount, and
   * only the campaign sets `hasMonthlyDiscount`; keying the strikethrough on
   * that flag hid the global one. The annual branch already worked this way.
   */
  const original = interval === "month" ? price.originalMonthlyUgx : price.originalAnnualFullUgx;
  const final = interval === "month" ? price.finalMonthlyUgx : price.finalAnnualUgx;
  const showStrike = final < original;
  const savings =
    interval === "month"
      ? price.monthlyDiscountUgx
      : price.originalAnnualFullUgx - price.finalAnnualUgx;

  const mainCls = size === "lg" ? "text-3xl font-black" : "text-2xl font-black";
  const suffix = interval === "month" ? "/ month" : "/ year";
  const note = interval === "year" && showIntervalNote ? <AnnualIntervalNote lang={lang} className={noteClassName} /> : null;

  if (!showStrike) {
    return (
      <div>
        <p className={`${mainCls} text-waka-700`}>{formatUgx(final)}</p>
        {interval === "year" && price.annualDiscountPercent > 0 ? (
          <p className="mt-1 text-sm font-bold text-emerald-700">Save {price.annualDiscountPercent}%</p>
        ) : null}
        {note}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className={`text-sm font-bold text-muted-foreground line-through`}>{formatUgx(original)}</p>
      <p className={`${mainCls} text-waka-700`}>
        {formatUgx(final)} <span className="text-base font-bold text-muted-foreground">{suffix}</span>
      </p>
      {interval === "month" && savings > 0 ? (
        <p className="text-sm font-black text-emerald-700">Save {formatUgx(savings)}</p>
      ) : null}
      {interval === "year" && price.annualDiscountPercent > 0 ? (
        <p className="text-sm font-black text-emerald-700">Save {price.annualDiscountPercent}%</p>
      ) : null}
      {note}
    </div>
  );
}
