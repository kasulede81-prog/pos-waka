import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchMyShopNumber, formatWakaShopNumber } from "../../lib/shopNumber";
import { usePosStore } from "../../store/usePosStore";

type Props = { lang: Language };

/** Compact support footer — shop ID for WhatsApp / support calls. */
export function ShopSupportNumberCard({ lang }: Props) {
  const cachedId = usePosStore((s) => formatWakaShopNumber(s.preferences.wakaShopId));
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [shopId, setShopId] = useState<string | null>(cachedId);
  const [loading, setLoading] = useState(!cachedId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (cachedId) {
      setShopId(cachedId);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchMyShopNumber()
      .then((n) => {
        if (cancelled || !n) return;
        setShopId(n);
        setPreferences({ wakaShopId: n });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cachedId, setPreferences]);

  const copy = useCallback(() => {
    if (!shopId) return;
    void navigator.clipboard?.writeText(shopId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [shopId]);

  if (loading) {
    return (
      <footer className="rounded-xl border border-border/80 bg-muted px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">{t(lang, "settingsShopIdLoading")}</p>
      </footer>
    );
  }

  if (!shopId) return null;

  return (
    <footer className="rounded-xl border border-border/80 bg-muted px-4 py-3">
      <p className="text-xs font-bold text-muted-foreground">{t(lang, "shopProfileSupportFooterTitle")}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "shopProfileSupportFooterHint")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{t(lang, "settingsShopIdTitle")}:</span>
        <span className="font-mono text-lg font-black text-foreground">{shopId}</span>
        <button
          type="button"
          onClick={copy}
          className="min-h-[36px] rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground"
        >
          {copied ? t(lang, "settingsShopIdCopied") : t(lang, "settingsShopIdCopy")}
        </button>
      </div>
    </footer>
  );
}
