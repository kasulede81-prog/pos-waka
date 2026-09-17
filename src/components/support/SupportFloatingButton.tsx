import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Headset } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { supportFloatingBadgeLabel } from "../../lib/supportFloatingButton";

type Props = {
  lang: Language;
  /** Unread notifications + tickets waiting for the merchant. */
  attentionTotal: number;
  /** Extra bottom offset when a mobile bottom nav bar owns the edge. */
  lifted?: boolean;
};

/**
 * Persistent floating shortcut into the merchant Support Center.
 *
 * Design: a brand-gradient pill that stays a round FAB on touch devices and
 * gracefully expands to reveal its "Support" label on pointer hover (desktop).
 * An unread attention badge + a soft ping ring keep it alive without being
 * noisy; everything is pointer/keyboard accessible.
 */
export function SupportFloatingButton({ lang, attentionTotal, lifted = false }: Props) {
  const navigate = useNavigate();
  const badge = supportFloatingBadgeLabel(attentionTotal);
  const hasAttention = attentionTotal > 0;

  return (
    <button
      type="button"
      onClick={() => navigate("/support-center")}
      aria-label={t(lang, "supportFabAria")}
      title={t(lang, "supportCenterFabLabel")}
      className={clsx(
        "group fixed right-4 z-40 flex touch-manipulation items-center justify-center overflow-visible rounded-full",
        "bg-gradient-to-br from-waka-400 via-waka-500 to-orange-600 text-white shadow-xl shadow-waka-600/30 ring-1 ring-white/40",
        "transition-all duration-300 ease-out hover:shadow-2xl hover:shadow-waka-600/40 hover:ring-white/60",
        "active:scale-95 motion-safe:hover:-translate-y-0.5",
        "h-14 w-14 hover:w-auto hover:pl-4 hover:pr-5",
        lifted ? "bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))]" : "bottom-[calc(1.1rem+env(safe-area-inset-bottom,0px))]",
      )}
    >
      {hasAttention ? (
        <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-waka-400/50 motion-reduce:hidden" aria-hidden />
      ) : null}
      <Headset className="h-6 w-6 shrink-0 drop-shadow-sm" aria-hidden />
      <span
        className={clsx(
          "max-w-0 overflow-hidden whitespace-nowrap text-sm font-black tracking-tight opacity-0 transition-all duration-300",
          "group-hover:ml-2 group-hover:max-w-[6rem] group-hover:opacity-100",
        )}
      >
        {t(lang, "supportCenterFabLabel")}
      </span>
      {badge ? (
        <span
          className={clsx(
            "absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full",
            "bg-rose-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-background",
          )}
          aria-label={t(lang, "supportCenterUnreadBadge").replace("{count}", String(attentionTotal))}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
