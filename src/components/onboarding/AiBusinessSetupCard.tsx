import { useEffect } from "react";
import { Sparkles } from "lucide-react";
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
    <section className="space-y-3 rounded-2xl border-2 border-violet-200 bg-gradient-to-b from-violet-50/80 to-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-slate-900">{t(lang, "aiBusinessSetupTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">{t(lang, "aiBusinessSetupSub")}</p>
        </div>
      </div>

      {loading ? (
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm font-bold text-violet-900">{t(lang, "aiProductAssistLoading")}</p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          {formatAiErrorMessage({ code: errorCode, detail: error })}
        </p>
      ) : null}

      {setup ? (
        <div className="space-y-3">
          {fromCache ? (
            <p className="text-xs font-semibold text-violet-700">{t(lang, "aiProductAssistFromCache")}</p>
          ) : null}
          <p className="text-sm font-bold text-slate-800">
            {tTemplate(lang, "aiBusinessSetupNature", { nature: setup.detectedNature })}
          </p>
          {setup.shelves.length > 0 ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "aiBusinessSetupShelves")}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{setup.shelves.slice(0, 8).join(" · ")}</p>
            </div>
          ) : null}
          <p className="text-sm font-semibold text-slate-700">
            {tTemplate(lang, "aiBusinessSetupStarterCount", { count: String(setup.starterProducts.length) })}
          </p>
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-violet-100 bg-white p-2 text-sm">
            {setup.starterProducts.slice(0, 12).map((row) => (
              <li key={row.name} className="flex justify-between gap-2 font-semibold text-slate-800">
                <span className="truncate">{row.name}</span>
                <span className="shrink-0 text-slate-500">{row.category}</span>
              </li>
            ))}
            {setup.starterProducts.length > 12 ? (
              <li className="text-xs font-bold text-slate-500">
                {tTemplate(lang, "aiBusinessSetupMore", { count: String(setup.starterProducts.length - 12) })}
              </li>
            ) : null}
          </ul>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              className="min-h-[48px] rounded-xl bg-waka-600 text-sm font-black text-white"
              onClick={async () => {
                onUseStarter(setup.starterProducts);
                await accept();
              }}
            >
              {t(lang, "aiBusinessSetupUse")}
            </button>
            <button
              type="button"
              className="min-h-[44px] rounded-xl border-2 border-slate-200 text-sm font-black text-slate-800"
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
          className="min-h-[44px] w-full rounded-xl border-2 border-slate-200 text-sm font-black text-slate-800"
          onClick={() => void skip().then(onSkipClassic)}
        >
          {t(lang, "aiBusinessSetupSkipClassic")}
        </button>
      ) : null}
    </section>
  );
}
