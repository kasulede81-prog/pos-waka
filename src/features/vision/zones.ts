import type { VisionZoneId } from "./types";

export const VISION_ZONE_OPTIONS: Array<{ id: VisionZoneId; labelKey: string }> = [
  { id: "checkout", labelKey: "visionZoneCheckout" },
  { id: "cashier", labelKey: "visionZoneCashier" },
  { id: "cash_drawer", labelKey: "visionZoneCashDrawer" },
  { id: "entrance", labelKey: "visionZoneEntrance" },
  { id: "exit", labelKey: "visionZoneExit" },
  { id: "store_floor", labelKey: "visionZoneStoreFloor" },
  { id: "dispensary", labelKey: "visionZoneDispensary" },
  { id: "safe", labelKey: "visionZoneSafe" },
  { id: "kitchen", labelKey: "visionZoneKitchen" },
  { id: "bar", labelKey: "visionZoneBar" },
  { id: "dining", labelKey: "visionZoneDining" },
  { id: "warehouse", labelKey: "visionZoneWarehouse" },
  { id: "stockroom", labelKey: "visionZoneStockroom" },
  { id: "back_door", labelKey: "visionZoneBackDoor" },
  { id: "parking", labelKey: "visionZoneParking" },
  { id: "other", labelKey: "visionZoneOther" },
];

export function defaultZoneForProfile(profileId: string): VisionZoneId {
  switch (profileId) {
    case "cashier":
    case "counter":
      return "checkout";
    case "entrance":
      return "entrance";
    case "back_door":
      return "back_door";
    case "dispensary":
      return "dispensary";
    case "safe":
      return "safe";
    case "kitchen":
      return "kitchen";
    case "bar":
      return "bar";
    case "dining":
      return "dining";
    case "warehouse":
      return "warehouse";
    case "store":
      return "store_floor";
    default:
      return "other";
  }
}
