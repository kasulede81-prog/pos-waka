/**
 * Shop Security PIN — hashed at rest (Argon2id), backward compatible with legacy plaintext digits.
 */

import { hashStaffSecretAsync } from "../staffSecret";

const SHOP_PIN_HASH_PREFIXES = ["argon2id:", "bcrypt:", "pbkdf2:"] as const;

export function isShopPinHash(stored: string | null | undefined): boolean {
  const s = stored?.trim() ?? "";
  if (!s) return false;
  return SHOP_PIN_HASH_PREFIXES.some((p) => s.startsWith(p));
}

export function isLegacyPlaintextShopPin(stored: string | null | undefined): boolean {
  const s = stored?.trim() ?? "";
  if (!s || isShopPinHash(s)) return false;
  return /^\d{4,6}$/.test(s.replace(/\D/g, ""));
}

export function isShopSecurityPinConfigured(stored: string | null | undefined): boolean {
  const s = stored?.trim() ?? "";
  if (!s) return false;
  if (isShopPinHash(s)) return true;
  return isLegacyPlaintextShopPin(s);
}

export function normalizeShopPinInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** Hash a new shop PIN for storage — never store plaintext. */
export async function hashShopSecurityPin(raw: string): Promise<string> {
  const digits = normalizeShopPinInput(raw);
  if (digits.length < 4) return "";
  return hashStaffSecretAsync(digits);
}

async function verifyStoredShopHash(raw: string, stored: string): Promise<boolean> {
  const { staffSecretMatchesAsync } = await import("../staffSecret");
  return staffSecretMatchesAsync({ pinHash: stored }, raw);
}

/** Async verification — supports hashed and legacy plaintext shop PIN. */
export async function verifyShopSecurityPinAsync(
  raw: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const s = stored?.trim() ?? "";
  if (!s) return false;
  const digits = normalizeShopPinInput(raw);
  if (digits.length < 4) return false;
  if (isShopPinHash(s)) {
    return verifyStoredShopHash(digits, s);
  }
  return digits === normalizeShopPinInput(s);
}

/** Sync verification — legacy plaintext shop PIN only (hot paths / tests). */
export function verifyShopSecurityPinSync(raw: string, stored: string | null | undefined): boolean {
  const s = stored?.trim() ?? "";
  if (!s || isShopPinHash(s)) return false;
  const digits = normalizeShopPinInput(raw);
  if (digits.length < 4) return false;
  return digits === normalizeShopPinInput(s);
}

/** Migrate legacy plaintext to hash when persisting. */
export async function migrateShopPinIfPlaintext(
  stored: string | null | undefined,
): Promise<string | null> {
  const s = stored?.trim() ?? "";
  if (!s) return null;
  if (isShopPinHash(s)) return s;
  if (isLegacyPlaintextShopPin(s)) {
    return hashShopSecurityPin(s);
  }
  return null;
}
