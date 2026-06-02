import { hasSupabaseConfig, supabase } from "./supabase";

export type MigrationCheckId =
  | "082_inventory_integrity"
  | "083_sale_stock_sync"
  | "084_remediate_sale_inventory_movement_duplicates"
  | "085_audit_log_client_entry_idempotent";

export type MigrationCheckResult = {
  id: MigrationCheckId;
  pass: boolean;
  detail: string;
};

export type MigrationHealthReport = {
  ok: boolean;
  checks: MigrationCheckResult[];
  offline: boolean;
  error?: string;
};

const EXPECTED_CHECKS: MigrationCheckId[] = [
  "082_inventory_integrity",
  "083_sale_stock_sync",
  "084_remediate_sale_inventory_movement_duplicates",
  "085_audit_log_client_entry_idempotent",
];

export async function fetchProductionMigrationHealth(): Promise<MigrationHealthReport> {
  if (!hasSupabaseConfig || !supabase) {
    return {
      ok: false,
      offline: true,
      checks: EXPECTED_CHECKS.map((id) => ({
        id,
        pass: false,
        detail: "offline",
      })),
    };
  }

  const { data, error } = await supabase.rpc("waka_verify_production_migrations");

  if (error) {
    return {
      ok: false,
      offline: false,
      error: error.message,
      checks: EXPECTED_CHECKS.map((id) => ({
        id,
        pass: false,
        detail: error.code ?? "rpc_error",
      })),
    };
  }

  const raw = data as { ok?: boolean; checks?: MigrationCheckResult[] } | null;
  const checks = Array.isArray(raw?.checks)
    ? raw!.checks!.filter((c): c is MigrationCheckResult =>
        EXPECTED_CHECKS.includes(c.id as MigrationCheckId),
      )
    : EXPECTED_CHECKS.map((id) => ({ id, pass: false, detail: "invalid_response" }));

  const byId = new Map(checks.map((c) => [c.id, c]));
  const normalized = EXPECTED_CHECKS.map(
    (id) => byId.get(id) ?? { id, pass: false, detail: "missing" },
  );

  return {
    ok: normalized.every((c) => c.pass),
    offline: false,
    checks: normalized,
  };
}
