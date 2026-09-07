/**
 * SALES-RETURN-01 — resolve a linked-return sale from RAM only.
 * returnProduct is synchronous; do not load entityStore / cloud here.
 */

export type LocalSaleBucket = "sales" | "archivedSales";

export function explicitLinkedSaleId(saleId: string | null | undefined): string | null {
  const id = String(saleId ?? "").trim();
  return id.length > 0 ? id : null;
}

export function resolveLocalSaleForReturn<T extends { id: string }>(
  saleId: string | null | undefined,
  sales: readonly T[],
  archivedSales: readonly T[] = [],
): { sale: T; bucket: LocalSaleBucket } | null {
  const id = explicitLinkedSaleId(saleId);
  if (!id) return null;
  const live = sales.find((s) => s.id === id);
  if (live) return { sale: live, bucket: "sales" };
  const archived = archivedSales.find((s) => s.id === id);
  if (archived) return { sale: archived, bucket: "archivedSales" };
  return null;
}
