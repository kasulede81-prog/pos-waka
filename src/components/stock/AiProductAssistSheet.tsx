import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Language, BusinessType } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { formatAiErrorMessage } from "../../lib/ai/aiErrors";
import { useAiProductSuggest } from "../../hooks/useAiProductSuggest";
import type { WizardPrefillFromAi } from "../../lib/ai/mapAiSuggestionToWizard";
import type { AiProductSuggestion } from "../../lib/ai/aiProductSchemas";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  businessType: BusinessType;
  onContinue: (prefill: WizardPrefillFromAi) => void;
  onContinueManual: (name: string) => void;
};

function previewFromPrefill(prefill: WizardPrefillFromAi, suggestion: AiProductSuggestion) {
  return {
    name: prefill.name,
    category: prefill.shelf,
    unit: suggestion.unit,
    packLabel:
      prefill.hasPack && prefill.piecesPerPack
        ? `${prefill.packKind === "custom" ? prefill.packCustom : prefill.packKind} × ${prefill.piecesPerPack}`
        : "",
  };
}

export function AiProductAssistSheet({
  lang,
  open,
  onClose,
  businessType,
  onContinue,
  onContinueManual,
}: Props) {
  const { enabled, loading, error, errorCode, suggest, reset } = useAiProductSuggest();
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof previewFromPrefill> | null>(null);
  const [prefill, setPrefill] = useState<WizardPrefillFromAi | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPreview(null);
    setPrefill(null);
    setFromCache(false);
    setFailed(false);
    reset();
  }, [open, reset]);

  if (!open || !enabled) return null;

  const handleSuggest = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFailed(false);
    setPreview(null);
    setPrefill(null);

    const result = await suggest({
      productName: trimmed,
      businessType,
    });

    if (!result.ok) {
      setFailed(true);
      return;
    }

    setPrefill(result.prefill);
    setPreview(previewFromPrefill(result.prefill, result.suggestion));
    setFromCache(result.fromCache);
  };

  const buildPrefillFromPreview = (): WizardPrefillFromAi | null => {
    if (!prefill || !preview) return null;
    return {
      ...prefill,
      name: preview.name.trim() || prefill.name,
      shelf: preview.category.trim() || prefill.shelf,
    };
  };

  const handleContinue = () => {
    const next = buildPrefillFromPreview();
    if (!next) return;
    onContinue(next);
  };

  const handleManual = () => {
    onContinueManual(name.trim());
  };

  return (
    <AppModalOverlay
      className="z-[58] flex items-end justify-center bg-black/55 sm:items-center"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-[1.75rem] bg-card shadow-2xl sm:max-h-[90vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-black text-foreground">{t(lang, "aiProductAssistTitle")}</p>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "aiProductAssistSubtitle")}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl px-2 py-1 text-sm font-bold text-muted-foreground"
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t(lang, "simpleAddStep1Title")}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "aiProductAssistNamePh")}
              autoFocus
              disabled={loading}
              className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-border px-4 text-xl font-bold outline-none ring-violet-300 focus:ring disabled:opacity-60"
            />
          </label>

          {loading ? (
            <p className="rounded-2xl bg-violet-50 px-4 py-3 text-center text-base font-bold text-violet-900">
              {t(lang, "aiProductAssistLoading")}
            </p>
          ) : null}

          {failed && error ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
              {formatAiErrorMessage({ code: errorCode, detail: error })}
            </p>
          ) : null}

          {preview && prefill ? (
            <div className="space-y-3 rounded-2xl border-2 border-violet-100 bg-violet-50/60 p-4">
              <p className="text-sm font-bold text-violet-900">{t(lang, "aiProductAssistPreviewHint")}</p>
              {fromCache ? (
                <p className="text-xs font-semibold text-violet-700">{t(lang, "aiProductAssistFromCache")}</p>
              ) : null}
              <label className="block text-sm font-bold text-muted-foreground">
                {t(lang, "stockEditNameLabel")}
                <input
                  value={preview.name}
                  onChange={(e) => setPreview((p) => (p ? { ...p, name: e.target.value } : p))}
                  className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-white bg-card px-3 text-base font-bold"
                />
              </label>
              <label className="block text-sm font-bold text-muted-foreground">
                {t(lang, "aiProductAssistCategory")}
                <input
                  value={preview.category}
                  onChange={(e) => setPreview((p) => (p ? { ...p, category: e.target.value } : p))}
                  className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-white bg-card px-3 text-base font-bold"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-card px-3 py-2">
                  <p className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "aiProductAssistUnit")}</p>
                  <p className="mt-1 font-black text-foreground">{preview.unit}</p>
                </div>
                <div className="rounded-xl bg-card px-3 py-2">
                  <p className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "aiProductAssistPack")}</p>
                  <p className="mt-1 font-black text-foreground">{preview.packLabel || "—"}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border p-5">
          {preview ? (
            <button
              type="button"
              onClick={handleContinue}
              className="min-h-[56px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white shadow-md"
            >
              {t(lang, "aiProductAssistContinue")}
            </button>
          ) : (
            <button
              type="button"
              disabled={loading || !name.trim()}
              onClick={() => void handleSuggest()}
              className="min-h-[56px] w-full rounded-2xl bg-violet-600 text-lg font-black text-white shadow-md disabled:opacity-50"
            >
              {t(lang, "aiProductAssistGetSuggestions")}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={handleManual}
            className="min-h-[48px] w-full rounded-2xl border-2 border-border text-base font-black text-foreground disabled:opacity-50"
          >
            {t(lang, "aiProductAssistContinueManual")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
