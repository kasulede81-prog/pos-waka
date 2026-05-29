import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchMyShopNumber, formatWakaShopNumber } from "../../lib/shopNumber";
import { usePosStore } from "../../store/usePosStore";

type Props = { lang: Language };

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
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-stone-500">{t(lang, "settingsShopIdLoading")}</p>
      </section>
    );
  }

  if (!shopId) return null;

  return (
    <section className="rounded-2xl border-2 border-orange-200 bg-orange-50/80 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-orange-900">{t(lang, "settingsShopIdTitle")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="font-mono text-3xl font-black text-stone-900">{shopId}</span>
        <button
          type="button"
          onClick={copy}
          className="min-h-[44px] rounded-xl bg-stone-900 px-4 text-sm font-black text-white"
        >
          {copied ? t(lang, "settingsShopIdCopied") : t(lang, "settingsShopIdCopy")}
        </button>
      </div>
      <p className="mt-2 text-xs font-medium leading-relaxed text-stone-700">{t(lang, "settingsShopIdHint")}</p>
    </section>
  );
}
