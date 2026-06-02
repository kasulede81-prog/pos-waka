import type { BusinessType } from "../types";

export function isWholesaleBusinessType(type: BusinessType | undefined | null): boolean {
  return type === "wholesale";
}

export function isWholesaleMode(type: BusinessType | undefined | null): boolean {
  return isWholesaleBusinessType(type);
}
