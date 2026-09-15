/**
 * Phase 26.1 — [waka-report] export/print diagnostics (no business-sensitive content).
 */

import { Capacitor } from "@capacitor/core";

export type ReportExportFormat = "csv" | "xlsx" | "pdf" | "json" | "print" | "share" | "text";
export type ReportExportKind =
  | "investigation"
  | "reports"
  | "profit"
  | "command_center"
  | "shift"
  | "x_report"
  | "monthly"
  | "cash_position"
  | "inventory_count"
  | "other";

type ReportDiagEvent = "export_start" | "export_done" | "export_fail" | "print_start" | "print_done" | "print_fail";

function shouldLog(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("waka.report.log") === "1";
  } catch {
    return false;
  }
}

function platformLabel(): string {
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform();
  if (typeof window !== "undefined" && window.wakaDesktop?.platform) return window.wakaDesktop.platform;
  return "web";
}

export function logReportExport(
  event: ReportDiagEvent,
  detail: {
    kind: ReportExportKind;
    format: ReportExportFormat;
    durationMs?: number;
    fileSizeBytes?: number;
    rowCount?: number;
    ok?: boolean;
    reason?: string;
  },
): void {
  if (!shouldLog()) return;
  console.info("[waka-report]", {
    event,
    platform: platformLabel(),
    ...detail,
  });
}

export async function timedReportExport<T>(
  kind: ReportExportKind,
  format: ReportExportFormat,
  run: () => Promise<T>,
  meta?: { rowCount?: number; fileSizeBytes?: number },
): Promise<T> {
  const start = performance.now();
  logReportExport("export_start", { kind, format, rowCount: meta?.rowCount });
  try {
    const result = await run();
    logReportExport("export_done", {
      kind,
      format,
      durationMs: Math.round(performance.now() - start),
      rowCount: meta?.rowCount,
      fileSizeBytes: meta?.fileSizeBytes,
      ok: true,
    });
    return result;
  } catch (err) {
    logReportExport("export_fail", {
      kind,
      format,
      durationMs: Math.round(performance.now() - start),
      ok: false,
      reason: String((err as Error)?.message ?? err),
    });
    throw err;
  }
}

export async function timedReportPrint(
  kind: ReportExportKind,
  run: () => Promise<boolean>,
): Promise<boolean> {
  const start = performance.now();
  logReportExport("print_start", { kind, format: "print" });
  try {
    const ok = await run();
    logReportExport(ok ? "print_done" : "print_fail", {
      kind,
      format: "print",
      durationMs: Math.round(performance.now() - start),
      ok,
    });
    return ok;
  } catch (err) {
    logReportExport("print_fail", {
      kind,
      format: "print",
      durationMs: Math.round(performance.now() - start),
      ok: false,
      reason: String((err as Error)?.message ?? err),
    });
    return false;
  }
}
