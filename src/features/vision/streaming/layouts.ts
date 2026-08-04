import type { VisionGridSize } from "../types";

export function resolveDefaultVisionGrid(viewportWidth: number): VisionGridSize {
  if (viewportWidth < 640) return 1;
  if (viewportWidth < 1024) return 4;
  if (viewportWidth < 1440) return 9;
  return 16;
}

export function visionGridClass(size: VisionGridSize): string {
  switch (size) {
    case 1:
      return "grid-cols-1";
    case 2:
      return "grid-cols-1 sm:grid-cols-2";
    case 4:
      return "grid-cols-1 sm:grid-cols-2";
    case 9:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    case 16:
      return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
    default:
      return "grid-cols-1";
  }
}

export function clampVisionGrid(size: VisionGridSize, cameraCount: number, isPhone: boolean): VisionGridSize {
  if (isPhone) return 1;
  if (cameraCount <= 1) return 1;
  let next: VisionGridSize = size;
  if (next === 16 && cameraCount < 10) next = cameraCount <= 4 ? 4 : 9;
  if (next === 9 && cameraCount <= 4) next = 4;
  if (next === 4 && cameraCount <= 2) next = 2;
  return next;
}

/** Prefer substream for dense grids to protect desktop performance. */
export function preferSubstreamForGrid(size: VisionGridSize): boolean {
  return size >= 9;
}
