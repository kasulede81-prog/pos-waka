export type ReceivePayStatus = "unpaid" | "partial" | "paid";

export function receivePayStatusFromAmounts(totalUgx: number, paidUgx: number): ReceivePayStatus {
  const total = Math.max(0, Math.floor(totalUgx));
  const paid = Math.max(0, Math.floor(paidUgx));
  if (total <= 0 || paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

/** Amount sent to recordPurchase from the receive payment radios. */
export function paidUgxForReceiveStatus(
  status: ReceivePayStatus,
  totalUgx: number,
  typedPaidUgx: number,
): number {
  const total = Math.max(0, Math.floor(totalUgx));
  if (status === "unpaid") return 0;
  if (status === "paid") return total;
  return Math.min(total, Math.max(0, Math.floor(typedPaidUgx)));
}
