import { supabase } from "./supabase";

export type OwnerOnboardingStatus = {
  complete: boolean;
  missing: string[];
};

export async function fetchOwnerOnboardingStatus(): Promise<OwnerOnboardingStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("owner_onboarding_status");
  if (error || data == null || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  const missingRaw = j.missing;
  const missing = Array.isArray(missingRaw) ? (missingRaw as unknown[]).map((x) => String(x)) : [];
  return { complete: Boolean(j.complete), missing };
}
