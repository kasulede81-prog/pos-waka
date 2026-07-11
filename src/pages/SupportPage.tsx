import { Link } from "react-router-dom";
import { MessageCircle, Mail } from "lucide-react";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { MarketingLayout } from "../components/marketing/MarketingLayout";
import { SeoHead } from "../components/marketing/SeoHead";
import { WakaSupportCard } from "../components/support/WakaSupportCard";
import { PilotSupportCard } from "../components/settings/PilotSupportCard";
import { t } from "../lib/i18n";
import { useSubscription } from "../context/SubscriptionContext";
import { publicBrandHref, useAuthShellForPublicPage } from "../lib/nativeApp";
import { WAKA_SUPPORT_EMAILS, wakaSupportMailtoUrl, wakaSupportWhatsAppUrl } from "../config/wakaSupport";

const TOPIC_KEYS = [
  "supportTopic_setup",
  "supportTopic_staff",
  "supportTopic_backup",
  "supportTopic_subscription",
  "supportTopic_device",
  "supportTopic_reports",
  "supportTopic_restore",
  "supportTopic_sync",
] as const;

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
};

export function SupportPage({ lang, setLang, isAuthenticated }: Props) {
  const brandHref = publicBrandHref(isAuthenticated);
  const { userId } = useSubscription();

  const content = (
    <>
      <SeoHead
        title="Support — Waka POS by Waka Technologies"
        description="Get help with Waka POS: setup, plans, backup, staff, and devices. WhatsApp and email from Waka Technologies in Kampala, Uganda."
        path="/support"
        structuredData="contact"
      />
      <div className="rounded-3xl border border-border/80 bg-card p-6 shadow-waka-sm">
        <h1 className="text-2xl font-black text-foreground">{t(lang, "supportPageTitle")}</h1>
        <p className="mt-2 text-base font-medium text-muted-foreground">{t(lang, "supportPageSub")}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <a
            href={wakaSupportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl bg-[#25D366] px-4 py-4 text-center text-lg font-black text-white shadow-md active:scale-[0.99]"
          >
            <MessageCircle className="h-7 w-7" strokeWidth={2.25} aria-hidden />
            {t(lang, "supportWhatsAppCta")}
          </a>
          <a
            href={wakaSupportMailtoUrl()}
            className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-waka-200 bg-waka-50 px-4 py-4 text-center text-lg font-black text-waka-950 shadow-sm active:scale-[0.99]"
          >
            <Mail className="h-7 w-7 text-waka-700" strokeWidth={2.25} aria-hidden />
            {t(lang, "supportEmailCta")}
          </a>
        </div>

        <p className="mt-2 text-center text-xs font-semibold text-muted-foreground">{WAKA_SUPPORT_EMAILS.join(" · ")}</p>

        <p className="mt-6 rounded-2xl bg-muted px-4 py-3 text-sm font-medium text-muted-foreground">{t(lang, "supportHoursNote")}</p>

        <div className="mt-8">
          <p className="text-sm font-black uppercase tracking-wide text-waka-800/90">{t(lang, "supportTopicsTitle")}</p>
          <ul className="mt-3 space-y-2">
            {TOPIC_KEYS.map((key) => (
              <li
                key={key}
                className="rounded-2xl border border-border bg-muted/80 px-4 py-3 text-sm font-semibold text-foreground"
              >
                · {t(lang, key)}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">{t(lang, "supportTopicHint")}</p>
        </div>

        {isAuthenticated ? (
          <div className="mt-8">
            <PilotSupportCard lang={lang} userId={userId} />
          </div>
        ) : null}

        <div className="mt-8">
          <WakaSupportCard />
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border pt-6">
          {isAuthenticated ? (
            <Link to="/" className="text-center text-sm font-bold text-waka-800 underline">
              ← {t(lang, "upgradeBack")}
            </Link>
          ) : (
            <Link to={brandHref} className="text-center text-sm font-bold text-waka-800 underline">
              ← {brandHref === "/home" ? "Home" : t(lang, "marketingCtaLogin")}
            </Link>
          )}
        </div>
      </div>
    </>
  );

  if (useAuthShellForPublicPage(isAuthenticated)) {
    return (
      <AuthLayout lang={lang} setLang={setLang} brandHref={brandHref}>
        {content}
      </AuthLayout>
    );
  }

  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={false}>
      {content}
    </MarketingLayout>
  );
}
