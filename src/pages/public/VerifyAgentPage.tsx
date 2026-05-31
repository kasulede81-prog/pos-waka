import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BadgeCheck, Phone, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WAKA_MAIN_PRODUCT } from "../../config/company";
import { WakaSymbolIcon } from "../../components/brand/WakaLogo";
import { fetchAgentVerification, type AgentVerificationResult } from "../../lib/referralAgents";
import { SeoHead } from "../../components/marketing/SeoHead";

type Props = {
  lang: Language;
};

function formatVerifyDate(iso: string | null | undefined, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(lang === "lg" ? "en-UG" : "en-UG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function statusLabel(lang: Language, status: AgentVerificationResult["status"]): string {
  if (status === "active") return t(lang, "agentVerifyStatusActive");
  if (status === "suspended") return t(lang, "agentVerifyStatusSuspended");
  if (status === "expired") return t(lang, "agentVerifyStatusExpired");
  return "—";
}

function statusTone(status: AgentVerificationResult["status"]): string {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "suspended") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-rose-200 bg-rose-50 text-rose-950";
}

export function VerifyAgentPage({ lang }: Props) {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AgentVerificationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const row = await fetchAgentVerification(agentId);
      if (!cancelled) {
        setResult(row);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const notFound = !loading && result === null;
  const inactive = result != null && !result.isActive;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-orange-50 via-stone-50 to-white text-stone-900">
      <SeoHead
        title={`Verify Waka Agent | ${WAKA_MAIN_PRODUCT}`}
        description="Scan a Waka POS agent QR code to confirm the agent is registered and active."
        path={`/verify-agent/${agentId}`}
      />

      <header className="border-b border-stone-200/80 bg-white/90 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <WakaSymbolIcon size="xs" className="h-10 w-10 shrink-0" />
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-waka-700">{WAKA_MAIN_PRODUCT}</p>
            <p className="text-sm font-bold text-stone-600">{t(lang, "agentVerifyPageTitle")}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-6 pb-12">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-sm font-semibold text-stone-500">{t(lang, "agentVerifyLoading")}</p>
          </div>
        ) : null}

        {notFound ? (
          <article className="rounded-3xl border border-rose-200 bg-white p-6 text-center shadow-waka-sm">
            <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" aria-hidden />
            <h1 className="mt-4 text-xl font-black text-stone-950">{t(lang, "agentVerifyNotFoundTitle")}</h1>
            <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "agentVerifyNotFoundSub")}</p>
            <p className="mt-4 font-mono text-sm font-bold uppercase tracking-widest text-stone-400">{agentId}</p>
          </article>
        ) : null}

        {result ? (
          <article className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-waka-sm">
            {inactive ? (
              <div className="border-b border-rose-200 bg-rose-600 px-5 py-4 text-center">
                <p className="text-base font-black text-white">{t(lang, "agentVerifyNotActive")}</p>
              </div>
            ) : (
              <div className="border-b border-emerald-200 bg-gradient-to-r from-emerald-600 to-waka-600 px-5 py-4 text-center text-white">
                <BadgeCheck className="mx-auto h-8 w-8 opacity-95" aria-hidden />
                <p className="mt-1 text-sm font-black uppercase tracking-wide">{t(lang, "agentVerifyVerified")}</p>
              </div>
            )}

            <div className="space-y-5 p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">
                  {t(lang, "agentVerifyAgentName")}
                </p>
                <p className="mt-1 text-2xl font-black text-stone-950">{result.agentName}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-stone-100 bg-stone-50 px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
                    {t(lang, "agentVerifyAgentId")}
                  </p>
                  <p className="mt-1 font-mono text-sm font-black uppercase tracking-wider text-stone-900">
                    {result.referralCode}
                  </p>
                </div>
                <div className={`rounded-2xl border px-3 py-3 ${statusTone(result.status)}`}>
                  <p className="text-[10px] font-black uppercase tracking-wide opacity-80">
                    {t(lang, "agentVerifyStatus")}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-black">
                    {result.isActive ? (
                      <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    {statusLabel(lang, result.status)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-stone-100 bg-stone-50 px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
                    {t(lang, "agentVerifyIssueDate")}
                  </p>
                  <p className="mt-1 text-sm font-bold text-stone-900">{formatVerifyDate(result.issuedAt, lang)}</p>
                </div>
                <div className="rounded-2xl border border-stone-100 bg-stone-50 px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
                    {t(lang, "agentVerifyExpiryDate")}
                  </p>
                  <p className="mt-1 text-sm font-bold text-stone-900">{formatVerifyDate(result.expiresAt, lang)}</p>
                </div>
              </div>

              {result.phoneE164 ? (
                <div className="rounded-2xl border border-waka-100 bg-waka-50/60 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-waka-800">
                    {t(lang, "agentVerifyPhone")}
                  </p>
                  <a
                    href={`tel:${result.phoneE164}`}
                    className="mt-1 inline-flex items-center gap-2 text-base font-black text-waka-900"
                  >
                    <Phone className="h-4 w-4 shrink-0" aria-hidden />
                    {result.phoneE164}
                  </a>
                </div>
              ) : null}

              {!result.isActive ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
                  {t(lang, "agentVerifyInactiveHint")}
                </p>
              ) : null}
            </div>
          </article>
        ) : null}

        <p className="mt-8 text-center text-xs font-medium text-stone-500">
          {t(lang, "agentVerifyFooter")}{" "}
          <Link to="/home" className="font-bold text-waka-700 underline">
            {WAKA_MAIN_PRODUCT}
          </Link>
        </p>
      </main>
    </div>
  );
}
