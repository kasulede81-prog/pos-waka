import { readKv, writeKv } from "../../../offline/localDb";
import type { VisionGridSize } from "../types";
import type { VisionFloorPin, VisionFloorPlan, VisionMonitorWorkspace, VisionSavedLayout } from "./types";

function kvKey(shopScopeId: string): string {
  return `vision-monitor-workspace::${shopScopeId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyWorkspace(shopScopeId: string): VisionMonitorWorkspace {
  return {
    version: 1,
    shopScopeId,
    favoriteIds: [],
    collapsedGroupIds: [],
    floorPlan: null,
    layouts: [],
    selectedBranch: null,
    updatedAt: nowIso(),
  };
}

export async function loadVisionWorkspace(shopScopeId: string): Promise<VisionMonitorWorkspace> {
  const snap = await readKv<VisionMonitorWorkspace>(kvKey(shopScopeId));
  if (!snap || snap.version !== 1) return emptyWorkspace(shopScopeId);
  return {
    ...emptyWorkspace(shopScopeId),
    ...snap,
    favoriteIds: Array.isArray(snap.favoriteIds) ? snap.favoriteIds : [],
    collapsedGroupIds: Array.isArray(snap.collapsedGroupIds) ? snap.collapsedGroupIds : [],
    layouts: Array.isArray(snap.layouts) ? snap.layouts : [],
    floorPlan: snap.floorPlan ?? null,
  };
}

async function persist(shopScopeId: string, next: VisionMonitorWorkspace): Promise<VisionMonitorWorkspace> {
  const row = { ...next, shopScopeId, version: 1 as const, updatedAt: nowIso() };
  await writeKv(kvKey(shopScopeId), row);
  return row;
}

export async function toggleVisionFavorite(
  shopScopeId: string,
  cameraId: string,
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  const has = ws.favoriteIds.includes(cameraId);
  const favoriteIds = has ? ws.favoriteIds.filter((id) => id !== cameraId) : [...ws.favoriteIds, cameraId];
  return persist(shopScopeId, { ...ws, favoriteIds });
}

export async function setVisionGroupCollapsed(
  shopScopeId: string,
  groupId: string,
  collapsed: boolean,
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  const set = new Set(ws.collapsedGroupIds);
  if (collapsed) set.add(groupId);
  else set.delete(groupId);
  return persist(shopScopeId, { ...ws, collapsedGroupIds: [...set] });
}

export async function setVisionMonitorBranch(
  shopScopeId: string,
  branch: string | null,
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  return persist(shopScopeId, { ...ws, selectedBranch: branch });
}

export async function saveVisionFloorPlan(
  shopScopeId: string,
  plan: Omit<VisionFloorPlan, "updatedAt">,
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  return persist(shopScopeId, {
    ...ws,
    floorPlan: { ...plan, updatedAt: nowIso() },
  });
}

export async function updateVisionFloorPins(
  shopScopeId: string,
  pins: VisionFloorPin[],
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  if (!ws.floorPlan) return ws;
  return persist(shopScopeId, {
    ...ws,
    floorPlan: { ...ws.floorPlan, pins, updatedAt: nowIso() },
  });
}

export async function clearVisionFloorPlan(shopScopeId: string): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  return persist(shopScopeId, { ...ws, floorPlan: null });
}

export async function saveVisionLayout(
  shopScopeId: string,
  input: { name: string; gridSize: VisionGridSize; cameraIds: string[] },
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  const layout: VisionSavedLayout = {
    id: crypto.randomUUID(),
    name: input.name.trim() || "Layout",
    gridSize: input.gridSize,
    cameraIds: input.cameraIds,
    createdAt: nowIso(),
  };
  return persist(shopScopeId, { ...ws, layouts: [layout, ...ws.layouts].slice(0, 24) });
}

export async function deleteVisionLayout(
  shopScopeId: string,
  layoutId: string,
): Promise<VisionMonitorWorkspace> {
  const ws = await loadVisionWorkspace(shopScopeId);
  return persist(shopScopeId, { ...ws, layouts: ws.layouts.filter((l) => l.id !== layoutId) });
}

/** Read file → data URL; reject oversized images (local KV only). */
export async function readFloorPlanImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("image_required");
  if (file.size > 2_500_000) throw new Error("image_too_large");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) reject(new Error("read_failed"));
      else resolve(result);
    };
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export const DEFAULT_MONITOR_LAYOUTS: Array<{ nameKey: string; gridSize: VisionGridSize }> = [
  { nameKey: "visionLayout4", gridSize: 4 },
  { nameKey: "visionLayout9", gridSize: 9 },
  { nameKey: "visionLayoutCashier", gridSize: 4 },
  { nameKey: "visionLayoutWarehouse", gridSize: 4 },
  { nameKey: "visionLayoutEntrance", gridSize: 2 },
  { nameKey: "visionLayoutClosing", gridSize: 9 },
];
