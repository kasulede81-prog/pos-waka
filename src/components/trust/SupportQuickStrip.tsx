import { Link } from "react-router-dom";
import { ChevronDown, LifeBuoy, MessageCircle } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { wakaSupportWhatsAppUrl } from "../../config/wakaSupport";

type Props = { lang: Language };

/** Collapsible Waka help — shop settings only (keeps home/stock lists uncluttered). */
export function SupportQuickStrip({ lang }: Props) {
  return (
    <details className="group rounded-2xl border border-waka-200/90 bg-gradient-to-br from-waka-50 to-card shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-waka-100 text-waka-800">
          <LifeBuoy className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-foreground">{t(lang, "supportQuickTitle")}</p>
          <p className="mt-0.5 text-sm font-medium text-muted-foreground">{t(lang, "supportQuickExpandHint")}</p>
        </div>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-waka-800 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-waka-100/90 px-4 pb-4 pt-3">
        <p className="text-sm font-medium text-muted-foreground">{t(lang, "supportQuickSub")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a
            href={wakaSupportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-black text-white shadow-sm"
          >
            <MessageCircle className="h-5 w-5" aria-hidden />
            {t(lang, "supportWhatsAppCta")}
          </a>
          <Link
            to="/support"
            className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border-2 border-waka-200 bg-card px-4 text-sm font-black text-waka-950"
          >
            {t(lang, "supportQuickMore")}
          </Link>
        </div>
      </div>
    </details>
  );
}
