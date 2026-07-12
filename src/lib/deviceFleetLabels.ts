/** Local display aliases for fleet devices (UX-only; no RPC/schema change). */

const STORAGE_KEY = "waka.deviceFleet.aliases";

type AliasMap = Record<string, string>;

function readAll(): AliasMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as AliasMap;
  } catch {
    return {};
  }
}

function writeAll(map: AliasMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function aliasKey(shopId: string, deviceId: string): string {
  return `${shopId}:${deviceId}`;
}

export function readDeviceDisplayAlias(shopId: string, deviceId: string): string | null {
  const value = readAll()[aliasKey(shopId, deviceId)];
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function writeDeviceDisplayAlias(shopId: string, deviceId: string, alias: string): void {
  const trimmed = alias.trim().slice(0, 64);
  const map = readAll();
  const key = aliasKey(shopId, deviceId);
  if (!trimmed) {
    delete map[key];
  } else {
    map[key] = trimmed;
  }
  writeAll(map);
}
