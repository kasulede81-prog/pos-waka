/** Minimum audit reason length for sensitive operations. */
export const AUDIT_REASON_MIN_LEN = 3;

export function validateAuditReason(reason: string | undefined | null): boolean {
  return (reason ?? "").trim().length >= AUDIT_REASON_MIN_LEN;
}

export function normalizeAuditReason(reason: string): string {
  return reason.trim();
}

export type AuditReasonRequiredAction =
  | "product_remove"
  | "price_change"
  | "purchase_void"
  | "cash_expense_voided"
  | "stock_adjust";

export function auditReasonErrorKey(): string {
  return "auditReasonRequired";
}
