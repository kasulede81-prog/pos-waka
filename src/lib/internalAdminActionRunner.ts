import { logInternalAdminAudit } from "./rescueSupportActions";

export type InternalAdminActionResult = { ok: boolean; message?: string };

export type InternalAdminActionAudit = {
  action: string;
  shopId?: string | null;
  metadata?: Record<string, unknown>;
};

export type InternalAdminActionRunnerOptions = {
  previewMode: boolean;
  previewBlockedMessage?: string;
  /** When false, permission check failed — action is blocked with onError message. */
  permitted?: boolean;
  permissionDeniedMessage?: string;
  confirmMessage?: string;
  skipAudit?: boolean;
  setBusy?: (busy: boolean) => void;
  onSuccess?: (message?: string) => void;
  onError?: (message: string) => void;
  refresh?: () => void | Promise<void>;
  audit?: InternalAdminActionAudit;
};

export function notifyInternalOpsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("waka:internal-ops-changed"));
    window.dispatchEvent(new Event("waka:subscription-updated"));
  }
}

/**
 * Enterprise execution pipeline for Internal Admin mutations.
 * Preview → permission → confirm → busy → RPC → audit → refresh → toast.
 */
export async function executeInternalAdminAction(
  options: InternalAdminActionRunnerOptions,
  fn: () => Promise<InternalAdminActionResult>,
): Promise<InternalAdminActionResult> {
  const {
    previewMode,
    previewBlockedMessage = "Preview mode — action blocked.",
    permitted = true,
    permissionDeniedMessage = "You do not have permission for this action.",
    confirmMessage,
    skipAudit = false,
    setBusy,
    onSuccess,
    onError,
    refresh,
    audit,
  } = options;

  if (previewMode) {
    onError?.(previewBlockedMessage);
    return { ok: false, message: previewBlockedMessage };
  }

  if (!permitted) {
    onError?.(permissionDeniedMessage);
    return { ok: false, message: permissionDeniedMessage };
  }

  if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) {
    return { ok: false, message: "Cancelled" };
  }

  const started = performance.now();
  setBusy?.(true);

  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - started);

    if (audit && !skipAudit) {
      const auditResult = await logInternalAdminAudit({
        shopId: audit.shopId ?? null,
        action: audit.action,
        result: result.ok ? "ok" : "failed",
        reason: result.message ?? null,
        metadata: { ...audit.metadata, durationMs, console: "internal_admin" },
      });
      if (!auditResult.ok && result.ok) {
        console.warn("[internal-admin-action] audit log failed:", auditResult.message);
      }
    }

    if (result.ok) {
      onSuccess?.(result.message);
      await refresh?.();
      notifyInternalOpsChanged();
    } else {
      const msg = result.message ?? "Action failed.";
      console.error("[internal-admin-action]", audit?.action ?? "unknown", msg);
      onError?.(msg);
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const durationMs = Math.round(performance.now() - started);
    console.error("[internal-admin-action]", audit?.action ?? "unknown", err);

    if (audit && !skipAudit) {
      await logInternalAdminAudit({
        shopId: audit.shopId ?? null,
        action: audit.action,
        result: "failed",
        reason: message,
        metadata: { ...audit.metadata, durationMs, console: "internal_admin" },
      });
    }

    onError?.(message);
    return { ok: false, message };
  } finally {
    setBusy?.(false);
  }
}
