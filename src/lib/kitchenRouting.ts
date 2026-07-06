import type { SaleLine } from "../types";

export {
  BAR_FIRE_STATION_TYPES,
  KITCHEN_FIRE_STATION_TYPES,
  resolveProductProductionStation,
  resolveProductStationType,
  resolveStationForProduct,
} from "./productHospitalityRouting";

export function lineQtyByProduct(lines: SaleLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity);
  }
  return map;
}

export function deltaLinesSince(previous: SaleLine[], current: SaleLine[]): SaleLine[] {
  const prev = lineQtyByProduct(previous);
  const out: SaleLine[] = [];
  for (const line of current) {
    const was = prev.get(line.productId) ?? 0;
    const delta = line.quantity - was;
    if (delta > 0.0001) {
      out.push({ ...line, quantity: delta });
    }
  }
  return out;
}

/** Quantities already sent to kitchen for a sale (non-cancelled tickets). */
export function firedQtyByProductForSale(
  tickets: import("../types").KitchenTicket[],
  saleId: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ticket of tickets) {
    if (ticket.saleId !== saleId || ticket.status === "cancelled") continue;
    for (const item of ticket.items) {
      if (item.saleLineId) continue;
      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    }
  }
  return map;
}

export function firedQtyByLineIdForSale(
  tickets: import("../types").KitchenTicket[],
  saleId: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ticket of tickets) {
    if (ticket.saleId !== saleId || ticket.status === "cancelled") continue;
    for (const item of ticket.items) {
      if (!item.saleLineId) continue;
      map.set(item.saleLineId, (map.get(item.saleLineId) ?? 0) + item.quantity);
    }
  }
  return map;
}
