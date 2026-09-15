import type { PrintJobKind, PrintJobRecord, PrintJobStatus, PrinterProfile, ShopPreferences } from "../types";
import {
  PRINT_HISTORY_MAX,
  PRINT_QUEUE_MAX_ATTEMPTS,
  PRINT_QUEUE_MAX_PENDING,
  patchHospitalityHardware,
  resolveHospitalityHardware,
} from "./hospitalityHardware";
import { sendEscPosBytes } from "../services/hardware/printerAdapter";
import {
  deletePrintPayload,
  hasPrintPayload,
  loadPrintPayload,
  persistPrintPayload,
} from "../offline/printPayloadStore";
import { dateKeyKampala } from "./datesUg";

export type EnqueuePrintInput = {
  kind: PrintJobKind;
  printerId: string | null;
  stationId?: string | null;
  ticketId?: string | null;
  saleId?: string | null;
  tableSessionId?: string | null;
  tableLabel?: string | null;
  businessDate?: string | null;
  payloadSummary: string;
  bytes?: Uint8Array;
};

let processing = false;

function nowIso() {
  return new Date().toISOString();
}

function newJob(input: EnqueuePrintInput): PrintJobRecord {
  const ts = nowIso();
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    printerId: input.printerId,
    stationId: input.stationId ?? null,
    ticketId: input.ticketId ?? null,
    saleId: input.saleId ?? null,
    tableSessionId: input.tableSessionId ?? null,
    tableLabel: input.tableLabel ?? null,
    businessDate: input.businessDate ?? dateKeyKampala(new Date()),
    status: "queued",
    attempts: 0,
    maxAttempts: PRINT_QUEUE_MAX_ATTEMPTS,
    createdAt: ts,
    updatedAt: ts,
    payloadSummary: input.payloadSummary,
    payloadPersisted: Boolean(input.bytes),
  };
}

/** Enqueue a print job and persist payload to IndexedDB. */
export async function enqueuePrintJob(
  prefs: ShopPreferences,
  input: EnqueuePrintInput,
): Promise<ShopPreferences> {
  const hw = resolveHospitalityHardware(prefs);
  const queue = [...hw.printQueue];
  if (queue.length >= PRINT_QUEUE_MAX_PENDING) {
    const dropped = queue.shift();
    if (dropped) void deletePrintPayload(dropped.id);
  }
  const job = newJob(input);
  if (input.bytes) {
    await persistPrintPayload(job.id, input.bytes);
  }
  queue.push(job);
  return {
    ...prefs,
    hospitalityHardware: patchHospitalityHardware(prefs, { printQueue: queue }),
  };
}

function updateJob(
  prefs: ShopPreferences,
  jobId: string,
  patch: Partial<PrintJobRecord>,
): ShopPreferences {
  const hw = resolveHospitalityHardware(prefs);
  const queue = hw.printQueue.map((j) => (j.id === jobId ? { ...j, ...patch, updatedAt: nowIso() } : j));
  return {
    ...prefs,
    hospitalityHardware: patchHospitalityHardware(prefs, { printQueue: queue }),
  };
}

async function finishJob(
  prefs: ShopPreferences,
  job: PrintJobRecord,
  status: PrintJobStatus,
  error?: string,
): Promise<ShopPreferences> {
  const hw = resolveHospitalityHardware(prefs);
  const done: PrintJobRecord = {
    ...job,
    status,
    error: error ?? null,
    updatedAt: nowIso(),
    sentAt: status === "done" ? nowIso() : job.sentAt ?? null,
  };
  await deletePrintPayload(job.id);
  const queue = hw.printQueue.filter((j) => j.id !== job.id);
  const history = [done, ...hw.printHistory].slice(0, PRINT_HISTORY_MAX);
  return {
    ...prefs,
    hospitalityHardware: patchHospitalityHardware(prefs, { printQueue: queue, printHistory: history }),
  };
}

function findPrinter(prefs: ShopPreferences, printerId: string | null): PrinterProfile | null {
  if (!printerId) return null;
  return resolveHospitalityHardware(prefs).printers.find((p) => p.id === printerId) ?? null;
}

