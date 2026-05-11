import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";

export function HardwareSettingsPage({ lang }: { lang: Language }) {
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

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 pb-16 pt-2">
      <Link to="/office" className="text-sm font-bold text-waka-800 underline">
        ← {t(lang, "officeHubTitle")}
      </Link>
      <h1 className="text-3xl font-black text-stone-900">{t(lang, "hardwareSettingsTitle")}</h1>
      <p className="text-sm font-medium text-stone-600">{t(lang, "hardwareSettingsSub")}</p>
      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 font-mono text-xs text-stone-800">{snap || "—"}</div>
      <p className="text-xs text-stone-500">{t(lang, "hardwareSettingsStubHint")}</p>
    </div>
  );
}
