import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type HardDeleteCounts = Record<string, number>;

export type HardDeleteVerificationReport = {
  all_passed: boolean;
  counts: HardDeleteCounts;
  checked_at?: string;
  db_verification?: Record<string, unknown>;
};

export type CertifiedHardDeleteResult = {
  ok: boolean;
  error?: string;
  detail?: string;
  partial?: boolean;
  message?: string;
  deletion_report?: HardDeleteVerificationReport;
  shop_name?: string;
  sales_deleted?: number;
  devices_deactivated?: number;
  user_ids?: string[];
  organization_id?: string | null;
  shop_ids?: string[];
  staff_user_ids?: string[];
};

type PreparePayload = {
  ok?: boolean;
  phase?: string;
  error?: string;
  detail?: string;
  user_ids?: string[];
  owner_user_id?: string;
  organization_id?: string;
  shop_ids?: string[];
  shop_name?: string;
};

type ExecutePayload = PreparePayload & {
  verification?: HardDeleteVerificationReport;
  sales_deleted?: number;
  devices_deactivated?: number;
};

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v)).filter(Boolean);
}

async function revokeAndDeleteAuthUsers(
  admin: SupabaseClient,
  userIds: string[],
  ownerUserId: string | null,
): Promise<{ ok: boolean; detail?: string; ownerRemaining: number; staffRemaining: number }> {
  const unique = [...new Set(userIds.filter(Boolean))];

  for (const id of unique) {
    await admin.auth.admin.signOut(id, "global").catch(() => undefined);
  }

  const failures: string[] = [];
  for (const id of unique) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) failures.push(`${id}: ${error.message}`);
  }

  let ownerRemaining = 0;
  let staffRemaining = 0;
  for (const id of unique) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (!data.user) continue;
    if (ownerUserId && id === ownerUserId) ownerRemaining += 1;
    else staffRemaining += 1;
  }

  if (failures.length > 0) {
    return {
      ok: false,
      detail: failures.join("; "),
      ownerRemaining,
      staffRemaining,
    };
  }

  return { ok: ownerRemaining === 0 && staffRemaining === 0, ownerRemaining, staffRemaining };
}