async function sendJob(
  prefs: ShopPreferences,
  job: PrintJobRecord,
): Promise<{ prefs: ShopPreferences; ok: boolean; error?: string }> {
  const bytes = await loadPrintPayload(job.id);
  if (!bytes) {
    return { prefs: await finishJob(prefs, job, "failed", "Missing print payload."), ok: false };
  }
  const printer = findPrinter(prefs, job.printerId);
  if (!printer) {
    return { prefs: await finishJob(prefs, job, "failed", "Printer not configured."), ok: false };
  }
  let next = updateJob(prefs, job.id, {
    status: "sending",
    attempts: job.attempts + 1,
    lastAttemptAt: nowIso(),
  });
  const result = await sendEscPosBytes(printer, bytes);
  if (result.ok) {
    const hw = resolveHospitalityHardware(next);
    const printers = hw.printers.map((p) =>
      p.id === printer.id ? { ...p, lastSeenAt: nowIso(), lastError: null } : p,
    );
    next = {
      ...next,
      hospitalityHardware: patchHospitalityHardware(next, { printers }),
    };
    return { prefs: await finishJob(next, { ...job, attempts: job.attempts + 1 }, "done"), ok: true };
  }
  const attempts = job.attempts + 1;
  const failed = attempts >= job.maxAttempts;
  const hw = resolveHospitalityHardware(next);
  const printers = hw.printers.map((p) =>
    p.id === printer.id ? { ...p, lastError: result.error ?? "Print failed", lastSeenAt: nowIso() } : p,
  );
  next = {
    ...next,
    hospitalityHardware: patchHospitalityHardware(next, { printers }),
  };
  if (failed) {
    return {
      prefs: await finishJob(next, { ...job, attempts }, "failed", result.error),
      ok: false,
      error: result.error,
    };
  }
  return {
    prefs: updateJob(next, job.id, {
      status: "queued",
      attempts,
      error: result.error ?? null,
      lastAttemptAt: nowIso(),
    }),
    ok: false,
    error: result.error,
  };
}

export async function processPrintQueue(
  prefs: ShopPreferences,
  maxJobs = 3,
): Promise<ShopPreferences> {
  if (processing) return prefs;
  processing = true;
  let current = prefs;
  try {
    const hw = resolveHospitalityHardware(current);
    const queued = hw.printQueue
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, maxJobs);
    for (const job of queued) {
      const res = await sendJob(current, job);
      current = res.prefs;
      if (!res.ok && job.attempts + 1 < job.maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return current;
  } finally {
    processing = false;
  }
}

export async function cancelPrintJob(prefs: ShopPreferences, jobId: string): Promise<ShopPreferences> {
  const hw = resolveHospitalityHardware(prefs);
  const job = hw.printQueue.find((j) => j.id === jobId);
  if (!job) return prefs;
  await deletePrintPayload(jobId);
  const cancelled: PrintJobRecord = {
    ...job,
    status: "failed",
    error: "Cancelled by user.",
    updatedAt: nowIso(),
  };
  return {
    ...prefs,
    hospitalityHardware: patchHospitalityHardware(prefs, {
      printQueue: hw.printQueue.filter((j) => j.id !== jobId),
      printHistory: [cancelled, ...hw.printHistory].slice(0, PRINT_HISTORY_MAX),
    }),
  };
}

export async function retryFailedPrintJobs(prefs: ShopPreferences): Promise<ShopPreferences> {
  const hw = resolveHospitalityHardware(prefs);
  const failed = hw.printHistory.filter((j) => j.status === "failed").slice(0, 10);
  const requeue: PrintJobRecord[] = [];
  for (const job of failed) {
    const hasPayload = await hasPrintPayload(job.id);
    if (!hasPayload) continue;
    requeue.push({
      ...job,
      status: "queued",
      attempts: 0,
      error: null,
      updatedAt: nowIso(),
    });
  }
  if (!requeue.length) return prefs;
  return {
    ...prefs,
    hospitalityHardware: patchHospitalityHardware(prefs, {
      printQueue: [...hw.printQueue, ...requeue],
    }),
  };
}

export function queueDepth(prefs: ShopPreferences): number {
  return resolveHospitalityHardware(prefs).printQueue.filter((j) => j.status === "queued").length;
}

/** Drop queued jobs whose payload is missing from IndexedDB (orphan cleanup). */
export async function reconcilePrintQueue(prefs: ShopPreferences): Promise<ShopPreferences> {
  const hw = resolveHospitalityHardware(prefs);
  let changed = false;
  const queue: PrintJobRecord[] = [];
  for (const job of hw.printQueue) {
    if (job.status === "done") continue;
    const ok = job.payloadPersisted !== false ? await hasPrintPayload(job.id) : false;
    if (!ok && job.kind !== "test") {
      changed = true;
      continue;
    }
    queue.push(job);
  }
  if (!changed) return prefs;
  return {
    ...prefs,
    hospitalityHardware: patchHospitalityHardware(prefs, { printQueue: queue }),
  };
}
