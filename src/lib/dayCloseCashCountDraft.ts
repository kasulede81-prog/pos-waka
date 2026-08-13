/** Persisted counted-cash draft for the business date being closed. */

const STORAGE_PREFIX = "waka-close-day-count:";
const LEGACY_PREFILL = "waka-close-day-prefill";
const LEGACY_PREFILL_DATE = "waka-close-day-prefill-date";

const memory = new Map<string, string>();

function storageKey(dateKey: string): string {
  return `${STORAGE_PREFIX}${dateKey}`;
}

function digitsOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  return digits.length > 0 ? digits : null;
}

function storageGet(key: string): string | null {
  const fromMemory = memory.get(key);
  if (fromMemory != null) return fromMemory;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / node tests — memory still holds the draft */
  }
}

function storageRemove(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readDayCloseCashCountDraft(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const stored = digitsOnly(storageGet(storageKey(dateKey)));
  if (stored) return stored;

  const legacy = digitsOnly(sessionGet(LEGACY_PREFILL));
  const legacyDate = sessionGet(LEGACY_PREFILL_DATE);
  if (legacy && (!legacyDate || legacyDate === dateKey)) {
    writeDayCloseCashCountDraft(dateKey, legacy);
    sessionRemove(LEGACY_PREFILL);
    sessionRemove(LEGACY_PREFILL_DATE);
    return legacy;
  }
  return null;
}

export function writeDayCloseCashCountDraft(dateKey: string, raw: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
  const digits = digitsOnly(raw);
  if (!digits) {
    storageRemove(storageKey(dateKey));
    return;
  }
  storageSet(storageKey(dateKey), digits);
}

export function clearDayCloseCashCountDraft(dateKey: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
  storageRemove(storageKey(dateKey));
}

export function dayCloseCashCountDraftUgx(dateKey: string): number | null {
  const digits = readDayCloseCashCountDraft(dateKey);
  if (!digits) return null;
  return Math.max(0, Math.floor(Number(digits) || 0));
}
