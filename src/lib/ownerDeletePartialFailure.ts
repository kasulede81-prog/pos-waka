import type { HardDeleteVerificationReport } from "./hardDeleteReport";

const PARTIAL_FAILURE_KEY = "waka.ownerDelete.partialFailure.v1";

export type OwnerDeletePartialFailure = {
  shopId?: string | null;
  shopName?: string | null;
  organizationId?: string | null;
  shopIds?: string[];
  staffUserIds?: string[];
  message?: string;
  deletionReport?: HardDeleteVerificationReport | null;
  markedAt: string;
};

export function readOwnerDeletePartialFailure(): OwnerDeletePartialFailure | null {
  try {
    const raw = localStorage.getItem(PARTIAL_FAILURE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<OwnerDeletePartialFailure>;
    if (!o.markedAt) return null;
    return {
      shopId: o.shopId ?? null,
      shopName: o.shopName ?? null,
      organizationId: o.organizationId ?? null,
      shopIds: Array.isArray(o.shopIds) ? o.shopIds.map(String) : [],
      staffUserIds: Array.isArray(o.staffUserIds) ? o.staffUserIds.map(String) : [],
      message: typeof o.message === "string" ? o.message : undefined,
      deletionReport: o.deletionReport ?? null,
      markedAt: o.markedAt,
    };
  } catch {
    return null;
  }
}

export function writeOwnerDeletePartialFailure(
  input: Omit<OwnerDeletePartialFailure, "markedAt">,
): void {
  try {
    localStorage.setItem(
      PARTIAL_FAILURE_KEY,
      JSON.stringify({ ...input, markedAt: new Date().toISOString() } satisfies OwnerDeletePartialFailure),
    );
  } catch {
    /* ignore */
  }
}

export function clearOwnerDeletePartialFailure(): void {
  try {
    localStorage.removeItem(PARTIAL_FAILURE_KEY);
  } catch {
    /* ignore */
  }
}
