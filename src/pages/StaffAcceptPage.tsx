import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { EnterpriseSpinner } from "../components/enterprise/EnterpriseSpinner";
import { getAuthEmailCallbackUrl } from "../lib/authConfig";
import {
  acceptStaffInviteToken,
  clearStaffInviteToken,
  persistStaffInviteToken,
} from "../lib/staffInvite";
import { runStaffInviteAcceptFlow } from "../lib/staffInviteAcceptFlow";
import { hydrateStaffAuthWorkspace } from "../lib/staffAuthHydrate";
import { supabase } from "../lib/supabase";
import { WAKA_LEGAL_COMPANY_NAME } from "../config/wakaSupport";
import type { Language } from "../types";
import { t } from "../lib/i18n";

type Props = {
  lang: Language;
  isAuthenticated: boolean;
  initializing: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
};

type Phase = "ready" | "accepting" | "success" | "need_verify" | "error";

export function StaffAcceptPage({ lang, isAuthenticated, initializing, onLogin }: Props) {
  const [params] = useSearchParams();
  const tokenFromUrl = (params.get("token") ?? "").trim();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [phase, setPhase] = useState<Phase>("ready");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tokenFromUrl) persistStaffInviteToken(tokenFromUrl);
  }, [tokenFromUrl]);

  const token = tokenFromUrl || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("waka.staffInvite.token") : null) || "";

  useEffect(() => {
    if (initializing || !isAuthenticated || !token || phase === "success" || phase === "accepting") return;
    let cancelled = false;
    setPhase("accepting");
    setMessage(null);
    void (async () => {
      const result = await runStaffInviteAcceptFlow({
        token,
        acceptInviteToken: acceptStaffInviteToken,
        getAuthUserId: async () => {
          const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
          return data.user?.id ?? null;
        },
        hydrateStaffWorkspace: hydrateStaffAuthWorkspace,
        clearStoredInviteToken: clearStaffInviteToken,
      });
      if (cancelled) return;
      if (result.ok) {
        setPhase("success");
        return;
      }
      setPhase("error");
      setMessage(acceptErrorMessage(lang, result.error));
    })();
    return () => {
      cancelled = true;
    };
  }, [initializing, isAuthenticated, token, phase, lang]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      persistStaffInviteToken(token);
      if (mode === "login") {
        await onLogin(email.trim().toLowerCase(), password);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: getAuthEmailCallbackUrl(),
          data: { staff_invite: true, pos_role: "staff" },
        },
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      if (data.session) {
        const accepted = await acceptStaffInviteToken(token);
        if (accepted.ok) {
          clearStaffInviteToken();
          if (data.session.user?.id) {
            await hydrateStaffAuthWorkspace(data.session.user.id);
          }
          setPhase("success");
          return;
        }
        setPhase("error");
        setMessage(acceptErrorMessage(lang, accepted.error));
        return;
      }
      setPhase("need_verify");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t(lang, "staffInviteAcceptFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "success") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-waka-50 via-card to-muted px-4 py-10">
      <WakaPosLogo size="lg" className="mx-auto" />
      <p className="mt-4 text-lg font-black text-foreground">Waka POS</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WAKA_LEGAL_COMPANY_NAME}</p>

      <div className="mt-8 w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h1 className="text-lg font-black text-foreground">{t(lang, "staffInviteAcceptTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "staffInviteAcceptSub")}</p>

        {!token ? (
          <p className="mt-4 text-sm font-semibold text-red-700">{t(lang, "staffInviteMissingToken")}</p>
        ) : initializing || phase === "accepting" ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <EnterpriseSpinner size="lg" label={t(lang, "staffInviteAccepting")} />
            <p className="text-sm font-semibold text-muted-foreground">{t(lang, "staffInviteAccepting")}</p>
          </div>
        ) : phase === "need_verify" ? (
          <p className="mt-4 text-sm font-semibold text-foreground">{t(lang, "staffInviteVerifyEmail")}</p>
        ) : isAuthenticated ? (
          <p className="mt-4 text-sm font-semibold text-red-700">{message ?? t(lang, "staffInviteAcceptFailed")}</p>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={(e) => void submit(e)}>
            <div className="flex rounded-xl bg-muted p-1">
              <button
                type="button"
                className={`min-h-[40px] flex-1 rounded-lg text-sm font-black ${mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                onClick={() => setMode("login")}
              >
                {t(lang, "staffInviteSignIn")}
              </button>
              <button
                type="button"
                className={`min-h-[40px] flex-1 rounded-lg text-sm font-black ${mode === "signup" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                onClick={() => setMode("signup")}
              >
                {t(lang, "staffInviteCreateAccount")}
              </button>
            </div>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(lang, "staffInviteEmailPh")}
              className="w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t(lang, "staffInvitePasswordPh")}
              className="w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
            />
            {message ? <p className="text-sm font-semibold text-red-700">{message}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-70"
            >
              {busy ? t(lang, "staffInviteWorking") : mode === "login" ? t(lang, "staffInviteSignIn") : t(lang, "staffInviteCreateAccount")}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              <Link to={`/login?next=/staff/accept`} className="font-semibold text-waka-700">
                {t(lang, "staffInviteUseFullLogin")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export function acceptErrorMessage(lang: Language, error: string): string {
  if (error === "email_mismatch") return t(lang, "staffInviteEmailMismatch");
  if (error === "expired") return t(lang, "staffInviteExpired");
  if (error === "revoked" || error === "already_accepted") return t(lang, "staffInviteUsed");
  if (error === "invalid_token") return t(lang, "staffInviteMissingToken");
  return t(lang, "staffInviteAcceptFailed");
}
