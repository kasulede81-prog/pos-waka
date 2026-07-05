/**
 * Staff PIN/password hashing — Argon2id (preferred) with bcrypt fallback.
 * Legacy FNV-1a and PBKDF2-SHA256 remain verifiable; migrated after successful login.
 */

import bcrypt from "bcryptjs";

const PBKDF2_ITERATIONS = 100_000;
const BCRYPT_ROUNDS = 12;
const ARGON2_MEMORY_KIB = 65536;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;

let argon2Module: typeof import("hash-wasm") | null = null;
let argon2Unavailable = false;

async function loadArgon2(): Promise<typeof import("hash-wasm") | null> {
  if (argon2Unavailable) return null;
  if (argon2Module) return argon2Module;
  try {
    argon2Module = await import("hash-wasm");
    return argon2Module;
  } catch {
    argon2Unavailable = true;
    return null;
  }
}

function fnv1aHash(raw: string): string {
  let hash = 2166136261;
  const text = raw.trim();
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function isLegacyStaffHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return hash.startsWith("fnv1a:") || hash.startsWith("pbkdf2:");
}

export function isModernStaffHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return hash.startsWith("argon2id:") || hash.startsWith("bcrypt:");
}

export function needsStaffHashMigration(hash: string | null | undefined): boolean {
  if (!hash?.trim()) return false;
  return isLegacyStaffHash(hash);
}

/** @deprecated Use hashStaffSecretAsync for new secrets. Sync legacy hash for tests. */
export function hashStaffSecret(raw: string): string {
  return fnv1aHash(raw);
}

async function hashWithBcrypt(raw: string): Promise<string> {
  const digest = await bcrypt.hash(raw.trim(), BCRYPT_ROUNDS);
  return `bcrypt:${digest}`;
}

async function hashWithArgon2id(raw: string): Promise<string> {
  const mod = await loadArgon2();
  if (!mod) return hashWithBcrypt(raw);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await mod.argon2id({
    password: raw.trim(),
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "binary",
  });
  return `argon2id:${ARGON2_ITERATIONS}:${ARGON2_MEMORY_KIB}:${ARGON2_PARALLELISM}:${bytesToBase64(salt)}:${bytesToBase64(digest as Uint8Array)}`;
}

export async function hashStaffSecretAsync(raw: string): Promise<string> {
  const text = raw.trim();
  if (!text) return "";
  return hashWithArgon2id(text);
}

async function verifyPbkdf2Hash(raw: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]) || PBKDF2_ITERATIONS;
  const saltBytes = base64ToBytes(parts[2]!);
  const expected = parts[3]!;
  if (!saltBytes.length || !expected) return false;
  if (typeof crypto === "undefined" || !crypto.subtle) return false;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(raw.trim()),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return bytesToBase64(new Uint8Array(bits)) === expected;
}

async function verifyArgon2idHash(raw: string, stored: string): Promise<boolean> {
  const mod = await loadArgon2();
  if (!mod) return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "argon2id") return false;
  const iterations = Number(parts[1]);
  const memorySize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  const salt = base64ToBytes(parts[4]!);
  const expected = parts[5]!;
  if (!iterations || !memorySize || !parallelism || !salt.length || !expected) return false;
  try {
    const digest = await mod.argon2id({
      password: raw.trim(),
      salt,
      parallelism,
      iterations,
      memorySize,
      hashLength: ARGON2_HASH_LENGTH,
      outputType: "binary",
    });
    return bytesToBase64(digest as Uint8Array) === expected;
  } catch {
    return false;
  }
}

async function verifyBcryptHash(raw: string, stored: string): Promise<boolean> {
  const digest = stored.slice("bcrypt:".length);
  if (!digest) return false;
  return bcrypt.compare(raw.trim(), digest);
}

