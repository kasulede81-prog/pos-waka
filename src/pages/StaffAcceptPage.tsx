import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { EnterpriseSpinner } from "../components/enterprise/EnterpriseSpinner";
import { getAuthEmailCallbackUrl } from "../lib/authConfig";
import { reportAuthIssue } from "../lib/monitoring";
import {
  acceptStaffInviteToken,
  clearStaffInviteToken,
  persistStaffInviteToken,
  staffAcceptLoginHref,
} from "../lib/staffInvite";
import {
  createStaffInviteAcceptAttemptController,
  shouldStartStaffInviteAccept,
} from "../lib/staffInviteAcceptAttempt";
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
  const attemptRef = useRef(createStaffInviteAcceptAttemptController());
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (tokenFromUrl) persistStaffInviteToken(tokenFromUrl);
  }, [tokenFromUrl]);

  const token =
    tokenFromUrl ||
    (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("waka.staffInvite.token") : null) ||
    "";

  useEffect(() => {
    reportAuthIssue("invite_accept_page_open", { hasToken: Boolean(tokenFromUrl || token) });
  }, []);

  // True unmount only — dependency rerenders must not cancel in-flight acceptance.
  useEffect(() => {
    const controller = attemptRef.current;
    controller.noteMounted();
    return () => {
      controller.markUnmounted();
    };
  }, []);

  useEffect(() => {
    const controller = attemptRef.current;
    if (
      !shouldStartStaffInviteAccept({
        initializing,
        isAuthenticated,
        token,
        inFlight: controller.isInFlight(),
        settledToken: controller.settledToken(),
      })
    ) {
      if (initializing) {
        reportAuthIssue("invite_auth_wait", {});
      } else if (isAuthenticated && token) {
        reportAuthIssue("invite_auth_ready", {});
      }
      return;
    }

    const attemptId = controller.tryBegin(token);
    if (attemptId == null) return;

    reportAuthIssue("invite_accept_start", {});
    setPhase("accepting");
    setMessage(null);

    void (async () => {
      reportAuthIssue("invite_rpc_start", {});
      const result = await runStaffInviteAcceptFlow({
        token,
        acceptInviteToken: acceptStaffInviteToken,
        getAuthUserId: async () => {
          const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
          return data.user?.id ?? null;
        },
        hydrateStaffWorkspace: async (userId) => {
          reportAuthIssue("invite_hydrate_start", {});
          await hydrateStaffAuthWorkspace(userId);
        },
        clearStoredInviteToken: clearStaffInviteToken,
      });

      controller.complete(attemptId, () => {
        controller.markSettled(token);
        if (result.ok) {
          if (result.hydrateDegraded) {
            reportAuthIssue("invite_hydrate_timeout", {});
          } else {
            reportAuthIssue("invite_rpc_success", {});
          }
          reportAuthIssue("invite_success", {});
          setPhase("success");
          return;
        }

        reportAuthIssue("invite_rpc_error", {
          error: result.error === "timeout" ? "timeout" : "accept_failed",
        });
        if (result.error === "timeout") {
          reportAuthIssue("invite_timeout", {});
        }
        reportAuthIssue("invite_error", {});
        setPhase("error");
        setMessage(acceptErrorMessage(langRef.current, result.error));
      });
    })();
  }, [initializing, isAuthenticated, token]);

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
        setPhase("accepting");
        const accepted = await runStaffInviteAcceptFlow({
          token,
          acceptInviteToken: acceptStaffInviteToken,
          getAuthUserId: async () => data.session?.user?.id ?? null,
          hydrateStaffWorkspace: hydrateStaffAuthWorkspace,
          clearStoredInviteToken: clearStaffInviteToken,
        });
        if (accepted.ok) {
          attemptRef.current.markSettled(token);
          setPhase("success");
          return;
        }
        attemptRef.current.markSettled(token);
        setPhase("error");
        setMessage(acceptErrorMessage(lang, accepted.error));
        return;
      }
      // Same-browser: token remains in sessionStorage; AuthCallback returns to /staff/accept.
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
            <p className="text-xs font-medium text-muted-foreground">
              {mode === "login" ? t(lang, "staffInviteLoginHelp") : t(lang, "staffInviteSignupHelp")}
            </p>
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
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "staffInviteFutureLoginNote")}</p>
            {message ? <p className="text-sm font-semibold text-red-700">{message}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-70"
            >
              {busy ? t(lang, "staffInviteWorking") : mode === "login" ? t(lang, "staffInviteSignIn") : t(lang, "staffInviteCreateAccount")}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              <Link to={staffAcceptLoginHref(token)} className="font-semibold text-waka-700">
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
  const code = error.trim().toLowerCase();
  if (code === "email_mismatch") return t(lang, "staffInviteEmailMismatch");
  if (code === "expired") return t(lang, "staffInviteExpired");
  if (code === "revoked" || code === "already_accepted" || code === "already_member") {
    return t(lang, "staffInviteUsed");
  }
  if (code === "invalid_token") return t(lang, "staffInviteMissingToken");
  if (code === "email_not_verified" || code.includes("email_not_verified")) {
    return t(lang, "staffInviteVerifyEmail");
  }
  if (code === "timeout" || code === "staff_link_failed") {
    return t(lang, "staffInviteAcceptFailed");
  }
  return t(lang, "staffInviteAcceptFailed");
}
