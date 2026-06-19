/** Per-alert owner review state — critical/warning items stay until acknowledged. */

export type OwnerAlertAcknowledgement = {
  alertId: string;
  acknowledgedAt: string;
  acknowledgedBy: string;
};

export function isAlertAcknowledged(
  alertId: string,
  acknowledgements: OwnerAlertAcknowledgement[] | null | undefined,
): boolean {
  return (acknowledgements ?? []).some((a) => a.alertId === alertId);
}

export function partitionAttentionByAck<T extends { id: string; severity: string }>(
  items: T[],
  acknowledgements: OwnerAlertAcknowledgement[] | null | undefined,
): { active: T[]; reviewed: T[] } {
  const active: T[] = [];
  const reviewed: T[] = [];
  for (const item of items) {
    if (item.severity === "information" || !isAlertAcknowledged(item.id, acknowledgements)) {
      active.push(item);
    } else {
      reviewed.push(item);
    }
  }
  return { active, reviewed };
}

export function appendAcknowledgement(
  existing: OwnerAlertAcknowledgement[] | null | undefined,
  alertId: string,
  acknowledgedBy: string,
): OwnerAlertAcknowledgement[] {
  const now = new Date().toISOString();
  const list = [...(existing ?? [])];
  const idx = list.findIndex((a) => a.alertId === alertId);
  const entry: OwnerAlertAcknowledgement = { alertId, acknowledgedAt: now, acknowledgedBy };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  return list.slice(-200);
}
