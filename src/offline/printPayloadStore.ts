/**
 * Durable ESC/POS print payloads — survives refresh, crash, and restart.
 * Stored in IndexedDB kv (account-scoped via localDb).
 */

import { deleteKv, readKv, writeKv } from "./localDb";

const PREFIX = "print_payload::";

export type StoredPrintPayload = {
  jobId: string;
  bytes: number[];
  createdAt: string;
};

function key(jobId: string) {
  return `${PREFIX}${jobId}`;
}

export async function persistPrintPayload(jobId: string, bytes: Uint8Array): Promise<void> {
  await writeKv(key(jobId), {
    jobId,
    bytes: Array.from(bytes),
    createdAt: new Date().toISOString(),
  } satisfies StoredPrintPayload);
}

export async function loadPrintPayload(jobId: string): Promise<Uint8Array | null> {
  const row = await readKv<StoredPrintPayload>(key(jobId));
  if (!row?.bytes?.length) return null;
  return new Uint8Array(row.bytes);
}

export async function deletePrintPayload(jobId: string): Promise<void> {
  await deleteKv(key(jobId));
}

export async function hasPrintPayload(jobId: string): Promise<boolean> {
  const row = await readKv<StoredPrintPayload>(key(jobId));
  return Boolean(row?.bytes?.length);
}
