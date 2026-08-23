/**
 * Phase 10 — seller identity read helpers.
 * Commercial seller = Auth UUID on sale / cloud sold_by_user_id.
 * Does not change push, SessionActor, or PIN auth.
 */

import type { Sale } from "../types";
import type { SessionActor } from "./sessionActor";
import { commercialAuthUserIdFromActor, normalizeLinkedAuthUserId } from "./sessionActor";

const AUTH_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAuthSellerUuid(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  return AUTH_UUID_RE.test(trimmed);
}

/** First Auth UUID among candidates, else null. Never treats staff:/local: as Auth. */
export function firstAuthSellerUuid(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const raw of candidates) {
    const trimmed = raw?.trim() ?? "";
    if (isAuthSellerUuid(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Reconstruct local soldByUserId from a cloud sales row.
 * Prefer sold_by_user_id (commercial); fallback created_by (legacy).
 * Never invents identity from staff: prefixes (those are client-only).
 */
export function soldByUserIdFromCloudSaleRow(row: {
  sold_by_user_id?: unknown;
  created_by?: unknown;
}): string | null {
  const soldBy =
    typeof row.sold_by_user_id === "string" ? row.sold_by_user_id.trim() : "";
  if (isAuthSellerUuid(soldBy)) return soldBy;
  const createdBy = typeof row.created_by === "string" ? row.created_by.trim() : "";
  return createdBy || null;
}

export function soldByAuthUserIdFromCloudSaleRow(row: {
  sold_by_user_id?: unknown;
}): string | null {
  const soldBy =
    typeof row.sold_by_user_id === "string" ? row.sold_by_user_id.trim() : "";
  return isAuthSellerUuid(soldBy) ? soldBy : null;
}

export type SellerMatchActor = Pick<SessionActor, "userId" | "linkedAuthUserId">;

/**
 * Identity-aware personal-scope match for cashier filters.
 * Auth UUID, Path S linkedAuthUserId, and legacy staff:<id> all supported.
 */
export function saleSoldByMatchesActor(
  sale: Pick<Sale, "soldByUserId" | "soldByAuthUserId">,
  actor: SellerMatchActor | null | undefined,
): boolean {
  if (!actor?.userId) return false;
  const sold = sale.soldByUserId?.trim() ?? "";
  const soldAuth = normalizeLinkedAuthUserId(sale.soldByAuthUserId);
  if (!sold && !soldAuth) return false;

  if (sold && sold === actor.userId) return true;

  const commercial = commercialAuthUserIdFromActor(actor);
  if (commercial) {
    if (sold && sold === commercial) return true;
    if (soldAuth && soldAuth === commercial) return true;
  }
  return false;
}

/**
 * Merge commercial seller fields (fill-once friendly).
 * - Remote/local Auth UUID wins over null / staff:
 * - If both sides already have Auth UUIDs, keep the established (a) identity — no UUID→other UUID flip
 * - Preserve offline staff:<id> when neither side has commercial Auth
 */
export function mergeCommercialSellerFields(
  a: Pick<Sale, "soldByUserId" | "soldByAuthUserId">,
  b: Pick<Sale, "soldByUserId" | "soldByAuthUserId">,
): { soldByUserId: string | null; soldByAuthUserId: string | null } {
  const aCommercial = firstAuthSellerUuid(a.soldByUserId, a.soldByAuthUserId);
  const bCommercial = firstAuthSellerUuid(b.soldByUserId, b.soldByAuthUserId);

  let soldByAuthUserId: string | null = null;
  if (aCommercial && bCommercial) {
    soldByAuthUserId = aCommercial;
  } else {
    soldByAuthUserId = bCommercial ?? aCommercial;
  }

  if (soldByAuthUserId) {
    return { soldByUserId: soldByAuthUserId, soldByAuthUserId };
  }

  const aStaff = a.soldByUserId?.trim() || null;
  const bStaff = b.soldByUserId?.trim() || null;
  if (aStaff?.startsWith("staff:")) return { soldByUserId: aStaff, soldByAuthUserId: null };
  if (bStaff?.startsWith("staff:")) return { soldByUserId: bStaff, soldByAuthUserId: null };
  return { soldByUserId: aStaff ?? bStaff, soldByAuthUserId: null };
}
