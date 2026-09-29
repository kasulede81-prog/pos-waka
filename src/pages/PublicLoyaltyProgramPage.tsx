import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { t } from "../lib/i18n";
import { useUiLanguage } from "../hooks/useUiLanguage";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import { fetchMemberDashboard } from "../lib/memberDashboard";
import { becomeLoyaltyMember } from "../lib/memberRegistration";
import { joinLoyaltyProgramByCode, memberJoinErrorText } from "../lib/loyalty/loyaltyMemberJoin";
import {
  fetchProgramPreview,
  isValidProgramCodeFormat,
  normalizeProgramCode,
  submitProgramJoin,
  type ProgramPreview,
} from "../lib/loyalty/loyaltyPublicProgram";
import { storePendingProgramCode } from "../lib/pendingLoyaltyProgram";

/**
 * Public program page: /j/:programCode — "Have a WAKA Loyalty Code?"
 *
 * Two enrollment paths live here, deliberately side by side and clearly separated:
 *
 *   ANONYMOUS   code → name + phone → merchant approval → Phase 2A links by phone.
 *               Unchanged. It is what production runs today.
 *   AUTHENTICATED
 *               code → Google → auth.uid() → loyalty_members → member_id
 *                    → merchant approval → Phase 2A links by IDENTITY.
 *
 * Both end in the SAME pending enrollment request a merchant must approve. Google authentication
 * decides who asked, never whether they may join — and it is never allowed to create a member or a
 * workspace on its own.
 *
 * The QR encodes this exact URL, so scanning and typing resolve to the same page.
 */

type Props = {
  isAuthenticated: boolean;
  onGoogleLogin: () => Promise<void>;
};

type MemberState =
  | { kind: "checking" }
  | { kind: "anonymous" }
  | { kind: "member"; displayName: string | null }
  | { kind: "not_member" }
  | { kind: "unknown" };

