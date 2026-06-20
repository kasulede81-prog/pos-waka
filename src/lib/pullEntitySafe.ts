import { reportSyncIssue } from "./monitoring";

/** Per-entity pull wrapper — one failed RPC must not abort the entire sync. */
export async function pullEntitySafe<T>(
  entity: string,
  errors: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors[entity] = message;
    reportSyncIssue("cloud_pull_entity_failed", { entity, message });
    return undefined;
  }
}
