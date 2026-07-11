/**
 * Enterprise Shop Action Runner — Phase 17.1
 *
 * Standard execution pipeline for POS / shop mutations:
 * confirm → busy → execute → refresh → toast success/failure
 */

export type ShopActionResult = { ok: boolean; message?: string; errorKey?: string };

export type ShopActionAudit = {
  action: string;
  metadata?: Record<string, unknown>;
};

export type ShopActionRunnerOptions = {
  /** When false, permission check failed — action is blocked with onError message. */
  permitted?: boolean;
  permissionDeniedMessage?: string;
  confirmMessage?: string;
  setBusy?: (busy: boolean) => void;
  onSuccess?: (message?: string) => void;
  onError?: (message: string) => void;
  refresh?: () => void | Promise<void>;
  audit?: ShopActionAudit;
  /** When true, skip refresh even on success (caller handles). */
  skipRefresh?: boolean;
};

/**
 * Canonical execution pipeline for shop-facing mutations.
 * Business logic stays in store RPCs — this only standardizes UX feedback.
 */
export async function executeShopAction(
  options: ShopActionRunnerOptions,
  fn: () => ShopActionResult | Promise<ShopActionResult>,
): Promise<ShopActionResult> {
  const {
    permitted = true,
    permissionDeniedMessage = "You do not have permission for this action.",
    confirmMessage,
    setBusy,
    onSuccess,
    onError,
    refresh,
    skipRefresh = false,
    audit,
  } = options;

  if (!permitted) {
    onError?.(permissionDeniedMessage);
    return { ok: false, message: permissionDeniedMessage, errorKey: "forbidden" };
  }

  if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) {
    return { ok: false, message: "Cancelled" };
  }

  setBusy?.(true);

  try {
    const result = await fn();

    if (audit && import.meta.env.DEV) {
      console.debug("[shop-action]", audit.action, result.ok ? "ok" : result.message ?? result.errorKey);
    }

    if (result.ok) {
      onSuccess?.(result.message);
      if (!skipRefresh) await refresh?.();
    } else {
      const msg = result.message ?? result.errorKey ?? "Action failed.";
      console.error("[shop-action]", audit?.action ?? "unknown", msg);
      onError?.(msg);
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[shop-action]", audit?.action ?? "unknown", err);
    onError?.(message);
    return { ok: false, message };
  } finally {
    setBusy?.(false);
  }
}
