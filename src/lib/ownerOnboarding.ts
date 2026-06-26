import { supabase } from "./supabase";

export type OwnerOnboardingStatus = {
  complete: boolean;
  missing: string[];
};

const CACHE_PREFIX = "waka.ownerOnboarding.v1:";

export function readCachedOwnerOnboardingComplete(userId: string | undefined): boolean | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { complete?: boolean };
    return typeof parsed.complete === "boolean" ? parsed.complete : null;
  } catch {
    return null;
  }
}

export function writeCachedOwnerOnboardingComplete(userId: string, complete: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${CACHE_PREFIX}${userId}`, JSON.stringify({ complete, at: Date.now() }));
  } catch {
    /* ignore quota */
  }
}

export async function fetchOwnerOnboardingStatus(): Promise<OwnerOnboardingStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("owner_onboarding_status");
  if (error || data == null || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  const missingRaw = j.missing;
  const missing = Array.isArray(missingRaw) ? (missingRaw as unknown[]).map((x) => String(x)) : [];
  const complete = Boolean(j.complete);
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user?.id) writeCachedOwnerOnboardingComplete(userData.user.id, complete);
  return { complete, missing };
}

/** True when cloud RPC says the post-signup wizard is still required. */
export async function isFreshOwnerPendingSetup(): Promise<boolean> {
  const status = await fetchOwnerOnboardingStatus().catch(() => null);
  return status != null && !status.complete;
}
