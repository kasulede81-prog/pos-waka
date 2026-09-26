/**
 * Print outcome → user-facing message (printing audit P3.2 / phase 2 item 8).
 *
 * Print feedback used to be `window.alert`, which is easy to miss on a tablet and
 * blocks the POS. It also collapsed every failure into one generic string, so a
 * missing printer and an unavailable share sheet read the same.
 *
 * The single rule this module enforces: a print that returned `ok:false` NEVER
 * produces a success message. Failures are separated into "printer did not print"
 * (a printer is configured but unreachable) and "no print path" (nothing available,
 * including the PDF/share fallback).
 */
import type { Language } from "../types";
import { t } from "./i18n";

export type PrintOutcome = {
  ok: boolean;
  mode: string;
  error?: string | null;
};

export type PrintFeedback = {
  /** Message to show, or null when there is nothing worth telling the user. */
  message: string | null;
  /** Severity for the toast. */
  kind: "success" | "error";
};

const NO_PATH_MODES = new Set(["none"]);

/** Feedback for a receipt print attempt. */
export function receiptPrintFeedback(lang: Language, outcome: PrintOutcome): PrintFeedback {
  if (!outcome.ok) {
    // A configured but unresponsive printer is a different problem from having no
    // printing path at all — say which one it is.
    if (outcome.mode === "thermal") {
      return { message: outcome.error?.trim() || t(lang, "receiptPrintThermalFailed"), kind: "error" };
    }
    if (NO_PATH_MODES.has(outcome.mode)) {
      return { message: t(lang, "receiptPrintBlocked"), kind: "error" };
    }
    return { message: outcome.error?.trim() || t(lang, "receiptPrintBlocked"), kind: "error" };
  }

  if (outcome.mode === "thermal") return { message: t(lang, "receiptPrintThermalSent"), kind: "success" };
  if (outcome.mode === "share") return { message: t(lang, "receiptPrintNativeOpened"), kind: "success" };
  if (outcome.mode === "handoff") return { message: t(lang, "receiptPrintHandoffOpening"), kind: "success" };
  return { message: null, kind: "success" };
}

/** Feedback for a PDF export/share attempt. */
export function pdfExportFeedback(lang: Language, ok: boolean): PrintFeedback {
  return ok
    ? { message: null, kind: "success" }
    : { message: t(lang, "receiptPdfFailed"), kind: "error" };
}
