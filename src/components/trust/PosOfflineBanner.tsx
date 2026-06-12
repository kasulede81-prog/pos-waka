import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSyncStatus } from "../../hooks/useSyncStatus";

type Props = { lang: Language };

export function posOfflineBannerVisible(isOnline: boolean): boolean {
  return !isOnline;
}

/** Reassurance on POS when offline — does not block selling. */
export function PosOfflineBanner({ lang }: Props) {
  const { isOnline } = useSyncStatus();
  if (!posOfflineBannerVisible(isOnline)) return null;

  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-sm"
    >
      {t(lang, "posOfflineConfidenceBanner")}
    </div>
  );
}
