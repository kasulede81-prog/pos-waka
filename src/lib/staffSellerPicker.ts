import type { StaffAccount, UserRole } from "../types";
import { isStaffSuspendedForLogin } from "./offlineStaffCache";

/** Lightweight seller row for shared-terminal picker UI (no secrets). */
export type SellerPickerOption = {
  id: string;
  name: string;
  role: UserRole;
};

/**
 * Active, non-suspended staff profiles for seller selection.
 * Does not invent identity — only maps existing directory rows.
 */
export function filterActiveSellersForPicker(staff: StaffAccount[] | null | undefined): SellerPickerOption[] {
  return (staff ?? [])
    .filter((s) => s.active && !isStaffSuspendedForLogin(s))
    .map((s) => ({ id: s.id, name: s.name, role: s.role }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function findSellerPickerOption(
  sellers: SellerPickerOption[],
  staffId: string | null | undefined,
): SellerPickerOption | null {
  if (!staffId) return null;
  return sellers.find((s) => s.id === staffId) ?? null;
}
