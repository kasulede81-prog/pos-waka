import { useEffect } from "react";
import { Wand2 } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatAiErrorMessage } from "../../lib/ai/aiErrors";
import { useAiBusinessSetup } from "../../hooks/useAiBusinessSetup";
import type { AiStarterProductRow } from "../../lib/ai/aiBusinessSchemas";

type Props = {
  lang: Language;
  shopName: string;
  businessType: string;
  businessDescription?: string;
  enabled?: boolean;
  onUseStarter: (rows: AiStarterProductRow[]) => void;
  onSkipClassic: () => void;
};

export function AiBusinessSetupCard({
  lang,
  shopName,
  businessType,
  businessDescription,
  enabled = true,
  onUseStarter,
  onSkipClassic,
}: Props) {
  const { featureOn, completed, setup, loading, error, errorCode, fromCache, generate, skip, accept } = useAiBusinessSetup({
    shopName,
    businessType,
    businessDescription,
    enabled,
  });

  useEffect(() => {
    if (!featureOn || completed || setup || loading) return;
    void generate();
  }, [featureOn, completed, setup, loading, generate]);

  if (!featureOn || completed) return null;

  return (
    <section className="space-y-3 rounded-2xl border-2 border-waka-200 bg-gradient-to-b from-waka-50/90 to-card p-4 shadow-sm dark:border-waka-800/50 dark:from-waka-950/40 dark:to-card">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-waka-100 text-waka-700 dark:bg-waka-900/60 dark:text-waka-300">
          <Wand2 className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-foreground">{t(lang, "aiBusinessSetupTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "aiBusinessSetupSub")}</p>
        </div>
      </div>

      {loading ? (
        <p className="rounded-xl bg-waka-50 px-3 py-2 text-sm font-bold text-waka-900 dark:bg-waka-950/50 dark:text-waka-200">
          {t(lang, "aiBusinessSetupLoading")}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
          {formatAiErrorMessage({ code: errorCode, detail: error }) || t(lang, "aiBusinessSetupFailed")}
        </p>
      ) : null}

      {setup ? (
        <div className="space-y-3">
          {fromCache ? (
            <p className="text-xs font-semibold text-muted-foreground">{t(lang, "aiBusinessSetupFromCache")}</p>
          ) : null}
          <p className="text-sm font-bold text-foreground">
            {tTemplate(lang, "aiBusinessSetupNature", { nature: setup.detectedNature })}
          </p>
          {setup.shelves.length > 0 ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {t(lang, "aiBusinessSetupShelves")}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">{setup.shelves.slice(0, 8).join(" · ")}</p>
            </div>
          ) : null}
          <p className="text-sm font-semibold text-foreground/90">
            {tTemplate(lang, "aiBusinessSetupStarterCount", { count: String(setup.starterProducts.length) })}
          </p>
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-2 text-sm">
            {setup.starterProducts.slice(0, 12).map((row) => (
              <li key={row.name} className="flex justify-between gap-2 font-semibold text-foreground">
                <span className="truncate">{row.name}</span>
                <span className="shrink-0 text-muted-foreground">{row.category}</span>
              </li>
            ))}
            {setup.starterProducts.length > 12 ? (
              <li className="text-xs font-bold text-muted-foreground">
                {tTemplate(lang, "aiBusinessSetupMore", { count: String(setup.starterProducts.length - 12) })}
              </li>
            ) : null}
          </ul>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              className="min-h-[48px] rounded-xl bg-waka-600 text-sm font-black text-white shadow-sm active:bg-waka-700"
              onClick={async () => {
                onUseStarter(setup.starterProducts);
                await accept();
              }}
            >
              {t(lang, "aiBusinessSetupUse")}
            </button>
            <button
              type="button"
              className="min-h-[44px] rounded-xl border-2 border-border bg-card text-sm font-black text-foreground"
              onClick={async () => {
                onSkipClassic();
                await skip();
              }}
            >
              {t(lang, "aiBusinessSetupSkipClassic")}
            </button>
          </div>
        </div>
      ) : !loading && error ? (
        <button
          type="button"
          className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card text-sm font-black text-foreground"
          onClick={() => void skip().then(onSkipClassic)}
        >
          {t(lang, "aiBusinessSetupSkipClassic")}
        </button>
      ) : null}
    </section>
  );
}
