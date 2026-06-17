import { Link, Navigate } from "react-router-dom";
import type { Language, ReceiptPaperSize } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import type { DiscountControlMode } from "../lib/discountGovernance";

const RECEIPT_PAPER_OPTIONS: ReceiptPaperSize[] = ["58mm", "80mm", "a4"];

function receiptPaperLabelKey(size: ReceiptPaperSize): string {
  if (size === "58mm") return "receiptPaperSize58";
  if (size === "80mm") return "receiptPaperSize80";
  return "receiptPaperSizeA4";
}

const DISCOUNT_MODES: DiscountControlMode[] = ["unrestricted", "max_percent", "manager_approval"];

function discountModeLabelKey(mode: DiscountControlMode): string {
  if (mode === "max_percent") return "settingsDiscountModeMaxPercent";
  if (mode === "manager_approval") return "settingsDiscountModeManagerApproval";
  return "settingsDiscountModeUnrestricted";
}

export function SettingsSellingPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const canArrangeShelves = hasPermission(actor.role, "shelves.customize");

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  const discountMode = preferences.discountControlMode ?? "unrestricted";

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubSelling")}
        subtitle={t(lang, "settingsHubSellingSub")}
      />

      {canArrangeShelves ? (
        <article id="sell-shelves" className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-base font-black text-stone-950">{t(lang, "stockShelfArrangeTitle")}</p>
          <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "stockShelfArrangeSub")}</p>
          <Link
            to="/settings/shelves"
            className="mt-4 inline-flex min-h-[48px] items-center rounded-2xl bg-waka-600 px-5 py-2.5 text-sm font-black text-white"
          >
            {t(lang, "officeCardShelfArrange")}
          </Link>
        </article>
      ) : null}

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "settingsDiscountTitle")}</p>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "settingsDiscountSub")}</p>
        <label className="mt-4 block text-sm font-bold text-slate-800">{t(lang, "settingsDiscountModeLabel")}</label>
        <select
          value={discountMode}
          onChange={(e) => setPreferences({ discountControlMode: e.target.value as DiscountControlMode })}
          className="mt-2 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-semibold"
        >
          {DISCOUNT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(lang, discountModeLabelKey(mode))}
            </option>
          ))}
        </select>
        {discountMode !== "unrestricted" ? (
          <label className="mt-4 block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "settingsDiscountMaxPercentLabel")}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={preferences.discountMaxPercentThreshold ?? 10}
              onChange={(e) =>
                setPreferences({
                  discountMaxPercentThreshold: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                })
              }
              className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-base font-semibold"
            />
          </label>
        ) : null}
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="flex min-h-[52px] cursor-pointer items-center gap-3 text-base font-bold text-slate-900">
          <input
            type="checkbox"
            checked={preferences.kioskQuickSell}
            onChange={(e) => setPreferences({ kioskQuickSell: e.target.checked })}
            className="h-6 w-6 rounded border-2 border-slate-400 accent-waka-600"
          />
          {t(lang, "kioskQuickSellLabel")}
        </label>
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "receiptPrintSettingsTitle")}</p>
        <label className="mt-4 block text-sm font-bold text-slate-800">{t(lang, "receiptPaperSizeLabel")}</label>
        <select
          value={preferences.receiptPaperSize ?? "80mm"}
          onChange={(e) => setPreferences({ receiptPaperSize: e.target.value as ReceiptPaperSize })}
          className="mt-2 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-semibold"
        >
          {RECEIPT_PAPER_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {t(lang, receiptPaperLabelKey(size))}
            </option>
          ))}
        </select>
      </article>
    </div>
  );
}
