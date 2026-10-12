import { t } from "../../lib/i18n";
import type { Language } from "../../types";

type Props = {
  lang?: Language;
  className?: string;
};

/**
 * Says, in one line, that the annual price beside it is priced on its own leg.
 *
 * WHY IT IS NEEDED. Monthly and annual discounts became independent in
 * `20261012100000_discount_interval_isolation`: a monthly campaign discount no
 * longer feeds the annual price, and an admin discount can be set for one
 * interval without touching the other. The visible consequence is a year priced
 * ABOVE a promotional month — which reads as a mistake unless it is stated. The
 * copy explains the rule rather than apologising for a number, so it stays true
 * whether or not a promotion is running, and it is shown unconditionally for the
 * same reason: it is how annual pricing works, not a notice about an offer.
 *
 * Rendered by `PlanPriceDisplay` for the annual interval when
 * `showIntervalNote` is set, and directly by a caller that presents a whole
 * annual section (the upgrade page) rather than one price at a time.
 */
export function AnnualIntervalNote({ lang = "en", className }: Props) {
  return (
    <p
      data-testid="annual-interval-note"
      // text-sm matches the body copy this sits beside on BOTH cards — the
      // yearly card's own subtitle and the plan card's blurb — and stays legible
      // at phone width, where a two-sentence explanation at text-xs reads as
      // fine print about a price the reader is being asked to accept.
      className={["mt-1 text-sm font-semibold leading-relaxed", className].filter(Boolean).join(" ")}
    >
      {t(lang, "annualIntervalNote")}
    </p>
  );
}
