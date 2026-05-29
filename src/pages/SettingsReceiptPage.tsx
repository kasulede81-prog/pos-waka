import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { resolveReceiptBranding } from "../lib/receiptBranding";

export function SettingsReceiptPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  const branding = resolveReceiptBranding(preferences);

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsReceiptTitle")}
        subtitle={t(lang, "settingsReceiptSub")}
      />

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-black text-stone-900">{t(lang, "settingsReceiptHeaderLabel")}</label>
        <p className="mt-1 text-xs font-medium leading-relaxed text-stone-600">{t(lang, "settingsReceiptHeaderHint")}</p>
        <textarea
          value={preferences.receiptCustomHeaderText ?? ""}
          onChange={(e) => setPreferences({ receiptCustomHeaderText: e.target.value || null })}
          rows={4}
          placeholder={[
            preferences.shopDisplayName?.trim() || "My Shop",
            preferences.shopAddressLine?.trim(),
            preferences.shopPhoneE164?.trim(),
          ]
            .filter(Boolean)
            .join("\n")}
          className="mt-3 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-semibold text-stone-900"
        />
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-black text-stone-900">{t(lang, "settingsReceiptFooterLabel")}</label>
        <p className="mt-1 text-xs font-medium leading-relaxed text-stone-600">{t(lang, "settingsReceiptFooterHint")}</p>
        <textarea
          value={preferences.receiptCustomFooterText ?? ""}
          onChange={(e) => setPreferences({ receiptCustomFooterText: e.target.value || null })}
          rows={3}
          placeholder={branding.footerThanks}
          className="mt-3 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-semibold text-stone-900"
        />
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-black text-stone-900">{t(lang, "settingsReceiptPolicyLabel")}</label>
        <p className="mt-1 text-xs font-medium leading-relaxed text-stone-600">{t(lang, "settingsReceiptPolicyHint")}</p>
        <textarea
          value={preferences.receiptReturnPolicyText ?? ""}
          onChange={(e) => setPreferences({ receiptReturnPolicyText: e.target.value })}
          rows={2}
          placeholder={t(lang, "settingsReceiptPolicyPlaceholder")}
          className="mt-3 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-semibold text-stone-900"
        />
      </article>
    </div>
  );
}
