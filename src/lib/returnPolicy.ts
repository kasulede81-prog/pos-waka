import type { ReturnReason, UserRole } from "../types";

const UNSELLABLE_RETURN_REASONS: ReadonlySet<ReturnReason> = new Set([
  "damaged",
  "broken",
  "warm_bad",
]);

/** Sellable returns go back on the shelf. Damaged / broken / warm stay out (write-off). */
export function returnRestocksInventory(reason: ReturnReason): boolean {
  return !UNSELLABLE_RETURN_REASONS.has(reason);
}

const UNLINKED_RETURN_ROLES: ReadonlySet<UserRole> = new Set(["owner", "manager"]);

export function canPerformUnlinkedReturn(role: UserRole): boolean {
  return UNLINKED_RETURN_ROLES.has(role);
}

export type ReturnAuthInput = {
  role: UserRole;
  saleId: string | null | undefined;
  saleFound: boolean;
  note: string;
};

export function validateReturnAuthorization(input: ReturnAuthInput): { ok: true } | { ok: false; errorKey: string } {
  const hasSaleId = Boolean(String(input.saleId ?? "").trim());
  if (hasSaleId && !input.saleFound) {
    return { ok: false, errorKey: "returnSaleUnavailable" };
  }
  if (hasSaleId && input.saleFound) return { ok: true };

  if (!canPerformUnlinkedReturn(input.role)) {
    return { ok: false, errorKey: "returnUnlinkedForbidden" };
  }

  if (input.note.trim().length < 3) {
    return { ok: false, errorKey: "returnUnlinkedNoteRequired" };
  }

  return { ok: true };
}
