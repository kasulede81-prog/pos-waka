import type {
  HospitalityFloorState,
  KitchenTicket,
  KitchenTicketItem,
  Product,
  SaleLine,
  TableSession,
} from "../types";
import { ensureSaleLineId } from "./pendingSaleMerge";
import { syncTableDisplayStatuses } from "./hospitality";
import { firedQtyByProductForSale, resolveStationForProduct } from "./kitchenRouting";

export function nextKitchenTicketNumber(floor: HospitalityFloorState): number {
  const today = new Date().toISOString().slice(0, 10);
  let max = 0;
  for (const t of floor.kitchenTickets ?? []) {
    if (!t.firedAt.startsWith(today)) continue;
    max = Math.max(max, t.ticketNumber);
  }
  return max + 1;
}

export function fireKitchenTicketsForLines(input: {
  floor: HospitalityFloorState;
  session: TableSession;
  previousLines: SaleLine[];
  newLines: SaleLine[];
  products: Product[];
  tableLabel: string;
  areaName?: string | null;
}): HospitalityFloorState {
  const firedQty = firedQtyByProductForSale(input.floor.kitchenTickets ?? [], input.session.saleId);
  const deltas = deltaLinesSinceWithFired(input.previousLines, input.newLines, firedQty);
  if (!deltas.length) return input.floor;

  const byStation = new Map<string, KitchenTicketItem[]>();
  const stationMeta = new Map<string, { stationType: KitchenTicket["stationType"]; stationId: string }>();

  for (const line of deltas) {
    const product = input.products.find((p) => p.id === line.productId);
    if (!product) continue;
    const station = resolveStationForProduct(product, input.floor.stations);
    if (!station) continue;
    const items = byStation.get(station.id) ?? [];
    items.push({
      id: crypto.randomUUID(),
      productId: line.productId,
      productName: line.name,
      quantity: line.quantity,
    });
    byStation.set(station.id, items);
    stationMeta.set(station.id, { stationId: station.id, stationType: station.stationType });
  }

  if (byStation.size === 0) return input.floor;

  let ticketNo = nextKitchenTicketNumber(input.floor);
  const newTickets: KitchenTicket[] = [];
  for (const [stationId, items] of byStation) {
    const meta = stationMeta.get(stationId)!;
    newTickets.push({
      id: crypto.randomUUID(),
      tableSessionId: input.session.id,
      saleId: input.session.saleId,
      stationId: meta.stationId,
      stationType: meta.stationType,
      status: "queued",
      ticketNumber: ticketNo++,
      firedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tableLabel: input.tableLabel,
      areaName: input.areaName ?? null,
      waiterLabel: input.session.waiterLabel ?? null,
      items,
      pendingSync: true,
    });
  }

  return {
    ...input.floor,
    kitchenTickets: [...(input.floor.kitchenTickets ?? []), ...newTickets],
  };
}

export function updateKitchenTicketStatus(
  floor: HospitalityFloorState,
  ticketId: string,
  status: KitchenTicket["status"],
): HospitalityFloorState {
  const kitchenTickets = (floor.kitchenTickets ?? []).map((t) =>
    t.id === ticketId ? { ...t, status, updatedAt: new Date().toISOString(), pendingSync: true } : t,
  );
  return { ...floor, kitchenTickets };
}

export function cancelKitchenTicket(floor: HospitalityFloorState, ticketId: string): HospitalityFloorState {
  return updateKitchenTicketStatus(floor, ticketId, "cancelled");
}

export function pruneServedKitchenTickets(floor: HospitalityFloorState, maxAgeHours = 12): HospitalityFloorState {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const kitchenTickets = (floor.kitchenTickets ?? []).filter((t) => {
    if (t.status !== "served" && t.status !== "cancelled") return true;
    const at = Date.parse(t.updatedAt ?? t.firedAt);
    return !Number.isFinite(at) || at >= cutoff;
  });
  return { ...floor, kitchenTickets };
}

export function transferSessionToTable(
  floor: HospitalityFloorState,
  sessionId: string,
  toTableId: string,
): { floor: HospitalityFloorState; saleReference?: string } {
  const session = floor.sessions.find((s) => s.id === sessionId);
  const targetTable = floor.tables.find((t) => t.id === toTableId);
  if (!session || !targetTable || !targetTable.isActive) {
    return { floor };
  }
  if (floor.sessions.some((s) => s.tableId === toTableId && s.id !== sessionId && (s.status === "open" || s.status === "payment_pending"))) {
    return { floor };
  }
  const area = floor.areas.find((a) => a.id === targetTable.areaId);
  const saleReference = `${targetTable.label}${area ? ` · ${area.name}` : ""}`;
  const sessions = floor.sessions.map((s) =>
    s.id === sessionId ? { ...s, tableId: toTableId, pendingSync: true } : s,
  );
  return {
    floor: syncTableDisplayStatuses({ ...floor, sessions }),
    saleReference,
  };
}

export function mergeSessionsOnFloor(
  floor: HospitalityFloorState,
  sourceSessionId: string,
  targetSessionId: string,
): HospitalityFloorState {
  const source = floor.sessions.find((s) => s.id === sourceSessionId);
  const target = floor.sessions.find((s) => s.id === targetSessionId);
  if (!source || !target) return floor;
  if (source.id === target.id) return floor;
  const now = new Date().toISOString();
  const sessions = floor.sessions.map((s) => {
    if (s.id === sourceSessionId) return { ...s, status: "merged" as const, closedAt: now };
    return s;
  });
  return syncTableDisplayStatuses({ ...floor, sessions });
}

export function mergeSaleLines(target: SaleLine[], source: SaleLine[]): SaleLine[] {
  const merged = target.map((l) => ensureSaleLineId(l));
  for (const line of source.map(ensureSaleLineId)) {
    const idx = merged.findIndex((l) => l.productId === line.productId);
    if (idx === -1) {
      merged.push({ ...line });
      continue;
    }
    const cur = merged[idx]!;
    const qty = cur.quantity + line.quantity;
    const unit = cur.unitPriceUgx;
    const now = new Date().toISOString();
    merged[idx] = {
      ...cur,
      quantity: qty,
      updatedAt: now,
      lineTotalUgx: Math.round(unit * qty),
      originalLineTotalUgx: Math.round((cur.originalLineTotalUgx ?? cur.lineTotalUgx) + (line.originalLineTotalUgx ?? line.lineTotalUgx)),
      estimatedProfitUgx: cur.estimatedProfitUgx + line.estimatedProfitUgx,
    };
  }
  return merged;
}

function deltaLinesSinceWithFired(
  previous: SaleLine[],
  current: SaleLine[],
  firedQtyByProduct: Map<string, number>,
): SaleLine[] {
  const prev = new Map<string, number>();
  for (const line of previous) {
    prev.set(line.productId, (prev.get(line.productId) ?? 0) + line.quantity);
  }
  const out: SaleLine[] = [];
  for (const line of current) {
    const baseline = Math.max(prev.get(line.productId) ?? 0, firedQtyByProduct.get(line.productId) ?? 0);
    const delta = line.quantity - baseline;
    if (delta > 0.0001) {
      out.push({ ...line, quantity: delta });
    }
  }
  return out;
}

export function activeKitchenTickets(floor: HospitalityFloorState, stationType?: KitchenTicket["stationType"]) {
  return (floor.kitchenTickets ?? [])
    .filter((t) => t.status !== "served" && t.status !== "cancelled")
    .filter((t) => !stationType || t.stationType === stationType)
    .sort((a, b) => a.firedAt.localeCompare(b.firedAt));
}
