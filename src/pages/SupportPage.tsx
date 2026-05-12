import { Link } from "react-router-dom";
import { MessageCircle, Mail } from "lucide-react";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import { WAKA_SUPPORT_EMAIL, wakaSupportMailtoUrl, wakaSupportWhatsAppUrl } from "../config/wakaSupport";
import { useSubscription } from "../context/SubscriptionContext";
import { normalizePlanCode, planCodeHasWhatsappManager } from "../lib/subscriptionEntitlements";

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
  const brandHref = isAuthenticated ? "/" : "/login";
  const { snapshot, authMode, loading } = useSubscription();
  const showWhatsAppManager =
    authMode === "local" ||
    loading ||
    snapshot.kind !== "remote" ||
    planCodeHasWhatsappManager(normalizePlanCode(snapshot.row.plan_code));

  return (
    <AuthLayout lang={lang} setLang={setLang} brandHref={brandHref}>
      <div className="rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
        <h1 className="text-2xl font-black text-stone-900">{t(lang, "supportPageTitle")}</h1>
        <p className="mt-2 text-base font-medium text-stone-600">{t(lang, "supportPageSub")}</p>

        {isAuthenticated && authMode === "supabase" && !loading && snapshot.kind === "remote" ? (
          <p className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-800 ring-1 ring-stone-100">
            {t(lang, "supportWhatsAppTierNote")}
          </p>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {showWhatsAppManager ? (
            <a
              href={wakaSupportWhatsAppUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl bg-[#25D366] px-4 py-4 text-center text-lg font-black text-white shadow-md active:scale-[0.99]"
            >
              <MessageCircle className="h-7 w-7" strokeWidth={2.25} aria-hidden />
              {t(lang, "supportWhatsAppCta")}
            </a>
          ) : (
            <div className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50 px-4 py-4 text-center">
              <MessageCircle className="h-7 w-7 text-stone-400" strokeWidth={2.25} aria-hidden />
              <p className="text-sm font-black text-stone-700">{t(lang, "supportWhatsAppStarterHint")}</p>
            </div>
          )}
          <a
            href={wakaSupportMailtoUrl()}
            className="flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-orange-200 bg-orange-50 px-4 py-4 text-center text-lg font-black text-orange-950 shadow-sm active:scale-[0.99]"
          >
            <Mail className="h-7 w-7 text-orange-700" strokeWidth={2.25} aria-hidden />
            {t(lang, "supportEmailCta")}
          </a>
        </div>

        <p className="mt-2 text-center text-xs font-semibold text-stone-500">{WAKA_SUPPORT_EMAIL}</p>

        <p className="mt-6 rounded-2xl bg-stone-50 px-4 py-3 text-sm font-medium text-stone-700">{t(lang, "supportHoursNote")}</p>

        <div className="mt-8">
          <p className="text-sm font-black uppercase tracking-wide text-orange-800/90">{t(lang, "supportTopicsTitle")}</p>
          <ul className="mt-3 space-y-2">
            {TOPIC_KEYS.map((key) => (
              <li
                key={key}
                className="rounded-2xl border border-stone-100 bg-stone-50/80 px-4 py-3 text-sm font-semibold text-stone-800"
              >
                · {t(lang, key)}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-stone-600">{t(lang, "supportTopicHint")}</p>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-stone-100 pt-6">
          {isAuthenticated ? (
            <Link to="/" className="text-center text-sm font-bold text-waka-800 underline">
              ← {t(lang, "upgradeBack")}
            </Link>
          ) : (
            <Link to="/login" className="text-center text-sm font-bold text-waka-800 underline">
              ← {t(lang, "backToLogin")}
            </Link>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
