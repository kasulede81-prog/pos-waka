import type { VisionCamera } from "../types";
import type { VisionCameraGroupDef, VisionCameraGroupId } from "./types";

export const VISION_CAMERA_GROUPS: VisionCameraGroupDef[] = [
  { id: "retail_entrance", labelKey: "visionGroupEntrance", zoneIds: ["entrance", "exit"] },
  { id: "retail_checkout", labelKey: "visionGroupCheckout", zoneIds: ["checkout", "cashier", "cash_drawer"] },
  { id: "retail_floor", labelKey: "visionGroupSalesFloor", zoneIds: ["store_floor"] },
  { id: "warehouse_loading", labelKey: "visionGroupLoadingBay", zoneIds: ["back_door"] },
  { id: "warehouse_storage", labelKey: "visionGroupStorage", zoneIds: ["warehouse", "stockroom"] },
  { id: "office", labelKey: "visionGroupOffice", zoneIds: ["other"] },
  { id: "parking", labelKey: "visionGroupParking", zoneIds: ["parking"] },
  { id: "kitchen", labelKey: "visionGroupKitchen", zoneIds: ["kitchen", "bar", "dining"] },
  { id: "safe", labelKey: "visionGroupSafe", zoneIds: ["safe", "dispensary"] },
  { id: "other", labelKey: "visionGroupOther", zoneIds: [] },
];

export function groupIdForCamera(camera: VisionCamera): VisionCameraGroupId {
  for (const g of VISION_CAMERA_GROUPS) {
    if (g.id === "other") continue;
    if (g.zoneIds.includes(camera.zoneId)) return g.id;
  }
  return "other";
}

export function groupCameras(
  cameras: VisionCamera[],
): Array<{ group: VisionCameraGroupDef; cameras: VisionCamera[] }> {
  const map = new Map<VisionCameraGroupId, VisionCamera[]>();
  for (const g of VISION_CAMERA_GROUPS) map.set(g.id, []);
  for (const cam of cameras) {
    const id = groupIdForCamera(cam);
    map.get(id)!.push(cam);
  }
  return VISION_CAMERA_GROUPS.map((group) => ({
    group,
    cameras: map.get(group.id) ?? [],
  })).filter((row) => row.cameras.length > 0);
}
