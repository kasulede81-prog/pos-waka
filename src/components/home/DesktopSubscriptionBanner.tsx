import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useSubscription } from "../../context/SubscriptionContext";
import { resolveDesktopLicenseDisplay } from "../../lib/desktopLicenseDisplay";

type Props = { lang: Language };

export function DesktopSubscriptionBanner({ lang }: Props) {
  const { snapshot, authMode } = useSubscription();
  const license = resolveDesktopLicenseDisplay(snapshot, authMode);
  const upgradeTo = authMode === "supabase" ? "/upgrade" : "/settings";

  let headline = t(lang, "desktopHomeSubscriptionActive");
  if (license.status === "expired") {
    headline = t(lang, "desktopHomeSubscriptionExpired");
  } else if (license.status === "expiring_soon" && license.daysRemaining !== null) {
    headline = tTemplate(lang, "desktopHomeSubscriptionExpiring", {
      days: String(license.daysRemaining),
    });
  }

  const tone =
    license.status === "active"
      ? "border-emerald-300 bg-emerald-600 text-white shadow-[0_4px_20px_rgba(5,150,105,0.35)]"
      : license.status === "expiring_soon"
        ? "border-amber-300 bg-amber-500 text-amber-950 shadow-[0_4px_20px_rgba(245,158,11,0.4)]"
        : "border-rose-300 bg-rose-600 text-white shadow-[0_4px_20px_rgba(225,29,72,0.35)]";

  return (
    <Link
      to={upgradeTo}
      className={clsx(
        "mb-3 flex min-h-[52px] w-full items-center justify-center gap-3 rounded-2xl border-2 px-4 py-3 text-center transition-transform active:scale-[0.99] motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2",
        tone,
      )}
      aria-label={t(lang, "desktopHomeOpenLicense")}
    >
      <span
        className={clsx(
          "inline-block h-3 w-3 shrink-0 rounded-full",
          license.status === "active"
            ? "bg-emerald-200"
            : license.status === "expiring_soon"
              ? "bg-amber-950"
              : "bg-rose-200",
        )}
        aria-hidden
      />
      <span className="text-base font-black tracking-wide sm:text-lg">{headline}</span>
    </Link>
  );
}
