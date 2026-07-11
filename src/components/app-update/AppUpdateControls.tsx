import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseUpdateEngine } from "../../lib/updateEngine/EnterpriseUpdateEngine";
import { shouldShowManualCheckToast } from "../../lib/updateEngine/UpdateNotifications";
import { useUpdateEngine } from "../../lib/updateEngine/useUpdateEngine";

type Props = {
  lang: Language;
};

export function PwaUpdateBanner({ lang }: Props) {
  const state = useUpdateEngine();
  if (state.phase !== "pwa_update") return null;

  return (
    <div className="z-40 shrink-0 border-b border-waka-200 bg-waka-50 px-3 py-2 text-center shadow-sm">
      <p className="text-sm font-bold text-waka-950">{t(lang, "pwaUpdateTitle")}</p>
      <button
        type="button"
        className="mt-1 rounded-full bg-waka-600 px-4 py-1.5 text-xs font-black text-white"
        onClick={() => EnterpriseUpdateEngine.reloadWebApp()}
      >
        {t(lang, "pwaUpdateCta")}
      </button>
    </div>
  );
}

type CheckProps = {
  lang: Language;
  onResult?: (message: string) => void;
};

export async function runManualUpdateCheck(lang: Language): Promise<string> {
  const state = await EnterpriseUpdateEngine.checkForUpdates();
  if (state.phase === "flexible_prompt" || state.phase === "force_block" || state.phase === "pwa_update") {
    return t(lang, "updateManualAvailable");
  }
  if (shouldShowManualCheckToast(state.phase)) {
    if (state.phase === "offline") return t(lang, "updateOfflineBody");
    if (state.phase === "update_failed") return t(lang, "updateFailedBody");
    return t(lang, "updateUpToDateBody");
  }
  return t(lang, "updateUpToDateBody");
}

export function AppUpdateCheckButton({ lang, onResult }: CheckProps) {
  return (
    <button
      type="button"
      className="min-h-[44px] rounded-2xl border border-border bg-card px-4 text-sm font-bold text-foreground"
      onClick={() => {
        void runManualUpdateCheck(lang).then((message) => onResult?.(message));
      }}
    >
      {t(lang, "updateCheckForUpdates")}
    </button>
  );
}
