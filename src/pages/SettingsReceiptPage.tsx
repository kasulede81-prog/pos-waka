import { useMemo } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Navigate } from "react-router-dom";
import type { Language, ReceiptDisplayOptions, ReceiptHeaderConfig } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import {
  canHideWakaReceiptBranding,
  defaultReceiptDisplayOptions,
  padReceiptFooterSlots,
  resolveReceiptHeaderConfig,
} from "../lib/receiptBranding";
import { SettingsAutoSaveShell } from "../components/enterprise/SettingsAutoSaveShell";
import { usePreferencesPatch } from "../components/enterprise/preferencesAutoSaveContext";
import { ReceiptLivePreview } from "../components/settings/ReceiptLivePreview";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";

function ReceiptSettingsBody({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const savePreferences = usePreferencesPatch();
  const { snapshot, authMode } = useSubscription();
  const planTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);

  const displayOpts = useMemo(
    () => ({ ...defaultReceiptDisplayOptions(), ...preferences.receiptDisplayOptions }),
    [preferences.receiptDisplayOptions],
  );

  const header = resolveReceiptHeaderConfig(preferences);
  const footerLines = padReceiptFooterSlots(preferences.receiptFooterLines);
  const canHidePowered = canHideWakaReceiptBranding(planTier);

  const patchHeader = (patch: Partial<ReceiptHeaderConfig>) => {
    savePreferences({
      receiptHeader: { ...header, ...patch },
    });
  };

  const patchFooterLine = (index: number, value: string) => {
    const next = [...footerLines];
    next[index] = value;
    savePreferences({ receiptFooterLines: next });
  };

  const patchDisplay = (patch: Partial<ReceiptDisplayOptions>) => {
    savePreferences({
      receiptDisplayOptions: { ...displayOpts, ...patch },
    });
  };

  const inputClass =
    "mt-1 min-h-[48px] w-full rounded-2xl border-2 border-border px-4 text-base font-semibold text-foreground";

  const displayToggles: { key: keyof ReceiptDisplayOptions; labelKey: string }[] = [
    { key: "showCashier", labelKey: "settingsReceiptShowCashier" },
    { key: "showReceiptNumber", labelKey: "settingsReceiptShowReceiptNo" },
    { key: "showPaymentMethod", labelKey: "settingsReceiptShowPayment" },
    { key: "showCustomerName", labelKey: "settingsReceiptShowCustomer" },
    { key: "showCustomerPhone", labelKey: "settingsReceiptShowPhone" },
    { key: "showDebtInfo", labelKey: "settingsReceiptShowDebt" },
    { key: "showShopAddress", labelKey: "settingsReceiptShowAddress" },
    { key: "showShopPhone", labelKey: "settingsReceiptShowShopPhone" },
  ];

  return (
    <>
      <ReceiptLivePreview lang={lang} preferences={preferences} planTier={planTier} />

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-black text-foreground">{t(lang, "settingsReceiptHeaderSection")}</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-bold text-muted-foreground">
            {t(lang, "settingsReceiptBusinessName")}
            <input
              value={header.businessName}
              onChange={(e) => patchHeader({ businessName: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-bold text-muted-foreground">
            {t(lang, "settingsReceiptAddress")}
            <textarea
              rows={3}
              value={header.address}
              onChange={(e) => patchHeader({ address: e.target.value })}
              className={`${inputClass} min-h-[5.5rem] resize-y py-3 leading-snug`}
            />
            <span className="mt-1 block text-xs font-medium text-muted-foreground">
              {t(lang, "settingsReceiptAddressHint")}
            </span>
          </label>
          <label className="block text-sm font-bold text-muted-foreground">
            {t(lang, "settingsReceiptPhone")}
            <input
              value={header.phone}
              onChange={(e) => patchHeader({ phone: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-bold text-muted-foreground">
            {t(lang, "settingsReceiptEmail")}
            <input
              type="email"
              value={header.email}
              onChange={(e) => patchHeader({ email: e.target.value })}
              placeholder="info@shop.com"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-bold text-muted-foreground">
            {t(lang, "settingsReceiptTin")}
            <input
              value={header.tin}
              onChange={(e) => patchHeader({ tin: e.target.value.replace(/\D/g, "").slice(0, 16) })}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
        </div>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-black text-foreground">{t(lang, "settingsReceiptFooterSection")}</h2>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "settingsReceiptFooterLinesHint")}</p>
        <div className="mt-3 space-y-3">
          {footerLines.map((line, i) => (
            <label key={i} className="block text-sm font-bold text-muted-foreground">
              {tTemplate(lang, "settingsReceiptFooterLine", { n: String(i + 1) })}
              <input
                value={line}
                onChange={(e) => patchFooterLine(i, e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-black text-foreground">{t(lang, "settingsReceiptDisplaySection")}</h2>
        <ul className="mt-3 space-y-2">
          {displayToggles.map((opt) => (
            <li key={opt.key}>
              <WakaSwitch
                checked={displayOpts[opt.key]}
                onCheckedChange={(checked) => patchDisplay({ [opt.key]: checked })}
                label={t(lang, opt.labelKey)}
                className="rounded-xl border border-border px-3 py-2"
              />
            </li>
          ))}
        </ul>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <WakaSwitch
          checked={canHidePowered ? preferences.receiptShowPoweredByWaka !== false : true}
          disabled={!canHidePowered}
          onCheckedChange={(checked) => savePreferences({ receiptShowPoweredByWaka: checked })}
          label={t(lang, "settingsReceiptShowPowered")}
          description={!canHidePowered ? t(lang, "settingsReceiptPoweredLocked") : undefined}
        />
      </article>
    </>
  );
}

export function SettingsReceiptPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canEditReceipt = actorHasPermission(actor, "settings.receipt");

  if (!canEditReceipt) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <SettingsAutoSaveShell
      lang={lang}
      title={t(lang, "settingsReceiptBrandingTitle")}
      subtitle={t(lang, "settingsReceiptBrandingSub")}
    >
      <ReceiptSettingsBody lang={lang} />
    </SettingsAutoSaveShell>
  );
}
