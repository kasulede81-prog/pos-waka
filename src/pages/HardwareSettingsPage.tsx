import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Printer } from "lucide-react";
import type { Language, ReceiptPaperSize } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { printReceiptText } from "../lib/receiptPrint";

const PAPER_OPTIONS: ReceiptPaperSize[] = ["58mm", "80mm", "a4"];

function paperLabelKey(size: ReceiptPaperSize): string {
  if (size === "58mm") return "receiptPaperSize58";
  if (size === "80mm") return "receiptPaperSize80";
  return "receiptPaperSizeA4";
}

export function HardwareSettingsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [snap, setSnap] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getHardwareCapabilitySnapshot } = await import("../services/hardware/hardwareCapabilities");
      const c = await getHardwareCapabilitySnapshot();
      if (!cancelled) setSnap(JSON.stringify(c, null, 2));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const testPrint = () => {
    const sample = [
      preferences.shopDisplayName?.trim() || "Waka POS",
      "",
      t(lang, "receiptPaperTestLine"),
      "",
      "—",
      "Waka POS",
    ].join("\n");
    const ok = printReceiptText(sample, preferences.receiptPaperSize ?? "80mm");
    if (!ok) window.alert(t(lang, "receiptPrintBlocked"));
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-16 pt-2">
      <Link to="/office" className="text-sm font-bold text-waka-800 underline">
        ← {t(lang, "officeHubTitle")}
      </Link>
      <h1 className="text-3xl font-black text-stone-900">{t(lang, "hardwareSettingsTitle")}</h1>
      <p className="text-sm font-medium text-stone-600">{t(lang, "hardwareSettingsSub")}</p>

      <article className="rounded-3xl border-2 border-waka-100 bg-white p-5 shadow-waka-sm">
        <div className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-waka-700" aria-hidden />
          <p className="text-lg font-black text-stone-900">{t(lang, "receiptPrintSettingsTitle")}</p>
        </div>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "receiptPrintSettingsSub")}</p>
        <p className="mt-2 text-xs font-semibold text-stone-500">{t(lang, "receiptPrintAirPrintHint")}</p>
        <label className="mt-4 block text-sm font-bold text-stone-800">{t(lang, "receiptPaperSizeLabel")}</label>
        <select
          value={preferences.receiptPaperSize ?? "80mm"}
          onChange={(e) => setPreferences({ receiptPaperSize: e.target.value as ReceiptPaperSize })}
          className="mt-2 w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-base font-semibold"
        >
          {PAPER_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {t(lang, paperLabelKey(size))}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={testPrint}
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
        >
          {t(lang, "receiptPaperTestPrint")}
        </button>
      </article>

      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 font-mono text-xs text-stone-800">{snap || "—"}</div>
      <p className="text-xs text-stone-500">{t(lang, "hardwareSettingsStubHint")}</p>
    </div>
  );
}
