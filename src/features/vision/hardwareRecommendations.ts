/** Informational installer packages only — no commerce. Analog/DVR-first (V1.4). */

export type VisionHardwarePack = {
  id: "starter" | "business";
  titleKey: string;
  itemsKeys: string[];
  forKeys: string[];
};

export const VISION_HARDWARE_PACKS: VisionHardwarePack[] = [
  {
    id: "starter",
    titleKey: "visionHwStarterTitle",
    itemsKeys: [
      "visionHwStarterDvr",
      "visionHwStarterAnalog",
      "visionHwStarterHdd",
      "visionHwStarterPsu",
      "visionHwStarterBnc",
    ],
    forKeys: ["visionHwForRetail", "visionHwForPharmacy", "visionHwForSalon", "visionHwForMiniSuper"],
  },
  {
    id: "business",
    titleKey: "visionHwBusinessTitle",
    itemsKeys: ["visionHwBusinessDvr", "visionHwBusinessAnalog", "visionHwBusinessHdd"],
    forKeys: ["visionHwForWarehouse", "visionHwForRestaurant", "visionHwForSupermarket"],
  },
];
