import type { AuditLogEntry, Language, ShiftRecord, StaffAccount } from "../types";
import { t } from "./i18n";

export type SoldByLabelContext = {
  lang: Language;
  nameByUserId: Map<string, string>;
  shopDisplayName?: string | null;
};

/** Build userId → display name lookup for sold-by attribution. */
export function buildSoldByNameByUserId(params: {
  staffAccounts?: StaffAccount[];
  shifts?: ShiftRecord[];
  auditLogs?: AuditLogEntry[];
  ownerUserId?: string | null;
  ownerDisplayName?: string | null;
  shopDisplayName?: string | null;
}): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of params.staffAccounts ?? []) {
    const name = s.name?.trim();
    if (name) map.set(`staff:${s.id}`, name);
  }
  for (const sh of params.shifts ?? []) {
    const name = sh.actorName?.trim();
    if (sh.actorUserId && name) map.set(sh.actorUserId, name);
  }
  for (const e of params.auditLogs ?? []) {
    const name = e.actorName?.trim();
    if (!e.actorUserId || !name) continue;
    map.set(e.actorUserId, name);
    if (e.action === "sale_completed") {
      const pl = e.payload as Record<string, unknown>;
      const soldBy = typeof pl.soldByUserId === "string" ? pl.soldByUserId.trim() : "";
      if (soldBy) map.set(soldBy, name);
    }
  }
  const ownerLabel = params.ownerDisplayName?.trim() || params.shopDisplayName?.trim();
  if (params.ownerUserId && ownerLabel) {
    map.set(params.ownerUserId, ownerLabel);
  }
  return map;
}

export function resolveSoldByUserId(
  lang: Language,
  soldByUserId: string | null | undefined,
  nameByUserId: Map<string, string>,
  shopDisplayName?: string | null,
): string {
  const id = soldByUserId?.trim() ?? "";
  if (!id) return shopDisplayName?.trim() || t(lang, "role_owner");
  const known = nameByUserId.get(id);
  if (known) return known;
  if (id.startsWith("staff:")) return t(lang, "role_cashier");
  if (id.startsWith("local:")) {
    const rest = id.slice("local:".length).trim();
    return rest || shopDisplayName?.trim() || t(lang, "role_owner");
  }
  return shopDisplayName?.trim() || t(lang, "role_owner");
}