export async function runCertifiedHardDelete(opts: {
  userClient: SupabaseClient;
  admin: SupabaseClient;
  prepare: () => Promise<{ data: unknown; error: { message?: string } | null }>;
  execute: () => Promise<{ data: unknown; error: { message?: string } | null }>;
}): Promise<CertifiedHardDeleteResult> {
  const prepRes = await opts.prepare();
  if (prepRes.error) {
    const msg = prepRes.error.message ?? "Prepare failed.";
    if (msg.includes("Could not find the function") || msg.includes("schema cache")) {
      return { ok: false, error: "migration_not_deployed", detail: msg };
    }
    return { ok: false, error: "delete_failed", detail: msg };
  }

  const prep = (prepRes.data ?? {}) as PreparePayload;
  if (!prep.ok) {
    return { ok: false, error: prep.error ?? "delete_failed", detail: prep.detail };
  }

  const userIds = asStringArray(prep.user_ids);
  const shopIds = asStringArray(prep.shop_ids);
  const ownerUserId = prep.owner_user_id ? String(prep.owner_user_id) : null;
  const orgId = prep.organization_id ? String(prep.organization_id) : null;
  const staffUserIds = userIds.filter((id) => id !== ownerUserId);

  for (const id of staffUserIds) {
    await opts.admin.auth.admin.signOut(id, "global").catch(() => undefined);
  }

  const execRes = await opts.execute();
  if (execRes.error) {
    const msg = execRes.error.message ?? "Execute failed.";
    if (msg.includes("Could not find the function") || msg.includes("schema cache")) {
      return { ok: false, error: "migration_not_deployed", detail: msg };
    }
    return { ok: false, error: "delete_failed", detail: msg };
  }

  const exec = (execRes.data ?? {}) as ExecutePayload;
  if (!exec.ok) {
    return {
      ok: false,
      error: exec.error ?? "delete_failed",
      detail: exec.detail,
      partial: exec.error === "verification_failed",
      deletion_report: exec.verification,
      shop_name: exec.shop_name,
      sales_deleted: exec.sales_deleted,
      devices_deactivated: exec.devices_deactivated,
      user_ids: userIds,
      organization_id: orgId,
      shop_ids: shopIds,
      staff_user_ids: staffUserIds,
    };
  }

  const authResult = await revokeAndDeleteAuthUsers(opts.admin, userIds, ownerUserId);

  const { data: merged, error: mergeErr } = await opts.userClient.rpc("hard_delete_merge_auth_verification", {
    p_org_id: orgId,
    p_shop_ids: shopIds,
    p_owner_user_id: ownerUserId,
    p_staff_user_ids: staffUserIds,
    p_owner_auth_remaining: authResult.ownerRemaining,
    p_staff_auth_remaining: authResult.staffRemaining,
  });

  let deletionReport = (merged ?? exec.verification ?? {}) as HardDeleteVerificationReport;

  if (mergeErr && exec.verification) {
    deletionReport = {
      all_passed:
        Boolean(exec.verification.all_passed) &&
        authResult.ownerRemaining === 0 &&
        authResult.staffRemaining === 0,
      counts: {
        ...(exec.verification.counts ?? {}),
        owner_auth_account: authResult.ownerRemaining,
        staff_auth_accounts: authResult.staffRemaining,
      },
      db_verification: exec.verification,
      checked_at: new Date().toISOString(),
    };
  }

  if (!authResult.ok || !deletionReport.all_passed) {
    return {
      ok: false,
      error: authResult.ok ? "verification_failed" : "auth_delete_failed",
      detail: authResult.detail,
      partial: true,
      message:
        "Shop data was removed but certified deletion verification failed. Contact Waka support with the deletion report.",
      deletion_report: deletionReport,
      shop_name: exec.shop_name,
      sales_deleted: exec.sales_deleted,
      devices_deactivated: exec.devices_deactivated,
      user_ids: userIds,
      organization_id: orgId,
      shop_ids: shopIds,
      staff_user_ids: staffUserIds,
    };
  }

  return {
    ok: true,
    message: "Certified hard delete completed. All verification checks passed.",
    deletion_report: deletionReport,
    shop_name: exec.shop_name,
    sales_deleted: exec.sales_deleted,
    devices_deactivated: exec.devices_deactivated,
    user_ids: userIds,
    organization_id: orgId,
    shop_ids: shopIds,
    staff_user_ids: staffUserIds,
  };
}

export async function runCertifiedAuthRetry(opts: {
  admin: SupabaseClient;
  userClient: SupabaseClient;
  ownerId: string;
  orgId: string | null;
  shopIds: string[];
  staffUserIds: string[];
}): Promise<CertifiedHardDeleteResult> {
  const allIds = [opts.ownerId, ...opts.staffUserIds.filter((id) => id !== opts.ownerId)];
  const authResult = await revokeAndDeleteAuthUsers(opts.admin, allIds, opts.ownerId);

  const { data: merged } = await opts.userClient.rpc("hard_delete_merge_auth_verification", {
    p_org_id: opts.orgId,
    p_shop_ids: opts.shopIds,
    p_owner_user_id: opts.ownerId,
    p_staff_user_ids: opts.staffUserIds,
    p_owner_auth_remaining: authResult.ownerRemaining,
    p_staff_auth_remaining: authResult.staffRemaining,
  });

  const deletionReport = (merged ?? {}) as HardDeleteVerificationReport;

  if (!authResult.ok || !deletionReport.all_passed) {
    return {
      ok: false,
      error: "auth_delete_failed",
      detail: authResult.detail,
      partial: true,
      deletion_report: deletionReport,
    };
  }

  return { ok: true, deletion_report: deletionReport, message: "Login accounts removed. Verification passed." };
}
