import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { t } from "../lib/i18n";
import { useUiLanguage } from "../hooks/useUiLanguage";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";
import {
  fetchProgramPreview,
  isValidProgramCodeFormat,
  normalizeProgramCode,
  submitProgramJoin,
  type ProgramPreview,
} from "../lib/loyalty/loyaltyPublicProgram";

/**
 * Public program page: /j/:programCode — "Have a WAKA Loyalty Code?"
 *
 * The QR and the manual entry box both land here: the QR encodes this exact URL
 * (`buildProgramJoinUrl`), so scanning and typing cannot resolve to different programs.
 *
 * Sibling of `PublicLoyaltyJoinPage` rather than a branch inside it. The two share the
 * lookup/enrollment *path* — both go through an `loyalty-public-*` Edge Function into the same
 * server-side request pipeline — but their identity payloads differ, and threading a second
 * source through the production token page to save some markup would put working enrollment at
 * risk for no functional gain.
 *
 * Submitting queues a REQUEST a merchant must approve. No membership exists until they do, and
 * this page carries no customer identity: entering a code identifies the merchant, never the
 * person.
 */
export function PublicLoyaltyProgramPage() {
  const { lang } = useUiLanguage();
  const { programCode = "" } = useParams();
  const [searchParams] = useSearchParams();
  const code = normalizeProgramCode(programCode || searchParams.get("code") || "");

  const [preview, setPreview] = useState<ProgramPreview | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isValidProgramCodeFormat(code)) {
      setPreview({ ok: false, error: "not_found" });
      return;
    }
    void (async () => {
      const result = await fetchProgramPreview(code);
      if (!cancelled) setPreview(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const submit = async () => {
    setError(null);
    setAlreadyMember(false);
    const normalized = normalizeUgPhoneE164(phone);
    if (!normalized) {
      setError("invalid_phone");
      return;
    }
    if (!consent) {
      setError("consent_required");
      return;
    }
    setBusy(true);
    try {
      const result = await submitProgramJoin({ code, name, phone, email, consent });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.status === "already_member") setAlreadyMember(true);
      else setRequestSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (!preview) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
      </div>
    );
  }

  if (!preview.ok) {
    const msg =
      preview.error === "rate_limited"
        ? t(lang, "loyaltyJoinRateLimited")
        : preview.error === "unavailable"
          ? t(lang, "loyaltyJoinUnavailable")
          : t(lang, "loyaltyJoinNotFound");
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-black text-foreground">{t(lang, "loyaltyJoinTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{msg}</p>
        <Link to="/login" className="mt-6 inline-block text-xs font-bold text-waka-700">
          {t(lang, "signIn")}
        </Link>
      </div>
    );
  }

  const closed = !preview.enabled;

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 py-10">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t(lang, "loyaltyJoinEyebrow")}
        </p>
        <h1 className="mt-1 text-center text-2xl font-black text-foreground">{preview.shopName}</h1>
        <p className="mt-2 text-center text-sm font-medium text-muted-foreground">
          {preview.programName}
          {preview.district ? ` · ${preview.district}` : ""}
        </p>
        <p className="mt-3 text-center font-mono text-xs font-black uppercase tracking-widest text-muted-foreground">
          {t(lang, "loyaltyProgramCodeLabel")}: {preview.code}
        </p>

        {closed ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm font-bold text-amber-950">{t(lang, "loyaltyProgramClosed")}</p>
          </div>
        ) : alreadyMember ? (
          <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4 text-center">
            <p className="text-sm font-bold text-foreground">{t(lang, "loyaltyJoinAlreadyMember")}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {t(lang, "loyaltyJoinAlreadyMemberHint")}
            </p>
          </div>
        ) : requestSent ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-sm font-black text-emerald-950">{t(lang, "loyaltyJoinRequestSent")}</p>
            <p className="mt-1 text-xs font-medium text-emerald-900">
              {t(lang, "loyaltyJoinRequestSentHint")}
            </p>
          </div>
        ) : (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block text-xs font-bold text-muted-foreground">
              {t(lang, "loyaltyJoinName")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-background px-3 text-sm font-semibold"
              />
            </label>
            <label className="block text-xs font-bold text-muted-foreground">
              {t(lang, "loyaltyJoinPhone")}
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                inputMode="tel"
                placeholder="07…"
                className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-background px-3 text-sm font-semibold"
              />
            </label>
            <label className="block text-xs font-bold text-muted-foreground">
              {t(lang, "loyaltyJoinEmailOptional")}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-background px-3 text-sm font-semibold"
              />
            </label>
            <label className="flex items-start gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t(lang, "loyaltyJoinConsent")}</span>
            </label>
            <p className="text-xs font-medium text-muted-foreground">
              {t(lang, "loyaltyJoinApprovalNote")}
            </p>
            {error ? (
              <p className="text-sm font-bold text-destructive">
                {error === "account_revoked"
                  ? t(lang, "loyaltyJoinRevoked")
                  : error === "consent_required"
                    ? t(lang, "loyaltyJoinConsentRequired")
                    : error === "invalid_phone"
                      ? t(lang, "loyaltyJoinInvalidPhone")
                      : error === "rate_limited"
                        ? t(lang, "loyaltyJoinRateLimited")
                        : t(lang, "loyaltyJoinFailed")}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="min-h-[48px] w-full rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
            >
              {busy ? t(lang, "loyaltyLoading") : t(lang, "loyaltyJoinSubmitRequest")}
            </button>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-[10px] font-medium text-muted-foreground">WAKA Loyalty</p>
    </div>
  );
}

export default PublicLoyaltyProgramPage;
