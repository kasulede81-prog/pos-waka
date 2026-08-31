/**
 * Investigation Center actor attribution — preserve client actor identity across cloud push/pull.
 * Does not invent identity; does not substitute current user for staff display.
 */

import type { AuditLogEntry, Language, StaffAccount } from "../types";
import { actorDisplayLabel } from "./activityNarrative";
import { t } from "./i18n";

/** Payload keys for original client-side actor (survives RLS column coercion). */
export const CLIENT_ACTOR_USER_ID_KEY = "clientActorUserId";
export const CLIENT_ACTOR_NAME_KEY = "clientActorName";

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Prepare cloud insert: RLS requires actor_user_id = auth.uid().
 * Always preserve the original local actor in payload; never drop staff identity.
 */
export function prepareAuditCloudPush(entry: AuditLogEntry, authUserId: string): {
  actorUserIdForRow: string;
  payload: Record<string, unknown>;
} {
  const payload: Record<string, unknown> = { ...entry.payload };
  const originalId = entry.actorUserId?.trim() || "unknown";
  if (typeof payload[CLIENT_ACTOR_USER_ID_KEY] !== "string") {
    payload[CLIENT_ACTOR_USER_ID_KEY] = originalId;
  }
  const name = entry.actorName?.trim();
  if (name && typeof payload[CLIENT_ACTOR_NAME_KEY] !== "string") {
    payload[CLIENT_ACTOR_NAME_KEY] = name;
  }
  // Column must satisfy RLS (auth.uid()); original identity lives in payload.
  return { actorUserIdForRow: authUserId, payload };
}

/** Restore client actor fields after cloud pull (prefer payload over coerced column). */
export function restoreActorFromAuditPayload(entry: AuditLogEntry): AuditLogEntry {
  const pl = entry.payload ?? {};
  const clientId = typeof pl[CLIENT_ACTOR_USER_ID_KEY] === "string" ? pl[CLIENT_ACTOR_USER_ID_KEY].trim() : "";
  const clientName =
    typeof pl[CLIENT_ACTOR_NAME_KEY] === "string" ? pl[CLIENT_ACTOR_NAME_KEY].trim() : "";
  return {
    ...entry,
    actorUserId: clientId || entry.actorUserId || "unknown",
    actorName: clientName || entry.actorName,
  };
}

export function buildStaffNameById(accounts: StaffAccount[] | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of accounts ?? []) {
    if (!s?.id) continue;
    const name = s.name?.trim();
    if (!name) continue;
    map.set(s.id, name);
    map.set(`staff:${s.id}`, name);
  }
  return map;
}

/**
 * Display label for Investigation Center.
 * Prefer stored actorName → staff directory → safe unknown label.
 * Never substitutes "current user".
 */
export function resolveInvestigationActorLabel(
  lang: Language,
  entry: AuditLogEntry,
  staffNameById: Map<string, string>,
): string {
  const named = entry.actorName?.trim();
  if (named) return named;

  const id = entry.actorUserId?.trim() || "unknown";
  if (!id || id === "unknown") return t(lang, "actorUnknown");

  const fromStaff = staffNameById.get(id);
  if (fromStaff) return fromStaff;

  if (id.startsWith("staff:")) {
    const bare = id.slice("staff:".length);
    const byBare = staffNameById.get(bare);
    if (byBare) return byBare;
  }

  return actorDisplayLabel(id, lang);
}
