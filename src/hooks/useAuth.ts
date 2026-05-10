import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authRedirectOrigin, hasSupabaseConfig, supabase } from "../lib/supabase";

type LocalSession = { email: string };

const LOCAL_AUTH_KEY = "waka-pos-local-session";

export type SignUpResult =
  | { needsEmailVerification: true }
  | { needsEmailVerification: false; session: Session | null };

export function useAuth() {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [localEmail, setLocalEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      const raw = localStorage.getItem(LOCAL_AUTH_KEY);
      if (raw) {
        try {
          setLocalEmail((JSON.parse(raw) as LocalSession).email ?? null);
        } catch {
          localStorage.removeItem(LOCAL_AUTH_KEY);
        }
      }
      setInitializing(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setInitializing(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (hasSupabaseConfig && supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return;
    }
    if (!password || password.length < 4) throw new Error("Invalid password.");
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ email }));
    setLocalEmail(email);
  }, []);

  const signUp = useCallback(async (email: string, password: string, businessName: string): Promise<SignUpResult> => {
    if (!hasSupabaseConfig || !supabase) {
      throw new Error("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to create an account.");
    }
    const redirectTo = `${authRedirectOrigin()}/auth/callback`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { business_name: businessName.trim() },
      },
    });
    if (error) throw error;
    if (data.session) {
      setSession(data.session);
      return { needsEmailVerification: false, session: data.session };
    }
    return { needsEmailVerification: true };
  }, []);

  const resendVerificationEmail = useCallback(async (email: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${authRedirectOrigin()}/auth/callback` },
    });
    if (error) throw error;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${authRedirectOrigin()}/auth/recovery`,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (hasSupabaseConfig && supabase) {
      await supabase.auth.signOut();
      setSession(null);
      return;
    }
    localStorage.removeItem(LOCAL_AUTH_KEY);
    setLocalEmail(null);
  }, []);

  const isAuthenticated = Boolean(session?.user) || Boolean(localEmail);
  const user = session?.user ?? null;
  const shopName =
    ((user?.user_metadata as Record<string, string> | undefined)?.business_name as string | undefined)?.trim() || "";

  return useMemo(
    () => ({
      initializing,
      isAuthenticated,
      session,
      user,
      shopName,
      email: user?.email ?? localEmail,
      mode: (hasSupabaseConfig ? "supabase" : "local") as "supabase" | "local",
      signIn,
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
      localEmail,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendVerificationEmail,
    ],
  );
}
