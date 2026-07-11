import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  onDismiss: () => void;
};

/** Owner notice after Internal Admin clears Shop Security PIN (Phase 21.1). */
export function ShopSecurityPinRecoveryBanner({ lang, onDismiss }: Props) {
  return (
    <div
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="status"
      data-testid="shop-security-pin-recovery-banner"
    >
      <p className="font-black">{t(lang, "shopSecurityPinRecoveryCleared")}</p>
      <p className="mt-0.5 font-semibold">{t(lang, "shopSecurityPinRecoveryCreateNew")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          to="/settings/pin"
          className="inline-flex min-h-[40px] items-center rounded-xl bg-amber-700 px-4 text-xs font-black text-white"
        >
          {t(lang, "shopSecurityPinRecoveryBannerAction")}
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-[40px] items-center rounded-xl border border-amber-400 px-4 text-xs font-black text-amber-950"
        >
          {t(lang, "shopSecurityPinRecoveryBannerDismiss")}
        </button>
      </div>
    </div>
  );
}
