import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authDevLog, formatAuthError, getAuthCallbackUrl, getAuthRecoveryUrl } from "../lib/authConfig";
import { Capacitor } from "@capacitor/core";
import { isGoogleAuthUiEnabled } from "../lib/authFeatureFlags";
import { requestGoogleIdToken, requireGoogleOAuthClientId } from "../lib/googleIdentity";
import { signInWithGoogleNative } from "../lib/nativeGoogleAuth";
import { hydrateAccountFromCloud } from "../lib/postAuthCloudHydrate";
import { isNativeApp } from "../lib/nativeApp";
import { scheduleBackgroundCloudSync } from "../offline/cloudSync";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { reportAuthIssue } from "../lib/monitoring";
import { appendPilotEvent } from "../lib/pilotEventLog";
import { setCrashReportingUser } from "../lib/crashReporting";
import type { BusinessType, UserRole } from "../types";
import { finalizeOwnerOnboardingAfterCloudSave, normalizeUgPhoneE164, parseRegistrationProfileFromMeta, applyRegistrationProfileToLocalStore } from "../lib/businessProfile";
import { isPhoneLoginEmail } from "../lib/authPhoneEmail";
import { bootstrapOwnerWorkspace } from "../lib/workspaceBootstrap";
import { fetchOwnerOnboardingStatus, readCachedOwnerOnboardingComplete } from "../lib/ownerOnboarding";
import { isWorkspaceBootstrapped, markWorkspaceBootstrapped } from "../lib/workspaceBootstrapCache";
import { ensureReferralAttributionForSession } from "../lib/referralAgents";
import { storePendingReferralCode } from "../lib/pendingReferral";
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
  const profile = parseRegistrationProfileFromMeta(next.user.user_metadata as Record<string, unknown>);
  const store = usePosStore.getState();
  const existingOwner =
    isWorkspaceBootstrapped(next.user.id) || readCachedOwnerOnboardingComplete(next.user.id) === true;
  applyRegistrationProfileToLocalStore(profile);
  if (existingOwner) {
    store.setPreferences({
      onboardingDone: true,
      onboardingWizardDone: true,
      schemaVersion: 2 as const,
    });
  }
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

  const bootstrappedUserIdsRef = useRef<Record<string, true>>({});
  const workspaceEnsureInFlightRef = useRef<string | null>(null);
  const workspaceEnsuredForUserRef = useRef<string | null>(null);
  const backgroundSyncScheduledRef = useRef<Record<string, true>>({});

  const tryApplyPendingReferral = useCallback(async (next: Session | null) => {
    if (!next?.user || !supabase) return;
    const meta = next.user.user_metadata as Record<string, unknown> | undefined;
    const res = await ensureReferralAttributionForSession(String(meta?.referral_code ?? ""));
    if (!res.ok && res.error && res.error !== "invalid_code") {
      reportAuthIssue("referral_apply_failed", { error: res.error });
    } else if (!res.ok && import.meta.env.DEV) {
      console.warn("[waka-auth] ensure_referral_attribution", res.error);
    }
  }, []);

  const ensureWorkspaceForSession = useCallback(async (next: Session | null) => {
    if (!next?.user || !supabase) return;
    const uid = next.user.id;
    if (workspaceEnsureInFlightRef.current === uid) return;

    const alreadyEnsured =
      workspaceEnsuredForUserRef.current === uid ||
      bootstrappedUserIdsRef.current[uid] ||
      isWorkspaceBootstrapped(uid);

    if (alreadyEnsured) {
      workspaceEnsuredForUserRef.current = uid;
      bootstrappedUserIdsRef.current[uid] = true;
      await tryApplyPendingReferral(next);
      if (!backgroundSyncScheduledRef.current[uid]) {
        backgroundSyncScheduledRef.current[uid] = true;
        scheduleBackgroundCloudSync({
          pull: false,
          delayMs: isNativeApp() ? 18_000 : 6000,
        });
      }
      return;
    }

    workspaceEnsureInFlightRef.current = uid;
    try {
    const existing = await resolvePrimaryOrganizationForUser(uid);
    if (existing?.shopId) {
      bootstrappedUserIdsRef.current[uid] = true;
      markWorkspaceBootstrapped(uid);
      await tryApplyPendingReferral(next);
      const onboarding = await fetchOwnerOnboardingStatus();
      if (onboarding?.complete) {
        await finalizeOwnerOnboardingAfterCloudSave(uid);
      }
      const { isLocalShopDataEmpty } = await import("../lib/cloudSnapshotSync");
      if (isLocalShopDataEmpty()) {
        void hydrateAccountFromCloud({ forcePull: true });
      } else {
        scheduleBackgroundCloudSync({
          pull: false,
          delayMs: isNativeApp() ? 15_000 : 5000,
        });
      }
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
      bootstrappedUserIdsRef.current[next.user.id] = true;
      markWorkspaceBootstrapped(next.user.id);
      await tryApplyPendingReferral(next);
      const onboarding = await fetchOwnerOnboardingStatus();
      if (onboarding?.complete) {
        await finalizeOwnerOnboardingAfterCloudSave(next.user.id);
      }
      void hydrateAccountFromCloud({ forcePull: true });
    } catch (e) {
      console.error("[waka-auth] ensureWorkspaceForSession bootstrap failed", e);
      throw new Error("Could not finish creating your shop. Please try again.");
    } finally {
      workspaceEnsureInFlightRef.current = null;
      workspaceEnsuredForUserRef.current = uid;
    }
  }, [tryApplyPendingReferral]);

  const ensureWorkspaceRef = useRef(ensureWorkspaceForSession);
  ensureWorkspaceRef.current = ensureWorkspaceForSession;

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
        void ensureWorkspaceRef.current(next).catch((e) => {
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
        if (event === "TOKEN_REFRESHED") {
          setSession((prev) => (prev?.user?.id === next.user.id ? prev : next));
          return;
        }
        clearStaffAuth();
        setStaffSession(null);
        applyAccountSwitchSync(
          computeAccountKey({ mode: "supabase", userId: next.user.id, email: next.user.email }),
        );
        applySignupProfileToLocalStore(next);
        if (event === "SIGNED_IN") {
          void ensureWorkspaceRef.current(next).catch((e) => {
            console.error("[waka-auth] bootstrap on auth state change failed", e);
          });
        }
        setSession((prev) => (prev?.user?.id === next.user.id ? prev : next));
        return;
      }
      if (event === "SIGNED_OUT") {
        applyAccountSwitchSync(null);
        setSession(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    clearStaffAuth();
    setStaffSession(null);
    const trimmed = identifier.trim().toLowerCase();
    if (hasSupabaseConfig && supabase) {
      if (!trimmed.includes("@")) {
        throw new Error("Sign in with your email address so you can reset your password later.");
      }
      const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
      if (error) {
        reportAuthIssue("sign_in_failed", { status: error.status ?? 0 });
        throw error;
      }
      appendPilotEvent("login", "Email sign-in", { mode: "supabase" });
      return;
    }
    if (!password || password.length < 4) throw new Error("Invalid password.");
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ email: trimmed }));
    applyAccountSwitchSync(computeAccountKey({ mode: "local", email: trimmed }));
    setLocalEmail(trimmed);
  }, []);

  const signInWithGoogle = useCallback(async (opts?: { referralCode?: string }) => {
    const ref = opts?.referralCode?.trim().toUpperCase();
    if (ref && ref.length >= 3) {
      storePendingReferralCode(ref);
    }
    clearStaffAuth();
    setStaffSession(null);
    if (!isGoogleAuthUiEnabled()) {
      throw new Error("Google sign-in is not available. Use your email and password.");
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
      if (ref && ref.length >= 3) {
        await supabase.auth.updateUser({ data: { referral_code: ref } }).catch(() => undefined);
        void ensureWorkspaceRef.current(data.session).catch((e) => {
          console.error("[waka-auth] referral after Google native sign-in failed", e);
        });
      }
      void hydrateAccountFromCloud({ forcePull: true });
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
    if (ref && ref.length >= 3) {
      await supabase.auth.updateUser({ data: { referral_code: ref } }).catch(() => undefined);
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session) {
        void ensureWorkspaceRef.current(sess.session).catch((e) => {
          console.error("[waka-auth] referral after Google sign-in failed", e);
        });
      }
    }
    void hydrateAccountFromCloud();
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
      storePendingReferralCode(refCode);
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
      email: string;
      phone: string;
      districtId: string;
      password: string;
      referralCode?: string;
    }): Promise<SignUpResult> => {
      const loginEmail = input.email.trim().toLowerCase();
      if (!loginEmail.includes("@")) {
        throw new Error("Enter a valid email address for your account and password recovery.");
      }
      const phoneNorm = normalizeUgPhoneE164(input.phone);
      if (!phoneNorm) {
        throw new Error("Enter a valid Uganda mobile number for your shop.");
      }
      return signUp(loginEmail, input.password, input.shopName.trim(), "kiosk_duka", {
        fullName: input.ownerName.trim(),
        phone: phoneNorm,
        districtId: input.districtId,
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

  const requestPasswordReset = useCallback(async (identifier: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    let targetEmail = identifier.trim().toLowerCase();
    if (!targetEmail.includes("@")) {
      const phoneE164 = normalizeUgPhoneE164(identifier);
      if (!phoneE164) throw new Error("Enter your email or a valid Uganda mobile number.");
      const { data, error: lookupErr } = await supabase.rpc("lookup_password_reset_email", {
        p_phone_e164: phoneE164,
      });
      if (lookupErr) throw lookupErr;
      const j = (data ?? {}) as { ok?: boolean; email?: string; error?: string };
      if (!j.ok || !j.email) {
        throw new Error(
          "No recovery email on file for this phone. Contact Waka support or use the email you registered with.",
        );
      }
      targetEmail = j.email;
    }
    if (isPhoneLoginEmail(targetEmail)) {
      throw new Error("This account uses phone-only login. Contact Waka support to reset your password.");
    }
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: getAuthRecoveryUrl(),
    });
    if (error) {
      reportAuthIssue("password_reset_request_failed", { status: error.status ?? 0 });
      throw new Error(formatAuthError(error));
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!hasSupabaseConfig || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      reportAuthIssue("password_update_failed", { status: error.status ?? 0 });
      throw new Error(formatAuthError(error));
    }
  }, []);

  const signOut = useCallback(async () => {
    appendPilotEvent("logout", "Sign out");
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

  useEffect(() => {
    if (!user?.id) {
      setCrashReportingUser({});
      return;
    }
    let cancelled = false;
    void resolvePrimaryOrganizationForUser(user.id).then((org) => {
      if (cancelled) return;
      setCrashReportingUser({
        userId: user.id,
        email: user.email ?? null,
        shopId: org?.shopId ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.email]);

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
