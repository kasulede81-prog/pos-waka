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
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { ReceiptLivePreview } from "../components/settings/ReceiptLivePreview";

export function SettingsReceiptPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const { snapshot, authMode } = useSubscription();
  const planTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const canEditReceipt = actorHasPermission(actor, "settings.receipt");

  const displayOpts = useMemo(
    () => ({ ...defaultReceiptDisplayOptions(), ...preferences.receiptDisplayOptions }),
    [preferences.receiptDisplayOptions],
  );

  if (!canEditReceipt) {
    return <Navigate to="/settings" replace />;
  }

  const header = resolveReceiptHeaderConfig(preferences);
  const footerLines = padReceiptFooterSlots(preferences.receiptFooterLines);
  const canHidePowered = canHideWakaReceiptBranding(planTier);

  const patchHeader = (patch: Partial<ReceiptHeaderConfig>) => {
    setPreferences({
      receiptHeader: { ...header, ...patch },
    });
  };

  const patchFooterLine = (index: number, value: string) => {
    const next = [...footerLines];
    next[index] = value;
    setPreferences({ receiptFooterLines: next });
  };

  const patchDisplay = (patch: Partial<ReceiptDisplayOptions>) => {
    setPreferences({
      receiptDisplayOptions: { ...displayOpts, ...patch },
    });
  };

  const inputClass =
    "mt-1 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-semibold text-stone-900";

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
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsReceiptBrandingTitle")}
        subtitle={t(lang, "settingsReceiptBrandingSub")}
      />

      <ReceiptLivePreview lang={lang} preferences={preferences} planTier={planTier} />

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-900">{t(lang, "settingsReceiptHeaderSection")}</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "settingsReceiptBusinessName")}
            <input
              value={header.businessName}
              onChange={(e) => patchHeader({ businessName: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "settingsReceiptAddress")}
            <textarea
              rows={3}
              value={header.address}
              onChange={(e) => patchHeader({ address: e.target.value })}
              className={`${inputClass} min-h-[5.5rem] resize-y py-3 leading-snug`}
            />
            <span className="mt-1 block text-xs font-medium text-stone-500">
              {t(lang, "settingsReceiptAddressHint")}
            </span>
          </label>
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "settingsReceiptPhone")}
            <input
              value={header.phone}
              onChange={(e) => patchHeader({ phone: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "settingsReceiptEmail")}
            <input
              type="email"
              value={header.email}
              onChange={(e) => patchHeader({ email: e.target.value })}
              placeholder="info@shop.com"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-bold text-stone-700">
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

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-900">{t(lang, "settingsReceiptFooterSection")}</h2>
        <p className="mt-1 text-xs font-medium text-stone-500">{t(lang, "settingsReceiptFooterLinesHint")}</p>
        <div className="mt-3 space-y-3">
          {footerLines.map((line, i) => (
            <label key={i} className="block text-sm font-bold text-stone-700">
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

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-900">{t(lang, "settingsReceiptDisplaySection")}</h2>
        <ul className="mt-3 space-y-2">
          {displayToggles.map((opt) => (
            <li key={opt.key}>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-stone-100 px-3">
                <input
                  type="checkbox"
                  checked={displayOpts[opt.key]}
                  onChange={(e) => patchDisplay({ [opt.key]: e.target.checked })}
                  className="h-5 w-5 accent-waka-600"
                />
                <span className="text-sm font-semibold text-stone-800">{t(lang, opt.labelKey)}</span>
              </label>
            </li>
          ))}
        </ul>
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="flex min-h-[48px] cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={canHidePowered ? preferences.receiptShowPoweredByWaka !== false : true}
            disabled={!canHidePowered}
            onChange={(e) => setPreferences({ receiptShowPoweredByWaka: e.target.checked })}
            className="mt-1 h-5 w-5 accent-waka-600"
          />
          <span>
            <span className="text-sm font-black text-stone-900">{t(lang, "settingsReceiptShowPowered")}</span>
            {!canHidePowered ? (
              <span className="mt-1 block text-xs font-medium text-stone-500">
                {t(lang, "settingsReceiptPoweredLocked")}
              </span>
            ) : null}
          </span>
        </label>
      </article>
    </div>
  );
}
