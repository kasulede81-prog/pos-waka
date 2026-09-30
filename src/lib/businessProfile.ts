import type { BusinessType, Language } from "../types";
import { isSupabaseEmailVerified } from "./emailVerification";
import { fetchOwnerOnboardingStatus, writeCachedOwnerOnboardingComplete } from "./ownerOnboarding";
import { supabase } from "./supabase";
import { bootstrapOwnerWorkspace } from "./workspaceBootstrap";
import { usePosStore } from "../store/usePosStore";
import { clearPendingRegistrationProfile } from "./registrationProfileCache";
import { getActiveShopId, isValidShopId } from "../offline/shopScope";
import { blocksOwnerBootstrap, resolveAccountIdentity } from "./memberIdentity";

/**
 * Phase 2C — the identity/bootstrap authority's veto, for the two callers below that create a
 * tenancy outside `ensureWorkspaceForSession`.
 *
 * Both used to call `bootstrapOwnerWorkspace` unconditionally when the caller had no shop. That is
 * a second way into the exact failure Phase 1 removed: `waka_account_identity()` is the authority
 * on who may be given a workspace, and neither site consulted it — a WAKA Loyalty member, or any
 * session the classifier calls `unknown`, could have been provisioned a shop from a settings form
 * or an onboarding save.
 *
 * `force: true` re-reads rather than trusting the per-user cache, because this is the moment the
 * answer decides whether a tenancy is created.
 *
 * MERCHANT INTENT IS NOT MERCHANT AUTHORIZATION: this only asks the classifier. A session that
 * declared intent resolves `merchant` and passes; a member or an unclassified one is refused here
 * exactly as it would be inside `ensureWorkspaceForSession`.
 */
async function mayCreateOwnerWorkspace(user: { id: string; user_metadata?: unknown }): Promise<boolean> {
  const resolution = await resolveAccountIdentity({
    userId: user.id,
    metadata: (user.user_metadata ?? {}) as Record<string, unknown>,
    force: true,
  });
  return !blocksOwnerBootstrap(resolution);
}

export type SaveOwnerBundleArgs = {
  shopName: string;
  businessType: BusinessType;
  districtId: string;
  phoneE164: string;
  currency: string;
  address?: string;
  city?: string;
  area?: string;
  latitude?: number | null;
  longitude?: number | null;
};

/** Single transactional save (organizations + shops + profiles). Subscription init is via bootstrap_owner_workspace. */
export async function saveOwnerBusinessProfileBundleRpc(
  args: SaveOwnerBundleArgs,
): Promise<{ ok: boolean; message?: string; shopId?: string; organizationId?: string }> {
  const sb = supabase;
  if (!sb) return { ok: false, message: "Offline" };
  const { data: authData } = await sb.auth.getUser();
  if (authData.user && !isSupabaseEmailVerified(authData.user)) {
    return { ok: false, message: "email_not_verified" };
  }
  const callSaveRpc = async () =>
    sb.rpc("save_owner_business_profile_bundle", {
      p_shop_name: args.shopName.trim(),
      p_business_type: args.businessType,
      p_district_id: args.districtId,
      p_phone_e164: args.phoneE164.trim(),
      p_currency: args.currency.trim().toUpperCase(),
      p_address: args.address?.trim() || null,
      p_city: args.city?.trim() || null,
      p_area: args.area?.trim() || null,
      p_latitude: args.latitude ?? null,
      p_longitude: args.longitude ?? null,
    });
  let { data, error } = await callSaveRpc();
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string; detail?: string; shop_id?: string; organization_id?: string };
  if (!j.ok && j.error === "no_shop") {
    const { data: authData } = await sb.auth.getUser();
    if (authData?.user) {
      const meta = (authData.user.user_metadata ?? {}) as Record<string, unknown>;
      const fullName =
        String(meta.full_name ?? meta.name ?? "")
          .trim() || authData.user.email?.split("@")[0] || "Owner";
      const hasGps =
        args.latitude != null &&
        args.longitude != null &&
        !Number.isNaN(args.latitude) &&
        !Number.isNaN(args.longitude);
      // Refuse rather than provision when the identity authority does not call this session a
      // merchant. The onboarding wizard is reached only through the intent step, which is what
      // makes this session `merchant`; anything else has no business being given a workspace.
      if (!(await mayCreateOwnerWorkspace(authData.user))) {
        return { ok: false, message: "not_authorized_for_workspace" };
      }
      await bootstrapOwnerWorkspace(authData.user, {
        organizationName: args.shopName.trim(),
        shopDisplayName: args.shopName.trim(),
        businessType: args.businessType,
        fullName,
        districtId: args.districtId,
        phoneE164: args.phoneE164.trim(),
        address: args.address?.trim() || undefined,
        gpsMissing: !hasGps,
        latitude: hasGps ? args.latitude : undefined,
        longitude: hasGps ? args.longitude : undefined,
      });
      ({ data, error } = await callSaveRpc());
      if (error) return { ok: false, message: error.message };
    }
  }
  const jRetry = (data ?? {}) as { ok?: boolean; error?: string; detail?: string; shop_id?: string; organization_id?: string };
  if (jRetry.ok) return { ok: true, shopId: jRetry.shop_id, organizationId: jRetry.organization_id };
  const detail = jRetry.detail ? ` (${jRetry.detail})` : "";
  return { ok: false, message: `${jRetry.error ?? "save_failed"}${detail}` };
}