export function PublicLoyaltyProgramPage({ isAuthenticated, onGoogleLogin }: Props) {
  const { lang } = useUiLanguage();
  const { programCode = "" } = useParams();
  const [searchParams] = useSearchParams();
  const code = normalizeProgramCode(programCode || searchParams.get("code") || "");

  const [preview, setPreview] = useState<ProgramPreview | null>(null);
  const [member, setMember] = useState<MemberState>({ kind: "checking" });

  // Anonymous path — untouched.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  // Authenticated path.
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinDone, setJoinDone] = useState<"pending" | "already_member" | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);

  const showGoogle = hasSupabaseConfig && isGoogleAuthUiAvailable();

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

  /**
   * Identify the signed-in person from the SERVER, never from anything stored. `not_a_member` is
   * the only failure that means "no member row" — a network failure is `unknown`, and is shown as
   * such rather than silently offering to register someone who may already be a member.
   */
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setMember({ kind: "anonymous" });
      return;
    }
    setMember({ kind: "checking" });
    void (async () => {
      const r = await fetchMemberDashboard();
      if (cancelled) return;
      if (r.ok) {
        const displayName = r.data.member.displayName;
        setMember({ kind: "member", displayName });
        setProfileName((prev) => prev || (displayName ?? ""));
      } else if (r.error === "not_a_member") {
        setMember({ kind: "not_member" });
      } else {
        setMember({ kind: "unknown" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  /** Google CTA — store the CODE ONLY, then hand off to the existing sign-in flow. */
  const googleSubmit = async () => {
    if (googleBusy || busy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      storePendingProgramCode(code);
      await onGoogleLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in did not work. Please try again.");
    } finally {
      setGoogleBusy(false);
    }
  };

  /** Authenticated join. Sends the code and nothing else — the RPC derives the member. */
  const runJoin = async () => {
    setJoinBusy(true);
    setJoinError(null);
    const r = await joinLoyaltyProgramByCode(code);
    setJoinBusy(false);
    if (!r.ok) {
      setJoinError(memberJoinErrorText(r.error));
      return;
    }
    setJoinDone(r.status);
  };

  /** A signed-in person with no member row yet: build the profile, then join in one step. */
  const createProfileThenJoin = async () => {
    setJoinBusy(true);
    setJoinError(null);
    const created = await becomeLoyaltyMember({ displayName: profileName, phone: profilePhone });
    if (!created.ok) {
      setJoinBusy(false);
      setJoinError(
        created.error === "invalid_phone"
          ? t(lang, "loyaltyJoinInvalidPhone")
          : created.error === "invalid_name"
            ? t(lang, "loyaltyJoinName")
            : "We could not create your Loyalty profile. Please try again.",
      );
      return;
    }
    const r = await joinLoyaltyProgramByCode(code);
    setJoinBusy(false);
    if (!r.ok) {
      setJoinError(memberJoinErrorText(r.error));
      return;
    }
    setJoinDone(r.status);
    setMember({ kind: "member", displayName: profileName.trim() || null });
  };

  // ---------------------------------------------------------------- anonymous
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
  const joined = joinDone !== null;

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
        ) : joined ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-sm font-black text-emerald-950">
              {joinDone === "already_member"
                ? t(lang, "loyaltyJoinAlreadyMember")
                : t(lang, "loyaltyJoinRequestSent")}
            </p>
            <p className="mt-1 text-xs font-medium text-emerald-900">
              {joinDone === "already_member"
                ? t(lang, "loyaltyJoinAlreadyMemberHint")
                : t(lang, "loyaltyJoinRequestSentHint")}
            </p>
          </div>
        ) : member.kind === "checking" ? (
          <p className="mt-6 text-center text-sm font-medium text-muted-foreground">
            {t(lang, "loyaltyLoading")}
          </p>
        ) : member.kind === "member" || member.kind === "not_member" ? (
          /* ---------------------------------------------------- AUTHENTICATED */
          <div className="mt-6 space-y-3">
            {member.kind === "member" ? (
              <>
                <p className="text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t(lang, "loyaltyJoinEyebrow")}
                </p>
                <p className="text-center text-sm font-bold text-foreground">
                  {member.displayName ?? ""}
                </p>
                <button
                  type="button"
                  onClick={() => void runJoin()}
                  disabled={joinBusy}
                  data-testid="loyalty-program-join"
                  className="min-h-[48px] w-full rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
                >
                  {joinBusy ? t(lang, "loyaltyLoading") : t(lang, "loyaltyJoinSubmitRequest")}
                </button>
              </>
            ) : (
              /* No member row yet. The profile is created HERE, as part of the explicit join —
                 never automatically because Google authentication succeeded. */
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createProfileThenJoin();
                }}
              >
                <p className="text-sm font-bold text-foreground">Join {preview.shopName}</p>
                <label className="block text-xs font-bold text-muted-foreground">
                  {t(lang, "loyaltyJoinName")}
                  <input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={120}
                    data-testid="loyalty-program-profile-name"
                    className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-background px-3 text-sm font-semibold"
                  />
                </label>
                <label className="block text-xs font-bold text-muted-foreground">
                  {t(lang, "loyaltyJoinPhone")}
                  <input
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    required
                    inputMode="tel"
                    placeholder="07…"
                    data-testid="loyalty-program-profile-phone"
                    className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-background px-3 text-sm font-semibold"
                  />
                  <span className="mt-1 block text-[11px] font-medium leading-relaxed text-muted-foreground">
                    WAKA shops match your loyalty cards by phone number, so it is required to join.
                  </span>
                </label>
                {joinError ? (
                  <p role="alert" className="text-sm font-bold text-destructive">
                    {joinError}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={joinBusy}
                  className="min-h-[48px] w-full rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
                >
                  {joinBusy ? t(lang, "loyaltyLoading") : t(lang, "loyaltyJoinSubmitRequest")}
                </button>
              </form>
            )}
            {member.kind === "member" && joinError ? (
              <p role="alert" className="text-sm font-bold text-destructive">
                {joinError}
              </p>
            ) : null}
          </div>
        ) : member.kind === "unknown" ? (
          <p className="mt-6 text-center text-sm font-medium text-muted-foreground">
            {t(lang, "loyaltyJoinUnavailable")}
          </p>
        ) : (
          /* ------------------------------------------------------ ANONYMOUS */
          <div className="mt-6 space-y-3">
            {showGoogle ? (
              <>
                <GoogleSignInButton lang={lang} busy={googleBusy} onClick={() => void googleSubmit()} />
                <div className="flex items-center gap-3 py-0.5" aria-hidden>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs font-semibold lowercase text-muted-foreground">
                    {t(lang, "loginOrDivider")}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}

            {alreadyMember ? (
              <div className="rounded-2xl border border-border bg-muted/40 p-4 text-center">
                <p className="text-sm font-bold text-foreground">{t(lang, "loyaltyJoinAlreadyMember")}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  {t(lang, "loyaltyJoinAlreadyMemberHint")}
                </p>
              </div>
            ) : requestSent ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-sm font-black text-emerald-950">{t(lang, "loyaltyJoinRequestSent")}</p>
                <p className="mt-1 text-xs font-medium text-emerald-900">
                  {t(lang, "loyaltyJoinRequestSentHint")}
                </p>
              </div>
            ) : (
              <form
                className="space-y-3"
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
        )}
      </div>
      <p className="mt-4 text-center text-[10px] font-medium text-muted-foreground">WAKA Loyalty</p>
    </div>
  );
}

export default PublicLoyaltyProgramPage;
