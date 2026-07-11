import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle, X, LifeBuoy, Mail } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { wakaSupportMailtoUrl, wakaSupportWhatsAppUrl } from "../../config/wakaSupport";
import { isBackOfficePath } from "../../lib/backOfficePaths";

type Props = { lang: Language };

/**
 * Mobile-first floating help: WhatsApp, email, full support page.
 * Hidden on Sell screen and internal admin routes to reduce distraction.
 */
export function FloatingSupportFab({ lang }: Props) {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (
    location.pathname.startsWith("/pos") ||
    location.pathname.startsWith("/internal/") ||
    isBackOfficePath(location.pathname)
  ) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.5rem)] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-[35] lg:bottom-8 lg:right-6">
      {open ? (
        <div className="pointer-events-auto mb-3 w-[min(100vw-2rem,20rem)] rounded-3xl border border-waka-100 bg-card p-4 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black text-foreground">{t(lang, "supportFabTitle")}</p>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground"
              onClick={() => setOpen(false)}
              aria-label={t(lang, "cancel")}
            >
              <X className="h-5 w-5" strokeWidth={2.25} />
            </button>
          </div>
          <a
            href={wakaSupportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3 text-base font-black text-white shadow-md"
            onClick={() => setOpen(false)}
          >
            <MessageCircle className="h-5 w-5" strokeWidth={2.25} />
            {t(lang, "supportWhatsAppCta")}
          </a>
          <a
            href={wakaSupportMailtoUrl()}
            className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card px-4 py-3 text-base font-black text-foreground"
            onClick={() => setOpen(false)}
          >
            <Mail className="h-5 w-5" strokeWidth={2.25} />
            {t(lang, "supportEmailCta")}
          </a>
          <Link
            to="/support"
            className="mt-2 flex min-h-[44px] items-center justify-center rounded-2xl bg-waka-50 px-4 py-2 text-sm font-bold text-waka-950"
            onClick={() => setOpen(false)}
          >
            {t(lang, "supportFabFullHelp")}
          </Link>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-waka-400 to-waka-600 text-white shadow-lg shadow-waka-500/30 ring-2 ring-white/80 active:scale-95 lg:h-16 lg:w-16"
        aria-expanded={open}
        aria-label={t(lang, "supportFabAria")}
      >
        <LifeBuoy className="h-7 w-7 lg:h-8 lg:w-8" strokeWidth={2.25} />
      </button>
    </div>
  );
}
