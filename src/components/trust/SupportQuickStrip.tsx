import { Link } from "react-router-dom";
import { LifeBuoy, MessageCircle } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { wakaSupportWhatsAppUrl } from "../../config/wakaSupport";

type Props = { lang: Language; compact?: boolean };

/** One-tap help: WhatsApp + full help page. No diagnostics required. */
export function SupportQuickStrip({ lang, compact }: Props) {
  return (
    <section
      className={`rounded-2xl border border-orange-200/90 bg-gradient-to-br from-orange-50 to-white shadow-sm ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-800">
          <LifeBuoy className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-stone-900">{t(lang, "supportQuickTitle")}</p>
          {!compact ? <p className="mt-0.5 text-sm font-medium text-stone-600">{t(lang, "supportQuickSub")}</p> : null}
        </div>
      </div>
      <div className={`grid gap-2 ${compact ? "mt-3" : "mt-4"} sm:grid-cols-2`}>
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
          className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border-2 border-orange-200 bg-white px-4 text-sm font-black text-orange-950"
        >
          {t(lang, "supportQuickMore")}
        </Link>
      </div>
    </section>
  );
}
