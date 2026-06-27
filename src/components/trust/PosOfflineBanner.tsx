import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { useState } from "react";

type Props = { lang: Language; compact?: boolean };

export function posOfflineBannerVisible(isOnline: boolean): boolean {
  return !isOnline;
}

/** Reassurance on POS when offline — does not block selling. */
export function PosOfflineBanner({ lang, compact = false }: Props) {
  const { isOnline } = useSyncStatus();
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!posOfflineBannerVisible(isOnline)) return null;

  if (compact) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-950 active:bg-amber-100"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
          {t(lang, "posOfflinePill")}
        </button>
        {detailsOpen ? (
          <p className="rounded-lg bg-amber-50/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950">
            {t(lang, "posOfflinePillDetail")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-sm"
    >
      {t(lang, "posOfflineConfidenceBanner")}
    </div>
  );
}
