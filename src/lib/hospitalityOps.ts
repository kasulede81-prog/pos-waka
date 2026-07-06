import type {
  HospitalityCourse,
  HospitalityFloorState,
  KitchenStationType,
  KitchenTicket,
  KitchenTicketItem,
  Product,
  SaleLine,
  TableSession,
} from "../types";
import { ensureSaleLineId } from "./pendingSaleMerge";
import { syncTableDisplayStatuses } from "./hospitality";
import { firedQtyByProductForSale, firedQtyByLineIdForSale, resolveStationForProduct } from "./kitchenRouting";
import {
  formatKitchenNotesFromLine,
  formatModifierLabels,
  resolveLinePrepTimeMinutes,
} from "./menuModifiers";
import {
  activeProductionTickets,
  normalizeKitchenTicket,
  sessionOrderRound,
  TERMINAL_KITCHEN_STATUSES,
  updateKitchenTicketToStatus,
} from "./kitchenProduction";
import {
  HOSPITALITY_COURSES,
  resolveProductDefaultCourse,
} from "./productHospitalityRouting";

export { activeProductionTickets as activeKitchenTickets };

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
  /** When set, only fire tickets for these station types (kitchen vs bar). */
  stationTypes?: KitchenStationType[];
  /** Fire-by-course — only items matching these courses. */
  courses?: HospitalityCourse[];
  priority?: KitchenTicket["priority"];
}): HospitalityFloorState {
  const firedQty = firedQtyByProductForSale(input.floor.kitchenTickets ?? [], input.session.saleId);
  const firedByLine = firedQtyByLineIdForSale(input.floor.kitchenTickets ?? [], input.session.saleId);
  const deltas = deltaLinesSinceWithFired(input.previousLines, input.newLines, firedQty, firedByLine);
  if (!deltas.length) return input.floor;

  const typeFilter = input.stationTypes?.length ? new Set(input.stationTypes) : null;
  const courseFilter = input.courses?.length ? new Set(input.courses) : null;
  const byStation = new Map<string, KitchenTicketItem[]>();
  const stationMeta = new Map<string, { stationType: KitchenTicket["stationType"]; stationId: string }>();
  const orderRound = sessionOrderRound(input.floor, input.session.id);

  for (const line of deltas) {
    const product = input.products.find((p) => p.id === line.productId);
    if (!product) continue;
    const course = resolveProductDefaultCourse(product);
    if (courseFilter && !courseFilter.has(course)) continue;
    const station = resolveStationForProduct(product, input.floor.stations);
    if (!station) continue;
    if (typeFilter && !typeFilter.has(station.stationType)) continue;
    const items = byStation.get(station.id) ?? [];
    const lineId = ensureSaleLineId(line).id ?? line.productId;
    items.push({
      id: crypto.randomUUID(),
      productId: line.productId,
      productName: line.name,
      quantity: line.quantity,
      notes: formatKitchenNotesFromLine(line),
      modifierLabels: formatModifierLabels(line.selectedModifiers ?? []),
      variantLabel: line.variantLabel ?? null,
      saleLineId: lineId,
      course,
      prepTimeMinutes: resolveLinePrepTimeMinutes(product, line),
      itemStatus: "active",
    });
    byStation.set(station.id, items);
    stationMeta.set(station.id, { stationId: station.id, stationType: station.stationType });
  }

  if (byStation.size === 0) return input.floor;

  let ticketNo = nextKitchenTicketNumber(input.floor);
  const now = new Date().toISOString();
  const newTickets: KitchenTicket[] = [];
  for (const [stationId, items] of byStation) {
    const meta = stationMeta.get(stationId)!;
    const prepTimes = items.map((i) => i.prepTimeMinutes).filter((m): m is number => m != null && m > 0);
    const prepTargetMinutes = prepTimes.length ? Math.max(...prepTimes) : null;
    newTickets.push({
      id: crypto.randomUUID(),
      tableSessionId: input.session.id,
      saleId: input.session.saleId,
      stationId: meta.stationId,
      stationType: meta.stationType,
      status: "queued",
      ticketNumber: ticketNo++,
      firedAt: now,
      updatedAt: now,
      tableLabel: input.tableLabel,
      areaName: input.areaName ?? null,
      waiterLabel: input.session.waiterLabel ?? null,
      guestCount: input.session.guestCount,
      orderRound,
      priority: input.priority ?? (input.session.needsAttention ? "high" : "normal"),
      prepTargetMinutes,
      items,
      statusHistory: [{ fromStatus: null, toStatus: "queued", at: now }],
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
  return updateKitchenTicketToStatus(floor, ticketId, status);
}

export function cancelKitchenTicket(floor: HospitalityFloorState, ticketId: string): HospitalityFloorState {
  return updateKitchenTicketToStatus(floor, ticketId, "cancelled");
}

export function pruneServedKitchenTickets(floor: HospitalityFloorState, maxAgeHours = 12): HospitalityFloorState {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const terminal = new Set(TERMINAL_KITCHEN_STATUSES);
  const kitchenTickets = (floor.kitchenTickets ?? []).filter((t) => {
    if (!terminal.has(t.status) && t.status !== "served") return true;
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
  firedQtyByLineId: Map<string, number>,
): SaleLine[] {
  const prev = new Map<string, number>();
  const prevByLine = new Map<string, number>();
  for (const line of previous) {
    const id = line.id ?? line.productId;
    if (line.configFingerprint) {
      prevByLine.set(id, (prevByLine.get(id) ?? 0) + line.quantity);
    } else {
      prev.set(line.productId, (prev.get(line.productId) ?? 0) + line.quantity);
    }
  }
  const out: SaleLine[] = [];
  for (const line of current) {
    const id = line.id ?? line.productId;
    const baseline = line.configFingerprint
      ? Math.max(prevByLine.get(id) ?? 0, firedQtyByLineId.get(id) ?? 0)
      : Math.max(prev.get(line.productId) ?? 0, firedQtyByProduct.get(line.productId) ?? 0);
    const delta = line.quantity - baseline;
    if (delta > 0.0001) {
      out.push({ ...line, quantity: delta });
    }
  }
  return out;
}

export function sessionKitchenSummary(
  floor: HospitalityFloorState,
  sessionId: string,
): { queued: number; preparing: number; ready: number } {
  const summary = { queued: 0, preparing: 0, ready: 0 };
  for (const ticket of (floor.kitchenTickets ?? []).map(normalizeKitchenTicket)) {
    if (ticket.tableSessionId !== sessionId) continue;
    if (ticket.status === "cancelled" || ticket.status === "completed" || ticket.status === "served") continue;
    if (ticket.status === "queued" || ticket.status === "accepted") summary.queued += 1;
    else if (ticket.status === "preparing" || ticket.status === "cooking") summary.preparing += 1;
    else if (ticket.status === "ready" || ticket.status === "picked_up") summary.ready += 1;
  }
  return summary;
}

export { HOSPITALITY_COURSES };
