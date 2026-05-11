import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authRedirectOrigin, hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportAuthIssue } from "../lib/monitoring";
import type { BusinessType } from "../types";
import { bootstrapOwnerWorkspace } from "../lib/workspaceBootstrap";
import { computeAccountKey, getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";
import { usePosStore, flushPendingPersist } from "../store/usePosStore";

type LocalSession = { email: string };

const LOCAL_AUTH_KEY = "waka-pos-local-session";

const AUTH_MODE: "supabase" | "local" = hasSupabaseConfig ? "supabase" : "local";

/**
 * Synchronously switch the offline storage namespace BEFORE React re-renders
 * with the new session. This guarantees that downstream effects
 * (e.g. `bootstrapPosFromDisk` in `PosDataProvider`) always observe the
 * correct account key when they mount or re-run.
 *
 * Order matters:
 *   1. Flush pending writes under the OUTGOING account key so a quick
 *      sale → sign-out cannot lose data.
 *   2. Reset Zustand so the previous account's data cannot flash in the UI.
 *   3. Swap the active account key so subsequent reads/writes use the
 *      INCOMING namespace.
 */
function applyAccountSwitchSync(nextKey: string | null): void {
  if (getActiveAccountKey() === nextKey) return;
  flushPendingPersist();
  usePosStore.getState().resetForSignOut();
  setActiveAccountKey(nextKey);
}

export type SignUpResult =
  | { needsEmailVerification: true }
  | { needsEmailVerification: false; session: Session | null };

export function useAuth() {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [localEmail, setLocalEmail] = useState<string | null>(null);

  const [bootstrappedUserIds, setBootstrappedUserIds] = useState<Record<string, true>>({});

  const ensureWorkspaceForSession = useCallback(async (next: Session | null) => {
    if (!next?.user || !supabase) return;
    if (bootstrappedUserIds[next.user.id]) return;

    const meta = next.user.user_metadata as Record<string, unknown> | undefined;
    const businessName =
      String(meta?.business_name ?? "").trim() ||
      String(meta?.shop_name ?? "").trim() ||
      String(next.user.email ?? "").split("@")[0] ||
      "My Shop";
    const businessType = (String(meta?.business_type ?? "kiosk_duka") || "kiosk_duka") as BusinessType;
    const fullName = String(meta?.full_name ?? "").trim();
    try {
      await bootstrapOwnerWorkspace(next.user, {
        businessName,
        businessType,
        fullName,
      });
      setBootstrappedUserIds((prev) => ({ ...prev, [next.user.id]: true }));
    } catch {
      throw new Error("Could not finish creating your shop. Please try again.");
    }
  }, [bootstrappedUserIds]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      const raw = localStorage.getItem(LOCAL_AUTH_KEY);
      if (raw) {
        try {
          const email = (JSON.parse(raw) as LocalSession).email ?? null;
          applyAccountSwitchSync(computeAccountKey({ mode: "local", email }));
          setLocalEmail(email);
        } catch {
          localStorage.removeItem(LOCAL_AUTH_KEY);
          applyAccountSwitchSync(null);
        }
      } else {
        applyAccountSwitchSync(null);
      }
      setInitializing(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      try {
        await ensureWorkspaceForSession(data.session ?? null);
      } catch {
        /* keep auth session; user-facing flow handles message on register */
      } finally {
        const next = data.session ?? null;
        applyAccountSwitchSync(
          computeAccountKey({ mode: "supabase", userId: next?.user?.id, email: next?.user?.email }),
        );
        setSession(next);
        setInitializing(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      applyAccountSwitchSync(
        computeAccountKey({ mode: "supabase", userId: next?.user?.id, email: next?.user?.email }),
      );
      void ensureWorkspaceForSession(next).catch(() => {
        /* non-blocking: preserves login while surfacing errors on active flows */
      });
      setSession(next);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (hasSupabaseConfig && supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        reportAuthIssue("sign_in_failed", { status: error.status ?? 0 });
        throw error;
      }
      return;
    }
    if (!password || password.length < 4) throw new Error("Invalid password.");
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ email }));
    applyAccountSwitchSync(computeAccountKey({ mode: "local", email }));
    setLocalEmail(email);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!hasSupabaseConfig || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${authRedirectOrigin()}/auth/callback`,
      },
    });
    if (error) {
      if (import.meta.env.DEV) {
        console.error("[waka-auth] google oauth failed", {
          code: error.code,
          status: error.status,
          message: error.message,
        });
      }
      reportAuthIssue("google_oauth_failed", { status: error.status ?? 0 });
      throw error;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, businessName: string, businessType: BusinessType): Promise<SignUpResult> => {
    if (!hasSupabaseConfig || !supabase) {
      throw new Error("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to create an account.");
    }
    const redirectTo = `${authRedirectOrigin()}/auth/callback`;
    const firstAttempt = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { business_name: businessName.trim(), business_type: businessType, pos_role: "owner" },
      },
    });
    let data = firstAttempt.data;
    let error = firstAttempt.error;
    const maybeDbSignupFailure = (error?.message ?? "").toLowerCase().includes("database error saving new user");
    if (maybeDbSignupFailure) {
      if (import.meta.env.DEV) {
        console.warn("[waka-auth] signUp retry without metadata after DB error");
      }
      const retry = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      if (import.meta.env.DEV) {
        console.error("[waka-auth] signUp failed", {
          code: error.code,
          status: error.status,
          name: error.name,
          message: error.message,
        });
      }
      reportAuthIssue("sign_up_failed", { status: error.status ?? 0 });
      if ((error.message ?? "").toLowerCase().includes("database error saving new user")) {
        throw new Error("Could not finish creating your shop. Please try again.");
      }
      throw error;
    }
    if (data.session) {
      await ensureWorkspaceForSession(data.session);
      applyAccountSwitchSync(
        computeAccountKey({ mode: "supabase", userId: data.session.user?.id, email: data.session.user?.email }),
      );
      setSession(data.session);
      return { needsEmailVerification: false, session: data.session };
    }
    return { needsEmailVerification: true };
  }, [ensureWorkspaceForSession]);

  const resendVerificationEmail = useCallback(async (email: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${authRedirectOrigin()}/auth/callback` },
    });
    if (error) {
      reportAuthIssue("resend_verification_failed", { status: error.status ?? 0 });
      throw error;
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${authRedirectOrigin()}/auth/recovery`,
    });
    if (error) {
      reportAuthIssue("password_reset_request_failed", { status: error.status ?? 0 });
      throw error;
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      reportAuthIssue("password_update_failed", { status: error.status ?? 0 });
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (hasSupabaseConfig && supabase) {
      await supabase.auth.signOut();
      applyAccountSwitchSync(null);
      setSession(null);
      return;
    }
    localStorage.removeItem(LOCAL_AUTH_KEY);
    applyAccountSwitchSync(null);
    setLocalEmail(null);
  }, []);

  const isAuthenticated = Boolean(session?.user) || Boolean(localEmail);
  const user = session?.user ?? null;
  const shopName =
    ((user?.user_metadata as Record<string, string> | undefined)?.business_name as string | undefined)?.trim() || "";
  const email = user?.email ?? localEmail;
  const accountKey = computeAccountKey({
    mode: AUTH_MODE,
    userId: user?.id ?? null,
    email,
  }) ?? getActiveAccountKey();

  return useMemo(
    () => ({
      initializing,
      isAuthenticated,
      session,
      user,
      shopName,
      email,
      mode: AUTH_MODE,
      accountKey,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendVerificationEmail,
    }),
    [
      initializing,
      isAuthenticated,
      session,
      user,
      shopName,
      email,
      accountKey,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendVerificationEmail,
    ],
  );
}
