import type { Permission, StaffAccount, UserRole } from "../types";
import { isSupabaseEmailVerified } from "./emailVerification";
import { resolveShopCtx } from "../offline/cloudSync";
import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

export type CloudStaffRow = {
  id: string;
  client_id: string | null;
  name: string;
  username: string | null;
  role: UserRole;
  pin_hash: string | null;
  password_hash: string | null;
  phone_e164: string | null;
  permissions: Permission[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function staffToCloudJson(staff: StaffAccount): Record<string, unknown> {
  return {
    id: staff.id.includes("-") ? staff.id : undefined,
    client_id: staff.id,
    name: staff.name,
    username: staff.username ?? null,
    role: staff.role,
    pin_hash: staff.pinHash ?? null,
    password_hash: staff.passwordHash ?? null,
    phone_e164: staff.phone ?? null,
    permissions: staff.permissions ?? [],
    is_active: staff.active,
  };
}

function cloudRowToStaff(row: CloudStaffRow): StaffAccount {
  return {
    id: row.client_id ?? row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    permissions: row.permissions,
    pin: null,
    password: null,
    pinHash: row.pin_hash,
    passwordHash: row.password_hash,
    phone: row.phone_e164,
    active: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function pullShopStaffFromCloud(): Promise<StaffAccount[] | null> {
  if (!supabase) return null;
  const ctx = await resolveShopCtx();
  if (!ctx) return null;
  const { data, error } = await supabase.rpc("shop_pos_staff_list", { p_shop_id: ctx.shopId });
  if (error) {
    console.warn("[waka-staff] pull", error.message);
    return null;
  }
  const rows = (Array.isArray(data) ? data : []) as CloudStaffRow[];
  return rows.map(cloudRowToStaff);
}

export async function pushStaffToCloud(staff: StaffAccount): Promise<boolean> {
  if (!supabase) return false;
  const ctx = await resolveShopCtx();
  if (!ctx) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_upsert", {
    p_shop_id: ctx.shopId,
    p_row: staffToCloudJson(staff),
  });
  if (error) {
    console.warn("[waka-staff] upsert", error.message);
    return false;
  }
  return (data as { ok?: boolean })?.ok === true;
}

export async function setCloudStaffActive(shopId: string, staffId: string, active: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_set_active", {
    p_shop_id: shopId,
    p_staff_id: staffId,
    p_active: active,
  });
  if (error) return false;
  return (data as { ok?: boolean })?.ok === true;
}

export async function deleteCloudStaff(shopId: string, cloudStaffId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_pos_staff_delete", {
    p_shop_id: shopId,
    p_staff_id: cloudStaffId,
  });
  if (error) return false;
  return (data as { ok?: boolean })?.ok === true;
}

export async function importLocalStaffToCloud(shopId: string, staff: StaffAccount[]): Promise<number> {
  if (!supabase || staff.length === 0) return 0;
  const rows = staff.map(staffToCloudJson);
  const { data, error } = await supabase.rpc("shop_pos_staff_import_local", {
    p_shop_id: shopId,
    p_rows: rows,
  });
  if (error) {
    console.warn("[waka-staff] import", error.message);
    return 0;
  }
  return Number((data as { imported?: number })?.imported ?? 0);
}

/** Merge cloud staff into local preferences when verified and online. */
export async function syncStaffAccountsWithCloud(
  user: User | null,
  localStaff: StaffAccount[],
): Promise<StaffAccount[] | null> {
  if (!user || !isSupabaseEmailVerified(user)) return null;
  const { mergeStaffAccountsForCloudSync } = await import("./staffRecovery");
  let pulled = await pullShopStaffFromCloud();
  if (!pulled) return null;
  if (pulled.length === 0 && localStaff.length > 0) {
    const ctx = await resolveShopCtx();
    if (ctx) await importLocalStaffToCloud(ctx.shopId, localStaff);
    pulled = await pullShopStaffFromCloud();
    if (!pulled) return null;
  }
  if (pulled.length === 0 && localStaff.length === 0) return null;
  return mergeStaffAccountsForCloudSync(localStaff, pulled);
}
