import { Link, Navigate } from "react-router-dom";
import type { Language, ReceiptPaperSize } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";

const RECEIPT_PAPER_OPTIONS: ReceiptPaperSize[] = ["58mm", "80mm", "a4"];

function receiptPaperLabelKey(size: ReceiptPaperSize): string {
  if (size === "58mm") return "receiptPaperSize58";
  if (size === "80mm") return "receiptPaperSize80";
  return "receiptPaperSizeA4";
}

export function SettingsSellingPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubSelling")}
        subtitle={t(lang, "settingsHubSellingSub")}
      />

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
        <Link to="/office/hardware" className="mt-3 inline-block text-sm font-bold text-waka-800 underline">
          {t(lang, "receiptPrintHardwareLink")} →
        </Link>
      </article>
    </div>
  );
}
