/** Stable id for restocks with no fixed supplier (town / market buys). */
export const WALK_IN_SUPPLIER_ID = "00000000-0000-4000-a000-000000000001";

export function isWalkInSupplierId(supplierId: string | null | undefined): boolean {
  if (!supplierId) return true;
  return supplierId === WALK_IN_SUPPLIER_ID;
}
