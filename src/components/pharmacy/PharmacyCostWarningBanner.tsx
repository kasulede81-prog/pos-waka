import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { pharmacyCostWarnings } from "../../lib/pharmacyCostIntegrity";

type Props = { lang: Language; product: Product; className?: string };

/** Non-blocking pharmacy cost/price sanity warnings. */
export function PharmacyCostWarningBanner({ lang, product, className = "" }: Props) {
  const warnings = pharmacyCostWarnings(product);
  if (warnings.length === 0) return null;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {warnings.map((w) => (
        <p
          key={w.kind}
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950"
          role="status"
        >
          {t(lang, w.messageKey)}
        </p>
      ))}
    </div>
  );
}
