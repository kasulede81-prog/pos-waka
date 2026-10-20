import type { Language } from "../types";
import { t, tTemplate } from "./i18n";

/** Truthful result of one manual sync cycle. */
export type SyncFlushSummary = {
  /** Confirmed uploads acknowledged by the cloud in this cycle. */
  uploaded: number;
  pending: number;
  pendingSales: number;
  backingOff: number;
  failed: number;
  blocked: number;
  quarantined: number;
};

/**
 * Never claim "uploaded" just because the cycle finished. A success message is
 * only used when there is nothing pending/failed AND at least one acknowledgement
 * was received; otherwise the owner sees the real post-cycle counts.
 */
export function formatSyncFlushSummary(lang: Language, summary: SyncFlushSummary): string {
  if (summary.pending === 0 && summary.pendingSales === 0 && summary.failed === 0) {
    if (summary.uploaded > 0) {
      return tTemplate(lang, "syncRunFinishedUploaded", {
        count: String(summary.uploaded),
      });
    }
    return t(lang, "syncRunFinishedNothingPending");
  }
  return tTemplate(lang, "syncRunFinishedPending", {
    pending: String(summary.pending),
    sales: String(summary.pendingSales),
    backingOff: String(summary.backingOff),
    failed: String(summary.failed),
    uploaded: String(summary.uploaded),
  });
}
