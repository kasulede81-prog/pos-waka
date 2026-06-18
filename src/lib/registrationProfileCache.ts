export type PendingRegistrationProfile = {
  shopDisplayName: string;
  ownerFullName: string;
  phoneE164: string | null;
  districtId: string;
};

const KEY = "waka.pendingRegistrationProfile.v1";

type Cached = PendingRegistrationProfile & { userId?: string | null };

export function cachePendingRegistrationProfile(profile: PendingRegistrationProfile, userId: string): void {
  try {
    const payload: Cached = { ...profile, userId };
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readPendingRegistrationProfileForUser(userId: string): PendingRegistrationProfile | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (parsed.userId && parsed.userId !== userId) return null;
    return {
      shopDisplayName: String(parsed.shopDisplayName ?? "").trim(),
      ownerFullName: String(parsed.ownerFullName ?? "").trim(),
      phoneE164: parsed.phoneE164 ?? null,
      districtId: typeof parsed.districtId === "string" ? parsed.districtId : "",
    };
  } catch {
    return null;
  }
}

export function clearPendingRegistrationProfile(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
