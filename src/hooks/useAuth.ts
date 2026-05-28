import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authDevLog, formatAuthError, getAuthCallbackUrl, getAuthRecoveryUrl } from "../lib/authConfig";
import { Capacitor } from "@capacitor/core";
import { isGoogleAuthUiEnabled } from "../lib/authFeatureFlags";
import { requestGoogleIdToken, requireGoogleOAuthClientId } from "../lib/googleIdentity";
import { signInWithGoogleNative } from "../lib/nativeGoogleAuth";
import { hydrateAccountFromCloud } from "../lib/postAuthCloudHydrate";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportAuthIssue } from "../lib/monitoring";
import type { BusinessType, UserRole } from "../types";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";
import { phoneToLoginEmail } from "../lib/authPhoneEmail";
import { bootstrapOwnerWorkspace } from "../lib/workspaceBootstrap";
import { isWorkspaceBootstrapped, markWorkspaceBootstrapped } from "../lib/workspaceBootstrapCache";
import { applyReferralCode } from "../lib/referralAgents";
import { computeAccountKey, getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";
import { flushPendingPersist, usePosStore } from "../store/usePosStore";
import {
  authenticateOfflineStaff,
  clearRememberedStaffDevice,
  clearStaffAuth,
  listCachedShopsForStaffLogin,
  readRememberedStaffDevice,
  type CachedShop,
  type RememberedStaffDevice,
  type StaffLoginInput,
} from "../lib/staffOfflineAuth";

type LocalSession = { email: string };
type StaffSession = {
  accountKey: string;
  businessName: string;
  staffId: string;
  staffName: string;
  role: UserRole;
};

const LOCAL_AUTH_KEY = "waka-pos-local-session";
const PENDING_REFERRAL_KEY = "waka-pending-referral";

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

function applySignupProfileToLocalStore(next: Session | null): void {
  if (!next?.user) return;
  const meta = next.user.user_metadata as Record<string, unknown> | undefined;
  const shopName =
    String(meta?.shop_display_name ?? "").trim() ||
    String(meta?.business_name ?? meta?.organization_name ?? meta?.shop_name ?? "").trim();
  const store = usePosStore.getState();
  store.setPreferences({
    shopDisplayName: shopName || store.preferences.shopDisplayName,
    shopPhoneE164: String(meta?.phone_e164 ?? "").trim() || store.preferences.shopPhoneE164,
    shopCurrency: "UGX",
  });
}

export type SignUpResult =
  | { needsEmailVerification: true }
  | { needsEmailVerification: false; session: Session | null };

/** Optional profile fields stored on auth.users.raw_user_meta_data for bootstrap. */
export type SignUpProfileMeta = {
  fullName: string;
  /** E.164 +256… or local digits; normalized before signUp. */
  phone?: string;
  districtId?: string;
  /** When true, GPS will be completed later in Settings. */
  gpsSkipped?: boolean;
  /** Legal / registered business name (organization). */
  organizationName?: string;
  /** Trading outlet name (shop row). */
  shopDisplayName?: string;
  /** ISO 4217, applied to organization.default_currency after bootstrap. */
  defaultCurrency?: string;
  latitude?: number;
  longitude?: number;
  /** Marketing agent referral code (optional). */
  referralCode?: string;
};

export function useAuth() {
  /** Wait for getSession before routing — avoids protected shell with no account key. */
  const [initializing, setInitializing] = useState(() => hasSupabaseConfig);
  const [session, setSession] = useState<Session | null>(null);
  const [localEmail, setLocalEmail] = useState<string | null>(null);
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null);
  const [rememberedStaffDevice, setRememberedStaffDevice] = useState<RememberedStaffDevice | null>(
    () => readRememberedStaffDevice(),
  );

  const [bootstrappedUserIds, setBootstrappedUserIds] = useState<Record<string, true>>({});

  const tryApplyPendingReferral = useCallback(async (next: Session | null) => {
    if (!next?.user || !supabase) return;
    const meta = next.user.user_metadata as Record<string, unknown> | undefined;
    const fromMeta = String(meta?.referral_code ?? "").trim();
    const fromStorage = sessionStorage.getItem(PENDING_REFERRAL_KEY)?.trim() ?? "";
    const code = fromMeta || fromStorage;
    if (!code) return;
    const res = await applyReferralCode(code);
    if (res.ok) sessionStorage.removeItem(PENDING_REFERRAL_KEY);
    else if (import.meta.env.DEV) console.warn("[waka-auth] apply_referral_code", res.error);
  }, []);

  const ensureWorkspaceForSession = useCallback(async (next: Session | null) => {
    if (!next?.user || !supabase) return;
    if (bootstrappedUserIds[next.user.id] || isWorkspaceBootstrapped(next.user.id)) {
      setBootstrappedUserIds((prev) => ({ ...prev, [next.user.id]: true }));
      void hydrateAccountFromCloud({ forcePull: Capacitor.isNativePlatform() });
      return;
    }

    const existing = await resolvePrimaryOrganizationForUser(next.user.id);
    if (existing?.shopId) {
      setBootstrappedUserIds((prev) => ({ ...prev, [next.user.id]: true }));
      markWorkspaceBootstrapped(next.user.id);
      await tryApplyPendingReferral(next);
      void hydrateAccountFromCloud({ forcePull: true });
      return;
    }

    const meta = next.user.user_metadata as Record<string, unknown> | undefined;
    const orgFromMeta =
      String(meta?.organization_name ?? "").trim() ||
      String(meta?.business_name ?? "").trim() ||
      String(meta?.shop_name ?? "").trim() ||
      String(next.user.email ?? "").split("@")[0] ||
      "My Shop";
    const shopFromMeta =
      String(meta?.shop_display_name ?? "").trim() ||
      String(meta?.shop_name ?? "").trim() ||
      orgFromMeta;
    const businessType = (String(meta?.business_type ?? "kiosk_duka") || "kiosk_duka") as BusinessType;
    const fullName = String(meta?.full_name ?? "").trim();
    const phoneRaw = String(meta?.phone_e164 ?? meta?.phone ?? "").trim();
    const phoneE164 = normalizeUgPhoneE164(phoneRaw) ?? undefined;
    const districtId = typeof meta?.district_id === "string" && meta.district_id.length > 0 ? meta.district_id : undefined;
    const gpsSkipped = meta?.gps_skipped === true;
    const latRaw = meta?.latitude;
    const lngRaw = meta?.longitude;
    const latitude = typeof latRaw === "number" ? latRaw : typeof latRaw === "string" ? Number.parseFloat(latRaw) : undefined;
    const longitude = typeof lngRaw === "number" ? lngRaw : typeof lngRaw === "string" ? Number.parseFloat(lngRaw) : undefined;
    const hasGps =
      latitude != null &&
      longitude != null &&
      !Number.isNaN(latitude) &&
      !Number.isNaN(longitude);
    try {
      await bootstrapOwnerWorkspace(next.user, {
        organizationName: orgFromMeta,
        shopDisplayName: shopFromMeta,
        businessType,
        fullName: fullName || undefined,
        districtId,
        phoneE164,
        address: undefined,
        gpsMissing: gpsSkipped || !hasGps,
        latitude: hasGps ? latitude : undefined,
        longitude: hasGps ? longitude : undefined,
      });
      const cur = String(meta?.default_currency ?? "").trim().toUpperCase();
      if (supabase && cur.length === 3 && /^[A-Z]{3}$/.test(cur)) {
        const { data: om } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", next.user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const oid = om?.organization_id as string | undefined;
        if (oid) {
          const { error: curErr } = await supabase.from("organizations").update({ default_currency: cur }).eq("id", oid);
          if (curErr) console.error("[waka-auth] default_currency update failed", curErr);
        }
      }
      setBootstrappedUserIds((prev) => ({ ...prev, [next.user.id]: true }));
      markWorkspaceBootstrapped(next.user.id);
      await tryApplyPendingReferral(next);
      void hydrateAccountFromCloud({ forcePull: Capacitor.isNativePlatform() });
    } catch (e) {
      console.error("[waka-auth] ensureWorkspaceForSession bootstrap failed", e);
      throw new Error("Could not finish creating your shop. Please try again.");
    }
  }, [bootstrappedUserIds, tryApplyPendingReferral]);

  useEffect(() => {
    let cancelled = false;

    const finishInit = async () => {
      if (!hasSupabaseConfig || !supabase) {
        const raw = localStorage.getItem(LOCAL_AUTH_KEY);
        if (raw) {
          try {
            const email = (JSON.parse(raw) as LocalSession).email ?? null;
            clearStaffAuth();
            applyAccountSwitchSync(computeAccountKey({ mode: "local", email }));
            setLocalEmail(email);
            setStaffSession(null);
          } catch {
            localStorage.removeItem(LOCAL_AUTH_KEY);
            applyAccountSwitchSync(null);
          }
        } else {
          // Keep startup fast and deterministic: no background staff restore.
          applyAccountSwitchSync(null);
          setStaffSession(null);
        }
        if (!cancelled) setInitializing(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const next = data.session ?? null;
      if (cancelled) return;
      if (next?.user) {
        clearStaffAuth();
        applyAccountSwitchSync(
          computeAccountKey({ mode: "supabase", userId: next.user.id, email: next.user.email }),
        );
        applySignupProfileToLocalStore(next);
        setSession(next);
        setStaffSession(null);
        setLocalEmail(null);
        setInitializing(false);
        void ensureWorkspaceForSession(next).catch((e) => {
          console.error("[waka-auth] bootstrap on initial session failed", e);
        });
        return;
      }

      applyAccountSwitchSync(null);
      setStaffSession(null);
      setInitializing(false);
    };

    void finishInit();

    if (!hasSupabaseConfig || !supabase) return () => {
      cancelled = true;
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (next?.user) {
        clearStaffAuth();
        setStaffSession(null);
        applyAccountSwitchSync(
          computeAccountKey({ mode: "supabase", userId: next.user.id, email: next.user.email }),
        );
        applySignupProfileToLocalStore(next);
        void ensureWorkspaceForSession(next).catch((e) => {
          console.error("[waka-auth] bootstrap on auth state change failed", e);
        });
        setSession(next);
        return;
      }
      // Do not clear the offline namespace on transient null sessions (token refresh glitches).
      if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        applyAccountSwitchSync(null);
        setSession(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [ensureWorkspaceForSession]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    clearStaffAuth();
    setStaffSession(null);
    const trimmed = identifier.trim();
    if (hasSupabaseConfig && supabase) {
      const phoneE164 = normalizeUgPhoneE164(trimmed);
      const digitsOnly = trimmed.replace(/\D/g, "");
      const usePhone = Boolean(phoneE164 && digitsOnly.length >= 9 && !trimmed.includes("@"));
      const loginEmail = usePhone && phoneE164 ? phoneToLoginEmail(trimmed) : trimmed;
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) {
        reportAuthIssue("sign_in_failed", { status: error.status ?? 0 });
        throw error;
      }
      return;
    }
    if (!password || password.length < 4) throw new Error("Invalid password.");
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ email: trimmed }));
    applyAccountSwitchSync(computeAccountKey({ mode: "local", email: trimmed }));
    setLocalEmail(trimmed);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    clearStaffAuth();
    setStaffSession(null);
    if (!isGoogleAuthUiEnabled()) {
      throw new Error("Google sign-in is not available. Use your email or phone and password.");
    }
    if (!hasSupabaseConfig || !supabase) {
      throw new Error("Supabase is not configured.");
    }

    if (Capacitor.isNativePlatform()) {
      authDevLog("log", "Google Sign-In: native browser OAuth → Supabase callback");
      await signInWithGoogleNative();
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        throw new Error("Sign-in did not complete. Please try again.");
      }
      await hydrateAccountFromCloud({ forcePull: true });
      return;
    }

    const googleClientId = requireGoogleOAuthClientId();
    authDevLog("log", "Google Sign-In: GIS popup → signInWithIdToken (no Supabase OAuth redirect)");

    const idToken = await requestGoogleIdToken(googleClientId);
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    if (error) {
      authDevLog("error", "signInWithIdToken failed", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      reportAuthIssue("google_oauth_failed", { status: error.status ?? 0 });
      throw new Error(formatAuthError(error));
    }
    await hydrateAccountFromCloud();
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      businessName: string,
      businessType: BusinessType,
      profile?: SignUpProfileMeta,
    ): Promise<SignUpResult> => {
    if (!hasSupabaseConfig || !supabase) {
      throw new Error("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to create an account.");
    }
    const redirectTo = getAuthCallbackUrl();
    const orgLabel = (profile?.organizationName ?? businessName).trim();
    const shopLabel = (profile?.shopDisplayName ?? businessName).trim();
    const meta: Record<string, unknown> = {
      business_name: orgLabel,
      organization_name: orgLabel,
      shop_display_name: shopLabel,
      business_type: businessType,
      pos_role: "owner",
    };
    if (profile?.fullName?.trim()) meta.full_name = profile.fullName.trim();
    const normalizedPhone = profile?.phone ? normalizeUgPhoneE164(profile.phone) : null;
    if (normalizedPhone) meta.phone_e164 = normalizedPhone;
    if (profile?.districtId?.trim()) meta.district_id = profile.districtId.trim();
    if (profile?.gpsSkipped) meta.gps_skipped = true;
    const dc = profile?.defaultCurrency?.trim().toUpperCase();
    if (dc && dc.length === 3) meta.default_currency = dc;
    if (profile?.latitude != null && profile?.longitude != null && !Number.isNaN(profile.latitude) && !Number.isNaN(profile.longitude)) {
      meta.latitude = profile.latitude;
      meta.longitude = profile.longitude;
    }
    const refCode = profile?.referralCode?.trim().toUpperCase();
    if (refCode && refCode.length >= 3) {
      meta.referral_code = refCode;
      sessionStorage.setItem(PENDING_REFERRAL_KEY, refCode);
    }

    const firstAttempt = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: meta,
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
        options: { emailRedirectTo: redirectTo, data: meta },
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
      try {
        await ensureWorkspaceForSession(data.session);
      } catch (e) {
        console.error("[waka-auth] signUp immediate bootstrap failed", e);
        throw e;
      }
      applyAccountSwitchSync(
        computeAccountKey({ mode: "supabase", userId: data.session.user?.id, email: data.session.user?.email }),
      );
      applySignupProfileToLocalStore(data.session);
      setSession(data.session);
      return { needsEmailVerification: false, session: data.session };
    }
    return { needsEmailVerification: true };
  },
  [ensureWorkspaceForSession]);

  const signUpQuick = useCallback(
    async (input: {
      shopName: string;
      ownerName: string;
      phone: string;
      password: string;
      referralCode?: string;
    }): Promise<SignUpResult> => {
      const email = phoneToLoginEmail(input.phone);
      return signUp(email, input.password, input.shopName.trim(), "kiosk_duka", {
        fullName: input.ownerName.trim(),
        phone: input.phone,
        organizationName: input.shopName.trim(),
        shopDisplayName: input.shopName.trim(),
        defaultCurrency: "UGX",
        gpsSkipped: true,
        referralCode: input.referralCode?.trim(),
      });
    },
    [signUp],
  );

  const resendVerificationEmail = useCallback(async (email: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: getAuthCallbackUrl() },
    });
    if (error) {
      reportAuthIssue("resend_verification_failed", { status: error.status ?? 0 });
      throw error;
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRecoveryUrl(),
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
    if (staffSession) {
      flushPendingPersist();
      const store = usePosStore.getState();
      if (store.preferences.activeStaffId) {
        store.switchStaffAccount(null);
        await flushPendingPersist();
      }
      clearStaffAuth();
      applyAccountSwitchSync(null);
      usePosStore.getState().resetForSignOut();
      setStaffSession(null);
      return;
    }
    if (hasSupabaseConfig && supabase) {
      await supabase.auth.signOut();
      applyAccountSwitchSync(null);
      setSession(null);
      return;
    }
    localStorage.removeItem(LOCAL_AUTH_KEY);
    applyAccountSwitchSync(null);
    setLocalEmail(null);
  }, [staffSession]);

  const signInStaff = useCallback(async (input: StaffLoginInput) => {
    const auth = await authenticateOfflineStaff(input);
    applyAccountSwitchSync(auth.accountKey);
    setSession(null);
    setLocalEmail(null);
    if (hasSupabaseConfig && supabase) {
      await supabase.auth.signOut();
    }
    setStaffSession({
      accountKey: auth.accountKey,
      businessName: auth.businessName,
      staffId: auth.staffId,
      staffName: auth.staffName,
      role: auth.role,
    });
    setRememberedStaffDevice(readRememberedStaffDevice());
  }, []);

  const listStaffShops = useCallback(async (): Promise<CachedShop[]> => {
    return listCachedShopsForStaffLogin();
  }, []);

  const clearRememberedStaff = useCallback(() => {
    clearRememberedStaffDevice();
    setRememberedStaffDevice(null);
  }, []);

  const isAuthenticated = Boolean(session?.user) || Boolean(localEmail) || Boolean(staffSession);
  const user = session?.user ?? null;
  const metaStr = user?.user_metadata as Record<string, string> | undefined;
  const shopName =
    (metaStr?.shop_display_name as string | undefined)?.trim() ||
    (metaStr?.business_name as string | undefined)?.trim() ||
    "";
  const email = user?.email ?? localEmail;
  const effectiveMode: "supabase" | "local" = staffSession ? "local" : AUTH_MODE;
  const accountKey = staffSession?.accountKey
    ?? computeAccountKey({
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
      mode: effectiveMode,
      accountKey,
      signIn,
      signInWithGoogle,
      signInStaff,
      listStaffShops,
      rememberedStaffDevice,
      clearRememberedStaff,
      staffSession,
      signUp,
      signUpQuick,
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
      effectiveMode,
      accountKey,
      signIn,
      signInWithGoogle,
      signInStaff,
      listStaffShops,
      rememberedStaffDevice,
      clearRememberedStaff,
      staffSession,
      signUp,
      signUpQuick,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendVerificationEmail,
    ],
  );
}