export function normalizePin(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

type StaffSecretFields = {
  pin?: string | null;
  password?: string | null;
  pinHash?: string | null;
  passwordHash?: string | null;
};

function legacySecretMatches(staff: StaffSecretFields, raw: string): boolean {
  const probe = raw.trim();
  if (!probe) return false;
  const pin = normalizePin(staff.pin ?? "");
  const password = (staff.password ?? "").trim();
  const probePin = normalizePin(probe);
  const probeHash = fnv1aHash(probe);
  const probePinHash = probePin ? fnv1aHash(probePin) : "";
  const pinHash = (staff.pinHash ?? "").trim();
  const passwordHash = (staff.passwordHash ?? "").trim();
  return (
    (pin.length > 0 && pin === probePin) ||
    (password.length > 0 && password === probe) ||
    (pinHash.length > 0 && pinHash.startsWith("fnv1a:") && pinHash === probePinHash) ||
    (passwordHash.length > 0 && passwordHash.startsWith("fnv1a:") && passwordHash === probeHash)
  );
}

/** Sync match for legacy/plain secrets only — use staffSecretMatchesAsync for modern hashes. */
export function staffSecretMatches(staff: StaffSecretFields, raw: string): boolean {
  return legacySecretMatches(staff, raw);
}

async function verifyStoredHash(raw: string, hash: string): Promise<boolean> {
  if (hash.startsWith("fnv1a:")) return hash === fnv1aHash(raw);
  if (hash.startsWith("pbkdf2:")) return verifyPbkdf2Hash(raw, hash);
  if (hash.startsWith("argon2id:")) return verifyArgon2idHash(raw, hash);
  if (hash.startsWith("bcrypt:")) return verifyBcryptHash(raw, hash);
  return false;
}

export async function staffSecretMatchesAsync(staff: StaffSecretFields, raw: string): Promise<boolean> {
  if (legacySecretMatches(staff, raw)) return true;
  const probe = raw.trim();
  if (!probe) return false;
  const probePin = normalizePin(probe);
  const pinHash = (staff.pinHash ?? "").trim();
  const passwordHash = (staff.passwordHash ?? "").trim();
  if (pinHash && probePin) {
    if (await verifyStoredHash(probePin, pinHash)) return true;
  }
  if (passwordHash) {
    if (await verifyStoredHash(probe, passwordHash)) return true;
  }
  return false;
}

export type StaffSecretMigrationResult = {
  pinHash?: string | null;
  passwordHash?: string | null;
  migrated: boolean;
};

/** Rehash legacy secrets after successful verification. */
export async function migrateStaffSecretsAfterLogin(
  staff: StaffSecretFields,
  rawSecret: string,
): Promise<StaffSecretMigrationResult> {
  const probe = rawSecret.trim();
  if (!probe) return { migrated: false };
  const probePin = normalizePin(probe);
  const pinHash = (staff.pinHash ?? "").trim();
  const passwordHash = (staff.passwordHash ?? "").trim();
  let migrated = false;
  let nextPinHash = staff.pinHash ?? null;
  let nextPasswordHash = staff.passwordHash ?? null;

  if (probePin && pinHash && needsStaffHashMigration(pinHash)) {
    const ok = legacySecretMatches(staff, probe) || (await verifyStoredHash(probePin, pinHash));
    if (ok) {
      nextPinHash = await hashStaffSecretAsync(probePin);
      migrated = true;
    }
  } else if (passwordHash && needsStaffHashMigration(passwordHash)) {
    const ok = legacySecretMatches(staff, probe) || (await verifyStoredHash(probe, passwordHash));
    if (ok) {
      nextPasswordHash = await hashStaffSecretAsync(probe);
      migrated = true;
    }
  }

  return {
    pinHash: nextPinHash,
    passwordHash: nextPasswordHash,
    migrated,
  };
}

export function staffHasBackOfficeUnlockSecret(staff: {
  active: boolean;
  role: string;
  pin?: string | null;
  password?: string | null;
  pinHash?: string | null;
  passwordHash?: string | null;
}): boolean {
  if (!staff.active) return false;
  if (staff.role !== "owner" && staff.role !== "manager") return false;
  return Boolean(
    staff.pin?.trim() ||
      staff.password?.trim() ||
      staff.pinHash?.trim() ||
      staff.passwordHash?.trim(),
  );
}

export function isStaffLoginLocked(staff: {
  lockedUntil?: string | null;
}): boolean {
  if (!staff.lockedUntil) return false;
  return Date.parse(staff.lockedUntil) > Date.now();
}