export type BusinessProfileInput = {
  shopName: string;
  businessType: BusinessType;
  currency: string;
  phone: string;
  address: string;
  ownerName?: string;
  /** FK to public.districts.id */
  districtId?: string | null;
  city?: string;
  area?: string;
  latitude?: number | null;
  longitude?: number | null;
  /** When true and lat/lng set, append a row to shop_locations */
  recordGpsInHistory?: boolean;
  /** When true, writes district / city / area / GPS columns on shops (Settings only). */
  applyShopLocation?: boolean;
};

export type PrimaryShopLocationSnapshot = {
  shopId: string;
  organizationId: string;
  shopName: string | null;
  phoneE164: string | null;
  districtId: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * User-facing message for save_owner_business_profile_bundle errors.
 *
 * EVERY code the server can return has a sentence here, and an unrecognised one gets a generic
 * sentence rather than being echoed. A merchant must never be shown `not_authorized_for_workspace`
 * or `profiles_phone_e164` — those are a database's words, not an instruction anyone can act on.
 * The raw value still reaches monitoring through the caller's `captureAppException`, so nothing
 * is lost for diagnosis; it just does not reach the person trying to open their shop.
 */
export function messageForProfileSaveError(codeOrMessage: string, lang: Language = "en"): string {
  // Defensive: this runs INSIDE a catch block, so throwing here would replace the real failure
  // with a confusing one of its own.
  const raw = String(codeOrMessage ?? "").toLowerCase();
  const lg = lang === "lg";
  if (raw.includes("phone_in_use") || raw.includes("profiles_phone_e164")) {
    return lg
      ? "Ennamba eno esangiddwa ku akawunti endala. Kebera oba wewandiise oba tuukirira support."
      : "This phone number is already on another Waka account. Check the number or contact support.";
  }
  if (raw.includes("profile_locked")) {
    return lg
      ? "Ebikwata ku dduuka tebikyusibwa. Tuukirira Waka support okukyusa."
      : "Shop details are locked. Contact Waka support to request changes.";
  }
  if (raw.includes("district_required")) {
    return lg ? "Londa ssaza." : "Choose a district before saving.";
  }
  if (raw.includes("invalid_phone")) {
    return lg ? "Ennamba ya Uganda si ntuufu." : "Enter a valid Uganda mobile number.";
  }
  if (raw.includes("shop_already_has_owner")) {
    return lg
      ? "Tewali kyongerwako — dduuka lino lirina nannyini waakyo."
      : "Could not save — your shop owner account is already set up.";
  }
  if (raw.includes("invalid_business_type")) {
    return lg
      ? "Ekika ky'ebizineesi tekitikkirizibwa. Londa ekika ekirala."
      : "That business type is not supported. Choose another one.";
  }
  // The session is authenticated but is not this workspace's owner — most often a Loyalty member,
  // or someone who reached the owner wizard without ever declaring merchant intent.
  if (raw.includes("not_authorized") || raw.includes("forbidden")) {
    return lg
      ? "Akawunti eno teri mu kukola bizineesi. Ddayo oyingire ng'omukyala wa dduuka oba tuukirira support."
      : "This account is not set up to run a shop. Sign in with your shop owner account, or contact support.";
  }
  // Google (and any OAuth) identity whose email the server has not accepted yet.
  if (raw.includes("email_not_verified") || raw.includes("email_verified")) {
    return lg
      ? "Tukakasa email yo. Ddayo oyingire, oba kkakasa email yo olyoke oddemu."
      : "We could not confirm your email yet. Verify your email, then try again.";
  }
  // No shop exists for this session YET: the workspace has not been provisioned. This is the
  // "provisioning was interrupted" case, so the message points at the action that fixes it.
  if (raw.includes("no_shop")) {
    return lg
      ? "Tewannabawo dduuka ku akawunti eno. Ddayo oyingire olyoke oddemu — tujja kukola dduuka lyo."
      : "Your shop has not been created yet. Sign out, sign in again, then finish this step.";
  }
  if (raw.includes("not_authenticated") || raw.includes("unauthorized") || raw.includes("jwt")) {
    return lg
      ? "Sessi yo egudde. Ddayo oyingire olyoke oddemu."
      : "Your session has expired. Sign in again to finish setting up.";
  }
  if (raw.includes("offline") || raw.includes("network") || raw.includes("failed to fetch")) {
    return lg
      ? "Tetusobodde kutuuka ku mukutu. Kebera internet yo olyoke oddemu."
      : "We could not reach Waka. Check your connection and try again.";
  }
  if (raw.includes("save_failed") || raw.includes("unavailable") || raw.includes("timeout")) {
    return lg
      ? "Tetunasobodde kutereka bikwata ku dduuka lyo. Gezaako nate."
      : "We could not save your shop details. Please try again.";
  }
  // Unknown code: say something true and actionable, and do not echo the machine's word for it.
  return lg
    ? "Tetunasobodde kutereka bikwata ku dduuka lyo. Gezaako nate, oba tuukirira support."
    : "We could not save your shop details. Please try again, or contact support.";
}

/** After cloud profile save: sync auth email, cache onboarding complete, update local prefs. */
export async function finalizeOwnerOnboardingAfterCloudSave(userId: string): Promise<void> {
  if (supabase) {
    const { data: authData } = await supabase.auth.getUser();
    const email = authData.user?.email?.trim().toLowerCase();
    if (email && email.includes("@") && !email.endsWith("@login.waka.ug")) {
      await supabase.from("profiles").update({ email }).eq("id", userId);
    }
  }
  writeCachedOwnerOnboardingComplete(userId, true);
  clearPendingRegistrationProfile();
  const store = usePosStore.getState();
  store.completeBusinessOnboarding(store.preferences.businessType);
  window.dispatchEvent(new CustomEvent("waka:onboarding-updated"));
}

export function normalizeUgPhoneE164(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+256${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `+256${digits}`;
  const compact = v.replace(/\s/g, "");
  if (compact.startsWith("+256") && /^\+256[0-9]{9}$/.test(compact)) return compact;
  return null;
}

export type RegistrationProfileSnapshot = {
  shopDisplayName: string;
  ownerFullName: string;
  phoneE164: string | null;
  districtId: string;
};

export function parseRegistrationProfileFromMeta(
  meta: Record<string, unknown> | undefined | null,
): RegistrationProfileSnapshot {
  const m = meta ?? {};
  const shopDisplayName =
    String(m.shop_display_name ?? "").trim() ||
    String(m.business_name ?? m.organization_name ?? m.shop_name ?? "").trim();
  return {
    shopDisplayName,
    ownerFullName: String(m.full_name ?? "").trim(),
    phoneE164: normalizeUgPhoneE164(String(m.phone_e164 ?? m.phone ?? "")),
    districtId: typeof m.district_id === "string" ? m.district_id : "",
  };
}

export async function loadRegistrationProfileFromAuth(): Promise<RegistrationProfileSnapshot | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return parseRegistrationProfileFromMeta(data.user.user_metadata as Record<string, unknown>);
}

export function applyRegistrationProfileToLocalStore(profile: RegistrationProfileSnapshot): void {
  const store = usePosStore.getState();
  store.setPreferences(
    {
      shopDisplayName: profile.shopDisplayName || store.preferences.shopDisplayName,
      shopPhoneE164: profile.phoneE164 ?? store.preferences.shopPhoneE164,
      shopCurrency: "UGX",
    },
    { silent: true },
  );
}

const ACTIVE_SHOP_PROFILE_COLUMNS =
  "id, organization_id, name, business_type, phone_e164, address_line, district_id, city, area, latitude, longitude";

type CloudShopProfileRow = {
  id: string;
  organization_id: string;
  name: string | null;
  business_type: string | null;
  phone_e164: string | null;
  address_line?: string | null;
  district_id: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Runtime profile reads bind to getActiveShopId() — never oldest membership.
 * shops SELECT RLS (user_can_access_shop) rejects shops the user cannot access.
 * No active shop → no-op (must not pick an arbitrary membership).
 */
export async function loadCloudShopProfileForActiveShop(): Promise<CloudShopProfileRow | null> {
  if (!supabase) return null;
  const shopId = getActiveShopId();
  if (!isValidShopId(shopId)) return null;

  const { data, error } = await supabase
    .from("shops")
    .select(ACTIVE_SHOP_PROFILE_COLUMNS)
    .eq("id", shopId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as CloudShopProfileRow;
  if (!row.id || row.id !== shopId) return null;
  // Shop switch during the round-trip: do not write into a different partition.
  if (getActiveShopId() !== shopId) return null;
  return row;
}

/** Oldest-membership lookup kept only for local-auth / bootstrap write fallback — not hydrate. */
async function getPrimaryShopForUser(userId: string) {
  if (!supabase) return null;
  const { data: member, error: memberErr } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member?.shop_id) return null;
  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, organization_id, name, business_type, phone_e164, district_id, city, area, latitude, longitude")
    .eq("id", member.shop_id)
    .maybeSingle();
  if (shopErr) throw shopErr;
  if (!shop) return null;
  return { shop };
}

/**
 * Pull the ACTIVE shop's cloud profile into that shop's local preferences.
 * Does not use oldest membership. No active shop → no-op.
 */
export async function hydrateLocalShopProfileFromCloud(): Promise<void> {
  if (!supabase) return;

  const s = await loadCloudShopProfileForActiveShop();
  if (!s) return;

  const shopName = String(s.name ?? "").trim();
  if (!shopName) return;

  const onboarding = await fetchOwnerOnboardingStatus();
  const store = usePosStore.getState();
  const businessType = (String(s.business_type ?? store.preferences.businessType ?? "kiosk_duka") ||
    "kiosk_duka") as BusinessType;
  const currency = "UGX";

  store.setPreferences(
    {
      shopDisplayName: shopName,
      shopPhoneE164: s.phone_e164 ? String(s.phone_e164) : store.preferences.shopPhoneE164,
      shopCurrency: currency,
    },
    { silent: true },
  );

  // Only skip the wizard when cloud onboarding is actually complete.
  if (onboarding?.complete) {
    store.completeBusinessOnboarding(businessType);
  } else if (store.preferences.onboardingDone && businessType !== store.preferences.businessType) {
    // This device is already onboarded, so the wizard is not at stake — but the shop row is the
    // authority for the business type (an admin can switch it). owner_onboarding_status() looks at
    // the caller's oldest membership and needs a real e-mail, so phone-login staff, placeholder
    // e-mails and multi-shop users never passed the check above and never picked the switch up.
    // Live table orders are kept (never destroyed) while the mode changes.
    store.updateBusinessType(businessType, undefined, { keepOpenOrders: true });
  }
}

let lastShopProfileRefreshAt = 0;

/**
 * Re-check the cloud business type without waiting for the next launch/login. Cheap and throttled:
 * called when the app returns to the foreground, so a switch made by an admin reaches a terminal
 * that was left running.
 */
export async function refreshShopProfileFromCloudThrottled(minIntervalMs = 5 * 60_000): Promise<void> {
  const now = Date.now();
  if (now - lastShopProfileRefreshAt < minIntervalMs) return;
  lastShopProfileRefreshAt = now;
  await hydrateLocalShopProfileFromCloud();
}

/** Test hook. */
export function resetShopProfileRefreshThrottleForTests(): void {
  lastShopProfileRefreshAt = 0;
}

/** Load active-shop row fields used by the location section in Settings. */
export async function loadPrimaryShopLocationFromCloud(): Promise<PrimaryShopLocationSnapshot | null> {
  if (!supabase) return null;
  const s = await loadCloudShopProfileForActiveShop();
  if (!s) return null;
  return {
    shopId: s.id,
    organizationId: s.organization_id,
    shopName: s.name ?? null,
    phoneE164: s.phone_e164 ?? null,
    districtId: s.district_id,
    city: s.city,
    area: s.area,
    latitude: s.latitude,
    longitude: s.longitude,
  };
}

export async function saveBusinessProfileToCloud(input: BusinessProfileInput, allowBusinessTypeChange: boolean): Promise<void> {
  if (!supabase) return;
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) throw authErr ?? new Error("Not signed in");
  const user = authData.user;

  const safePhone = normalizeUgPhoneE164(input.phone);
  const safeCurrency = "UGX";

  let primary = await getPrimaryShopForUser(user.id);
  if (!primary?.shop?.id) {
    const hasGps =
      input.applyShopLocation &&
      input.latitude != null &&
      input.longitude != null &&
      !Number.isNaN(input.latitude) &&
      !Number.isNaN(input.longitude);
    // Same veto as the settings-form path: the classifier decides, not the caller.
    if (!(await mayCreateOwnerWorkspace(user))) {
      throw new Error("not_authorized_for_workspace");
    }
    await bootstrapOwnerWorkspace(user, {
      organizationName: input.shopName.trim(),
      shopDisplayName: input.shopName.trim(),
      businessType: input.businessType,
      fullName: input.ownerName,
      districtId: input.districtId?.trim() || undefined,
      phoneE164: safePhone ?? undefined,
      address: input.address?.trim() || undefined,
      gpsMissing: !hasGps,
      latitude: hasGps ? input.latitude! : undefined,
      longitude: hasGps ? input.longitude! : undefined,
    });
    primary = await getPrimaryShopForUser(user.id);
    if (!primary?.shop?.id) throw new Error("Workspace not ready");
  }

  const shopId = primary.shop.id;
  const orgId = primary.shop.organization_id;
  const currentType = primary.shop.business_type;

  const shopPatch: Record<string, string | number | boolean | null> = {
    name: input.shopName.trim() || "My Shop",
    phone_e164: safePhone,
    address_line: input.address.trim() || null,
  };

  if (input.applyShopLocation) {
    let districtName: string | null = null;
    const did = input.districtId?.trim() || null;
    if (did) {
      const { data: drow } = await supabase.from("districts").select("name").eq("id", did).maybeSingle();
      districtName = (drow?.name as string | undefined)?.trim() || null;
    }
    shopPatch.district_id = did;
    shopPatch.district = districtName;
    shopPatch.city = (input.city ?? "").trim() || null;
    shopPatch.area = (input.area ?? "").trim() || null;
    if (input.latitude != null && input.longitude != null && !Number.isNaN(input.latitude) && !Number.isNaN(input.longitude)) {
      shopPatch.latitude = input.latitude;
      shopPatch.longitude = input.longitude;
    } else {
      shopPatch.latitude = null;
      shopPatch.longitude = null;
    }
    shopPatch.gps_missing = !(
      shopPatch.latitude != null &&
      shopPatch.longitude != null &&
      !Number.isNaN(Number(shopPatch.latitude)) &&
      !Number.isNaN(Number(shopPatch.longitude))
    );
  }

  if (allowBusinessTypeChange || !currentType) {
    shopPatch.business_type = input.businessType;
  }

  const { error: shopErr } = await supabase.from("shops").update(shopPatch).eq("id", shopId);
  if (shopErr) throw shopErr;

  if (
    input.applyShopLocation &&
    input.recordGpsInHistory &&
    input.latitude != null &&
    input.longitude != null &&
    !Number.isNaN(input.latitude) &&
    !Number.isNaN(input.longitude)
  ) {
    const { error: locErr } = await supabase.from("shop_locations").insert({
      shop_id: shopId,
      latitude: input.latitude,
      longitude: input.longitude,
      source: "device_gps",
      is_primary: true,
    });
    if (locErr) throw locErr;
  }

  const { error: orgErr } = await supabase.from("organizations").update({ default_currency: safeCurrency }).eq("id", orgId);
  if (orgErr) throw orgErr;

  if (safePhone) {
    const { data: conflict } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone_e164", safePhone)
      .neq("id", user.id)
      .maybeSingle();
    if (conflict?.id) {
      throw new Error("phone_in_use");
    }
  }

  const profilePatch = {
    id: user.id,
    full_name: input.ownerName?.trim() || null,
    business_name: input.shopName.trim() || null,
    phone_e164: safePhone,
  };
  const { error: profileErr } = await supabase.from("profiles").upsert(profilePatch);
  if (profileErr) throw profileErr;
}

