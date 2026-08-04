import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Language, BusinessType } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { formatAiErrorMessage } from "../../lib/ai/aiErrors";
import { useAiProductSuggest } from "../../hooks/useAiProductSuggest";
import type { WizardPrefillFromAi } from "../../lib/ai/mapAiSuggestionToWizard";
import type { AiProductSuggestion } from "../../lib/ai/aiProductSchemas";
import { WakaButton } from "../ui/wakaPrimitives";

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

  if (!enabled) return null;

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
    <ModalSheet
      open={open}
      onClose={onClose}
      zIndexClass="z-[58]"
      panelClassName="!max-w-lg"
      title={
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-trial-muted text-trial">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-foreground">{t(lang, "aiProductAssistTitle")}</p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "aiProductAssistSubtitle")}</p>
          </div>
        </div>
      }
      footer={
        <div className="space-y-2">
          {preview ? (
            <WakaButton type="button" variant="primary" className="w-full !min-h-[56px] !text-lg" onClick={handleContinue}>
              {t(lang, "aiProductAssistContinue")}
            </WakaButton>
          ) : (
            <WakaButton
              type="button"
              variant="primary"
              className="w-full !min-h-[56px] !text-lg"
              disabled={loading || !name.trim()}
              onClick={() => void handleSuggest()}
            >
              {t(lang, "aiProductAssistGetSuggestions")}
            </WakaButton>
          )}
          <WakaButton type="button" variant="secondary" className="w-full" disabled={loading} onClick={handleManual}>
            {t(lang, "aiProductAssistContinueManual")}
          </WakaButton>
        </div>
      }
    >
      <div className="space-y-4">
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
          <p className="rounded-2xl bg-trial-muted px-4 py-3 text-center text-base font-bold text-trial">
            {t(lang, "aiProductAssistLoading")}
          </p>
        ) : null}

        {failed && error ? (
          <p className="rounded-2xl bg-warning-muted px-4 py-3 text-sm font-semibold text-warning-foreground">
            {formatAiErrorMessage({ code: errorCode, detail: error })}
          </p>
        ) : null}

        {preview && prefill ? (
          <div className="space-y-3 rounded-2xl border-2 border-trial/20 bg-trial-muted/60 p-4">
            <p className="text-sm font-bold text-trial">{t(lang, "aiProductAssistPreviewHint")}</p>
            {fromCache ? (
              <p className="text-xs font-semibold text-trial">{t(lang, "aiProductAssistFromCache")}</p>
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
                <p className="mt-1 font-bold text-foreground">{preview.unit}</p>
              </div>
              <div className="rounded-xl bg-card px-3 py-2">
                <p className="text-xs font-bold uppercase text-muted-foreground">{t(lang, "aiProductAssistPack")}</p>
                <p className="mt-1 font-bold text-foreground">{preview.packLabel || "—"}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ModalSheet>
  );
}
