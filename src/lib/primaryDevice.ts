/**
 * @deprecated Use deviceAuthority.ts — kept for backward-compatible imports.
 */
export {
  clearDeviceAuthorityCache as clearPrimaryDeviceCache,
  fetchDeviceAuthorityContext as fetchPrimaryDeviceContext,
  isPrimaryDeviceCachedSync,
  setCurrentDeviceAsPrimary,
  type DeviceAuthorityContext as PrimaryDeviceContext,
} from "./deviceAuthority";

export type ShopDeviceType =
  | "primary_pos"
  | "secondary_pos"
  | "kitchen_display"
  | "bar_display"
  | "windows_pos"
  | "mobile_pos"
  | "customer_display";

export async function isCurrentDevicePrimaryForStaffManagement(
  shopId?: string,
): Promise<boolean> {
  const { canPerformPrimaryAction } = await import("./deviceAuthority");
  return canPerformPrimaryAction("staff_manage", shopId);
}
