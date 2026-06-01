import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { expiryStatusPresentation, expiryVisualStatus, productHasExpiry } from "../../lib/pharmacyExpiry";

type Props = {
  lang: Language;
  product: Product;
  compact?: boolean;
  className?: string;
};

export function ExpiryStatusBadge({ lang, product, compact, className }: Props) {
  if (!productHasExpiry(product) || product.stockOnHand <= 0) return null;
  const status = expiryVisualStatus(product);
  if (status === "none") return null;
  const presentation = expiryStatusPresentation(status);
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full font-black uppercase tracking-wide",
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
        presentation.badgeClass,
        className,
      )}
    >
      {t(lang, presentation.labelKey)}
    </span>
  );
}
