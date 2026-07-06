import type { DiningArea, DiningTable, HospitalityFloorState, KitchenStation, KitchenStationType } from "../types";
import { syncTableDisplayStatuses } from "./hospitality";

export function addDiningArea(floor: HospitalityFloorState, name: string): HospitalityFloorState {
  const trimmed = name.trim();
  if (!trimmed) return floor;
  const area: DiningArea = {
    id: crypto.randomUUID(),
    name: trimmed,
    sortOrder: floor.areas.length,
    isActive: true,
  };
  return { ...floor, areas: [...floor.areas, area] };
}

export function renameDiningArea(floor: HospitalityFloorState, areaId: string, name: string): HospitalityFloorState {
  const trimmed = name.trim();
  if (!trimmed) return floor;
  return {
    ...floor,
    areas: floor.areas.map((a) => (a.id === areaId ? { ...a, name: trimmed } : a)),
  };
}

export function removeDiningArea(floor: HospitalityFloorState, areaId: string): HospitalityFloorState {
  const tables = floor.tables.filter((t) => t.areaId !== areaId);
  const areas = floor.areas.filter((a) => a.id !== areaId);
  return syncTableDisplayStatuses({ ...floor, areas, tables });
}

export function addDiningTable(
  floor: HospitalityFloorState,
  input: { areaId: string; label: string; capacity?: number },
): HospitalityFloorState {
  const label = input.label.trim();
  if (!label || !floor.areas.some((a) => a.id === input.areaId)) return floor;
  const areaTables = floor.tables.filter((t) => t.areaId === input.areaId);
  const table: DiningTable = {
    id: crypto.randomUUID(),
    areaId: input.areaId,
    label,
    capacity: input.capacity,
    sortOrder: areaTables.length + 1,
    displayStatus: "available",
    isActive: true,
  };
  return syncTableDisplayStatuses({ ...floor, tables: [...floor.tables, table] });
}

export function updateDiningTable(
  floor: HospitalityFloorState,
  tableId: string,
  patch: Partial<Pick<DiningTable, "label" | "capacity" | "areaId" | "sortOrder" | "isActive">>,
): HospitalityFloorState {
  const tables = floor.tables.map((t) => {
    if (t.id !== tableId) return t;
    return {
      ...t,
      ...patch,
      label: patch.label !== undefined ? patch.label.trim() || t.label : t.label,
    };
  });
  return syncTableDisplayStatuses({ ...floor, tables });
}

export function removeDiningTable(floor: HospitalityFloorState, tableId: string): HospitalityFloorState {
  const hasOpen = floor.sessions.some(
    (s) => s.tableId === tableId && (s.status === "open" || s.status === "payment_pending"),
  );
  if (hasOpen) return floor;
  const tables = floor.tables.filter((t) => t.id !== tableId);
  return syncTableDisplayStatuses({ ...floor, tables });
}

export function addKitchenStation(
  floor: HospitalityFloorState,
  input: { name: string; stationType: KitchenStationType },
): HospitalityFloorState {
  const name = input.name.trim();
  if (!name) return floor;
  const station: KitchenStation = {
    id: crypto.randomUUID(),
    name,
    stationType: input.stationType,
    sortOrder: floor.stations.length,
    isActive: true,
  };
  return { ...floor, stations: [...floor.stations, station] };
}

export function updateKitchenStation(
  floor: HospitalityFloorState,
  stationId: string,
  patch: Partial<Pick<KitchenStation, "name" | "stationType" | "sortOrder" | "isActive">>,
): HospitalityFloorState {
  const stations = floor.stations.map((s) => {
    if (s.id !== stationId) return s;
    return {
      ...s,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() || s.name : s.name,
    };
  });
  return { ...floor, stations };
}

export function removeKitchenStation(floor: HospitalityFloorState, stationId: string): HospitalityFloorState {
  const hasActiveTickets = (floor.kitchenTickets ?? []).some(
    (t) => t.stationId === stationId && t.status !== "completed" && t.status !== "cancelled" && t.status !== "served",
  );
  if (hasActiveTickets) return floor;
  const stations = floor.stations.filter((s) => s.id !== stationId);
  return { ...floor, stations };
}
