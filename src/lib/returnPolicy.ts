import type { ReturnReason, UserRole } from "../types";

/** Only sellable returns go back on the shelf; damaged/warm/broken stay out of stock. */
export function returnRestocksInventory(reason: ReturnReason): boolean {
  return reason === "wrong_item";
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
  const linked = Boolean(input.saleId && input.saleFound);
  if (linked) return { ok: true };

  if (!canPerformUnlinkedReturn(input.role)) {
    return { ok: false, errorKey: "returnUnlinkedForbidden" };
  }

  if (input.note.trim().length < 3) {
    return { ok: false, errorKey: "returnUnlinkedNoteRequired" };
  }

  return { ok: true };
}
