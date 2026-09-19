/**
 * Deterministic ids for the auto-created default floor ("Main Hall", "Table 1..8", Kitchen, Bar).
 *
 * The default floor is created locally with random ids on every device. Two devices of the same new
 * shop therefore create DIFFERENT rows with the SAME names, and the cloud's unique (shop, name) /
 * (shop, area, label) indexes reject whichever pushes second — for a device that already took orders
 * on its own seed that rejection never resolves and its sessions/tickets can never sync.
 *
 * Deriving the seed ids from the shop id makes the default floor the same set of rows on every device,
 * so concurrent creation is an idempotent upsert instead of a conflict.
 */

/** 128-bit non-cryptographic hash (cyrb128) — enough to spread ids, not a security boundary. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** A stable, UUID-shaped (version 4 / variant 10xx) id for `seed`. */
export function deterministicUuid(seed: string): string {
  const words = cyrb128(seed);
  const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const SEED_AREA_KEY = "area:main-hall";
export const SEED_KITCHEN_KEY = "station:main-kitchen";
export const SEED_BAR_KEY = "station:bar";
export const seedTableKey = (n: number) => `table:${n}`;

export function seedFloorId(shopId: string, key: string): string {
  return deterministicUuid(`waka-default-floor:${shopId}:${key}`);
}

/** Replace every string that equals a key of `idMap` (ids are UUIDs, so exact-match is unambiguous). */
export function remapIdsDeep<T>(value: T, idMap: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (idMap.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => remapIdsDeep(v, idMap)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = remapIdsDeep(v, idMap);
    return out as T;
  }
  return value;
}
