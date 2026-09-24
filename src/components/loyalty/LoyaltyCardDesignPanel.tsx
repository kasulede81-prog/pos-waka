import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  DEFAULT_LOYALTY_CARD_DESIGN,
  PREVIEW_PUBLIC_CARD_FIXTURE,
  PROGRAM_NAME_MAX,
  WELCOME_MESSAGE_MAX,
  defaultDraft,
  draftFromDesign,
  fetchLoyaltyCardDesign,
  mergeDesignWithDefaults,
  normalizeHexColor,
  normalizeLogoUrl,
  resetLoyaltyCardDesign,
  saveLoyaltyCardDesign,
  validateDesignDraft,
  type LoyaltyCardDesign,
  type LoyaltyCardDesignDraft,
  type LoyaltyCardStyle,
  type LoyaltyRewardLayout,
} from "../../lib/loyalty/loyaltyCardDesign";
import { PublicLoyaltyCardView } from "./public/PublicLoyaltyCardView";
import type { PublicCardData } from "../../lib/loyalty/loyaltyPublicCard";

const STYLES: LoyaltyCardStyle[] = ["classic", "modern", "minimal", "premium"];
const LAYOUTS: LoyaltyRewardLayout[] = ["list", "cards"];

function draftToPreviewDesign(draft: LoyaltyCardDesignDraft, shopName: string): LoyaltyCardDesign {
  return mergeDesignWithDefaults(
    {
      program_display_name: draft.programDisplayName.trim() || null,
      logo_url: normalizeLogoUrl(draft.logoUrl),
      primary_color: normalizeHexColor(draft.primaryColor),
      accent_color: normalizeHexColor(draft.accentColor),
      background_color: normalizeHexColor(draft.backgroundColor),
      text_color: normalizeHexColor(draft.textColor),
      welcome_message: draft.welcomeMessage.trim() || null,
      card_style: draft.cardStyle,
      reward_layout: draft.rewardLayout,
    },
    shopName,
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = !value.trim() || !!normalizeHexColor(value);
  return (
    <label className="block min-w-0 flex-1">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={normalizeHexColor(value) ?? DEFAULT_LOYALTY_CARD_DESIGN.primaryColor}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border border-border bg-card p-1"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#f59e0b"
          spellCheck={false}
          className={clsx(
            "min-h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold tabular-nums text-foreground",
            valid ? "border-border" : "border-destructive",
          )}
        />
      </div>
      {!valid ? (
        <p className="mt-1 text-xs font-bold text-destructive">Use #RRGGBB only</p>
      ) : null}
    </label>
  );
}

/**
 * Merchant Card Design editor (B2). Preview is local — no public API.
 */
export function LoyaltyCardDesignPanel({
  lang,
  shopId,
  shopName,
}: {
  lang: Language;
  shopId: string;
  shopName: string;
}) {
  const [draft, setDraft] = useState<LoyaltyCardDesignDraft>(() => defaultDraft(shopName));
  const [saved, setSaved] = useState<LoyaltyCardDesign | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [resetState, setResetState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    void fetchLoyaltyCardDesign(shopId).then((design) => {
      if (cancelled) return;
      if (design) {
        setSaved(design);
        setDraft(draftFromDesign(design));
      } else {
        setSaved(null);
        setDraft(defaultDraft(shopName));
      }
      setLoadState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, shopName]);

  const previewDesign = useMemo(
    () => draftToPreviewDesign(draft, shopName),
    [draft, shopName],
  );

  const previewCard: PublicCardData = useMemo(
    () => ({
      ...PREVIEW_PUBLIC_CARD_FIXTURE,
      shop_name: shopName.trim() || PREVIEW_PUBLIC_CARD_FIXTURE.shop_name,
      program_name:
        previewDesign.programDisplayName ||
        `${shopName.trim() || "Demo Shop"} Loyalty`,
      rewards: [...PREVIEW_PUBLIC_CARD_FIXTURE.rewards],
    }),
    [previewDesign.programDisplayName, shopName],
  );

  const validationError = validateDesignDraft(draft);

  const patch = (partial: Partial<LoyaltyCardDesignDraft>) => {
    setDraft((d) => ({ ...d, ...partial }));
    setSaveState("idle");
    setResetState("idle");
    setFormError(null);
  };

  const onSave = async () => {
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSaveState("saving");
    setFormError(null);
    const result = await saveLoyaltyCardDesign(shopId, draft);
    if (!result.ok) {
      setSaveState("error");
      setFormError(result.error);
      return;
    }
    setSaved(result.design);
    setDraft(draftFromDesign(result.design));
    setSaveState("done");
  };

  const onReset = async () => {
    const hasCustom = saved != null;
    if (hasCustom && !window.confirm(t(lang, "loyaltyDesignResetConfirm"))) return;
    setResetState("saving");
    setFormError(null);
    const result = await resetLoyaltyCardDesign(shopId);
    if (!result.ok) {
      setResetState("error");
      setFormError(result.error);
      return;
    }
    setSaved(null);
    setDraft(defaultDraft(shopName));
    setResetState("done");
    setSaveState("idle");
  };

  if (loadState === "loading") {
    return (
      <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
        {t(lang, "loyaltyLoading")}
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="space-y-4">
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-base font-black text-foreground">{t(lang, "loyaltyDesignBrandTitle")}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {t(lang, "loyaltyDesignBrandSub")}
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t(lang, "loyaltyDesignProgramName")}
            </span>
            <input
              type="text"
              value={draft.programDisplayName}
              maxLength={PROGRAM_NAME_MAX}
              onChange={(e) => patch({ programDisplayName: e.target.value })}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground"
            />
            <p className="mt-1 text-right text-[11px] font-medium text-muted-foreground">
              {draft.programDisplayName.trim().length}/{PROGRAM_NAME_MAX}
            </p>
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t(lang, "loyaltyDesignLogoUrl")}
            </span>
            <input
              type="url"
              value={draft.logoUrl}
              onChange={(e) => patch({ logoUrl: e.target.value })}
              placeholder="https://"
              spellCheck={false}
              className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground"
            />
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {t(lang, "loyaltyDesignLogoHint")}
            </p>
            {draft.logoUrl.trim() && !normalizeLogoUrl(draft.logoUrl) ? (
              <p className="mt-1 text-xs font-bold text-destructive">
                {t(lang, "loyaltyDesignLogoInvalid")}
              </p>
            ) : null}
          </label>
        </article>

        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-base font-black text-foreground">{t(lang, "loyaltyDesignColorsTitle")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ColorField
              label={t(lang, "loyaltyDesignPrimary")}
              value={draft.primaryColor}
              onChange={(v) => patch({ primaryColor: v })}
            />
            <ColorField
              label={t(lang, "loyaltyDesignAccent")}
              value={draft.accentColor}
              onChange={(v) => patch({ accentColor: v })}
            />
            <ColorField
              label={t(lang, "loyaltyDesignBackground")}
              value={draft.backgroundColor}
              onChange={(v) => patch({ backgroundColor: v })}
            />
            <ColorField
              label={t(lang, "loyaltyDesignText")}
              value={draft.textColor}
              onChange={(v) => patch({ textColor: v })}
            />
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-base font-black text-foreground">{t(lang, "loyaltyDesignWelcomeTitle")}</p>
          <textarea
            value={draft.welcomeMessage}
            maxLength={WELCOME_MESSAGE_MAX}
            rows={3}
            onChange={(e) => patch({ welcomeMessage: e.target.value })}
            className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground"
            placeholder={t(lang, "loyaltyDesignWelcomePlaceholder")}
          />
          <p className="mt-1 text-right text-[11px] font-medium text-muted-foreground">
            {draft.welcomeMessage.trim().length}/{WELCOME_MESSAGE_MAX}
          </p>
        </article>

        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-base font-black text-foreground">{t(lang, "loyaltyDesignStyleTitle")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => patch({ cardStyle: style })}
                className={clsx(
                  "min-h-11 rounded-xl border px-2 text-xs font-black capitalize",
                  draft.cardStyle === style
                    ? "border-waka-400 bg-waka-50 text-foreground"
                    : "border-border bg-background text-muted-foreground",
                )}
              >
                {style}
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm font-black text-foreground">
            {t(lang, "loyaltyDesignRewardLayoutTitle")}
          </p>
          <div className="mt-2 flex gap-2">
            {LAYOUTS.map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() => patch({ rewardLayout: layout })}
                className={clsx(
                  "min-h-11 flex-1 rounded-xl border px-3 text-xs font-black capitalize",
                  draft.rewardLayout === layout
                    ? "border-waka-400 bg-waka-50 text-foreground"
                    : "border-border bg-background text-muted-foreground",
                )}
              >
                {layout}
              </button>
            ))}
          </div>
        </article>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saveState === "saving" || !!validationError}
            onClick={() => void onSave()}
            className="min-h-11 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground disabled:opacity-50"
          >
            {saveState === "saving" ? t(lang, "loyaltyLoading") : t(lang, "loyaltyDesignSave")}
          </button>
          <button
            type="button"
            disabled={resetState === "saving"}
            onClick={() => void onReset()}
            className="min-h-11 rounded-2xl border border-border bg-card px-5 text-sm font-bold text-foreground disabled:opacity-50"
          >
            {resetState === "saving" ? t(lang, "loyaltyLoading") : t(lang, "loyaltyDesignReset")}
          </button>
          {saveState === "done" ? (
            <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
          ) : null}
          {resetState === "done" ? (
            <span className="text-sm font-bold text-success">{t(lang, "loyaltyDesignResetDone")}</span>
          ) : null}
          {saveState === "error" || resetState === "error" || formError ? (
            <span className="text-sm font-bold text-destructive">
              {t(lang, "loyaltyDesignSaveFailed")}
            </span>
          ) : null}
        </div>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {t(lang, "loyaltyDesignPreviewTitle")}
        </p>
        <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[2rem] border-[10px] border-stone-900 bg-stone-900 shadow-2xl">
          <div className="max-h-[70vh] overflow-y-auto bg-stone-50 px-1 pb-4">
            <PublicLoyaltyCardView
              card={previewCard}
              design={previewDesign}
              qrDataUrl={null}
              walletBusy={false}
              walletMessage={null}
              walletError={null}
              onAddToWallet={() => undefined}
              onSharePage={() => undefined}
              previewMode
            />
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] font-medium text-muted-foreground">
          {t(lang, "loyaltyDesignPreviewHint")}
        </p>
      </aside>
    </div>
  );
}
