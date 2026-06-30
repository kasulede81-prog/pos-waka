import type { ComputedPlanPrice } from "../../lib/subscriptionPricing";
import { formatUgx } from "../../lib/subscriptionPricing";

type Props = {
  price: ComputedPlanPrice;
  interval?: "month" | "year";
  size?: "sm" | "lg";
};

export function PlanPriceDisplay({ price, interval = "month", size = "lg" }: Props) {
  const showStrike =
    interval === "month"
      ? price.hasMonthlyDiscount
      : price.finalAnnualUgx < price.originalAnnualFullUgx;

  const original = interval === "month" ? price.originalMonthlyUgx : price.originalAnnualFullUgx;
  const final = interval === "month" ? price.finalMonthlyUgx : price.finalAnnualUgx;
  const savings =
    interval === "month"
      ? price.monthlyDiscountUgx
      : price.originalAnnualFullUgx - price.finalAnnualUgx;

  const mainCls = size === "lg" ? "text-3xl font-black" : "text-2xl font-black";
  const suffix = interval === "month" ? "/ month" : "/ year";

  if (!showStrike) {
    return (
      <div>
        <p className={`${mainCls} text-waka-700`}>{formatUgx(final)}</p>
        {interval === "year" && price.annualDiscountPercent > 0 ? (
          <p className="mt-1 text-sm font-bold text-emerald-700">Save {price.annualDiscountPercent}%</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className={`text-sm font-bold text-stone-500 line-through`}>{formatUgx(original)}</p>
      <p className={`${mainCls} text-waka-700`}>
        {formatUgx(final)} <span className="text-base font-bold text-stone-600">{suffix}</span>
      </p>
      {interval === "month" && savings > 0 ? (
        <p className="text-sm font-black text-emerald-700">Save {formatUgx(savings)}</p>
      ) : null}
      {interval === "year" && price.annualDiscountPercent > 0 ? (
        <p className="text-sm font-black text-emerald-700">Save {price.annualDiscountPercent}%</p>
      ) : null}
    </div>
  );
}
