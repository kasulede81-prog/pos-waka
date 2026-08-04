import type { VisionGridSize } from "../types";

export type VisionFloorPin = {
  cameraId: string;
  /** 0–100 percent from left */
  x: number;
  /** 0–100 percent from top */
  y: number;
};

export type VisionFloorPlan = {
  id: string;
  name: string;
  /** data:image/...;base64 — kept local in KV only */
  imageDataUrl: string | null;
  pins: VisionFloorPin[];
  updatedAt: string;
};

export type VisionSavedLayout = {
  id: string;
  name: string;
  gridSize: VisionGridSize;
  cameraIds: string[];
  createdAt: string;
};

export type VisionMonitorWorkspace = {
  version: 1;
  shopScopeId: string;
  favoriteIds: string[];
  collapsedGroupIds: string[];
  floorPlan: VisionFloorPlan | null;
  layouts: VisionSavedLayout[];
  selectedBranch: string | null;
  updatedAt: string;
};

export type VisionCameraGroupId =
  | "retail_entrance"
  | "retail_checkout"
  | "retail_floor"
  | "warehouse_loading"
  | "warehouse_storage"
  | "office"
  | "parking"
  | "kitchen"
  | "safe"
  | "other";

export type VisionCameraGroupDef = {
  id: VisionCameraGroupId;
  labelKey: string;
  zoneIds: string[];
};
