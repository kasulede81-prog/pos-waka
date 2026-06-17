import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import {
  desktopPlanLabelKey,
  formatDesktopLicenseDate,
  resolveDesktopLicenseDisplay,
} from "../../lib/desktopLicenseDisplay";
import { WakaPosLogo } from "../brand/WakaLogo";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";

const APP_VERSION = import.meta.env.VITE_APP_VERSION?.trim() || "1.0.6";

type Props = { lang: Language };

export function DesktopLicenseBar({ lang }: Props) {
  const { snapshot, authMode } = useSubscription();
  const sync = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const synced = sync.pendingCount === 0 && syncErrors === 0;
  const license = resolveDesktopLicenseDisplay(snapshot, authMode);
  const planLabel = t(lang, desktopPlanLabelKey(license.planTier) as "planFreeName");
  const productLine = tTemplate(lang, "desktopHomeLicenseProduct", { plan: planLabel });

  let detailLine = tTemplate(lang, "desktopHomeLicenseActiveUntil", {
    date: license.expiryAt ? formatDesktopLicenseDate(license.expiryAt, lang) : "—",
  });
  if (license.status === "expired") {
    detailLine = t(lang, "desktopHomeLicenseExpired");
  } else if (license.status === "expiring_soon" && license.daysRemaining !== null) {
    detailLine = tTemplate(lang, "desktopHomeLicenseExpiringSoon", {
      days: String(license.daysRemaining),
    });
  } else if (!license.expiryAt && authMode === "local") {
    detailLine = t(lang, "desktopHomeLicenseLocalFull");
  } else if (license.status === "active" && !license.expiryAt) {
    detailLine = t(lang, "desktopHomeLicenseActive");
  }

  const upgradeTo = authMode === "supabase" ? "/upgrade" : "/settings";

  return (
    <Link
      to={upgradeTo}
      className="group flex min-h-[72px] w-full flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-waka-200 bg-white px-5 py-4 shadow-waka-sm transition-colors hover:border-waka-400 hover:bg-waka-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
      aria-label={t(lang, "desktopHomeOpenLicense")}
    >
      <div className="flex min-w-0 items-center gap-4">
        <WakaPosLogo size="sm" variant="symbol" className="h-10 w-10 shrink-0" />
        <div className="min-w-0 text-left">
          <p className="truncate text-base font-black text-waka-950">{productLine}</p>
          <p className="mt-0.5 text-sm font-semibold text-waka-800/80">{detailLine}</p>
        </div>
      </div>
      <div className="min-w-0 text-right text-sm font-semibold text-waka-800/70">
        <p>{synced ? t(lang, "desktopHomeStoreSynced") : t(lang, "desktopHomeStatusSyncPending")}</p>
        {license.deviceLimit !== null ? (
          <p className="mt-0.5 text-xs text-waka-700/60">
            {tTemplate(lang, "desktopHomeDeviceLimit", { count: String(license.deviceLimit) })}
          </p>
        ) : null}
        <p className="mt-1 text-xs font-bold text-waka-600/70">
          {tTemplate(lang, "desktopHomeVersion", { version: APP_VERSION })}
        </p>
      </div>
    </Link>
  );
}
