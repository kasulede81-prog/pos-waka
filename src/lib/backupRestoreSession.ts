/** Coordinates cancel for file parse + in-memory restore + disk save. */

let generation = 0;
let abortedGeneration: number | null = null;
let parseWorkerTerminate: (() => void) | null = null;

export function beginBackupRestoreSession(): number {
  generation += 1;
  abortedGeneration = null;
  return generation;
}

export function registerBackupParseWorker(terminate: () => void): void {
  parseWorkerTerminate = terminate;
}

export function clearBackupParseWorker(): void {
  parseWorkerTerminate = null;
}

export function cancelBackupRestoreSession(): void {
  abortedGeneration = generation;
  parseWorkerTerminate?.();
  parseWorkerTerminate = null;
}

export function isBackupRestoreAborted(sessionId?: number): boolean {
  if (sessionId == null) return abortedGeneration === generation;
  return abortedGeneration === sessionId;
}

export function assertBackupRestoreNotAborted(sessionId?: number): void {
  if (sessionId != null && isBackupRestoreAborted(sessionId)) {
    throw new Error("backup_restore_aborted");
  }
}
