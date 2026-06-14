import type { SessionActor } from "./sessionActor";
import type { ShopPreferences, StaffAccount, UserRole } from "../types";
import { staffHasBackOfficeUnlockSecret, staffSecretMatches } from "./staffSecret";

export type BackOfficeUnlockVia = "staff_pin" | "shop_pin" | "open_no_pin";

export type BackOfficeUnlockSuccess = {
  ok: true;
  via: BackOfficeUnlockVia;
  role: UserRole;
  actorUserId: string;
  actorLabel: string;
  staffId?: string;
};

export type BackOfficeUnlockFailure = {
  ok: false;
  via: "staff_pin" | "shop_pin";
};

export type BackOfficeUnlockResult = BackOfficeUnlockSuccess | BackOfficeUnlockFailure;

const UNLOCK_STAFF_ROLES = new Set<UserRole>(["owner", "manager"]);

function matchingStaff(staff: StaffAccount[], pin: string): StaffAccount | null {
  return staff.find((s) => s.active && UNLOCK_STAFF_ROLES.has(s.role) && staffSecretMatches(s, pin)) ?? null;
}

/** Whether Back Office requires a PIN modal before access. */
export function isBackOfficePinRequired(preferences: Pick<ShopPreferences, "backOfficePin" | "staffAccounts">): boolean {
  const stored = preferences.backOfficePin?.trim() ?? "";
  if (stored.length > 0) return true;
  return (preferences.staffAccounts ?? []).some(staffHasBackOfficeUnlockSecret);
}

/** Resolve Back Office unlock — staff PIN (owner/manager) takes precedence over shop PIN. */
export function resolveBackOfficeUnlock(
  pin: string,
  preferences: ShopPreferences,
  sessionActor: SessionActor | null,
): BackOfficeUnlockResult {
  const stored = preferences.backOfficePin?.trim() ?? "";
  const staff = preferences.staffAccounts ?? [];
  const normalized = pin.trim();
  const digits = normalized.replace(/\D/g, "");
  const matched = matchingStaff(staff, normalized);

  if (matched) {
    return {
      ok: true,
      via: "staff_pin",
      role: matched.role,
      actorUserId: `staff:${matched.id}`,
      actorLabel: matched.name,
      staffId: matched.id,
    };
  }

  if (!stored) {
    if (staff.length === 0) {
      const role = sessionActor?.role ?? "owner";
      return {
        ok: true,
        via: "open_no_pin",
        role,
        actorUserId: sessionActor?.userId ?? "unknown",
        actorLabel: sessionActor?.displayName ?? role,
      };
    }
    return { ok: false, via: "staff_pin" };
  }

  if (digits === stored.replace(/\D/g, "")) {
    const role = sessionActor?.role === "manager" ? "manager" : sessionActor?.role === "owner" ? "owner" : "owner";
    return {
      ok: true,
      via: "shop_pin",
      role,
      actorUserId: sessionActor?.userId ?? "unknown",
      actorLabel: sessionActor?.displayName ?? role,
    };
  }

  return { ok: false, via: "shop_pin" };
}
