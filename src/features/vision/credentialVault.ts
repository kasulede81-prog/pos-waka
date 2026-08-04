/**
 * Reversible AES-GCM vault for Vision camera passwords (not PIN hashes).
 */

import { getActiveAccountKey } from "../../offline/accountScope";
import { readKv, writeKv } from "../../offline/localDb";
import { getOrCreateDeviceId } from "../../lib/deviceId";

type VaultBlob = {
  v: 1;
  iv: string;
  ciphertext: string;
};

type VaultFile = {
  version: 1;
  shopScopeId: string;
  entries: Record<string, VaultBlob>;
};

function vaultKvKey(shopScopeId: string): string {
  return `vision-cred-vault::${shopScopeId}`;
}

async function deriveVaultKey(shopScopeId: string): Promise<CryptoKey> {
  const accountKey = getActiveAccountKey() ?? "anon";
  const material = `${getOrCreateDeviceId()}:${shopScopeId}:${accountKey}:waka-vision-cred-v1`;
  const raw = new TextEncoder().encode(material);
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    keyBytes[i] = raw[i % raw.length]!;
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function readVaultFile(shopScopeId: string): Promise<VaultFile> {
  const existing = await readKv<VaultFile>(vaultKvKey(shopScopeId));
  if (existing?.version === 1 && existing.entries) return existing;
  return { version: 1, shopScopeId, entries: {} };
}

async function writeVaultFile(file: VaultFile): Promise<void> {
  await writeKv(vaultKvKey(file.shopScopeId), file);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function vaultPutSecret(
  shopScopeId: string,
  vaultKey: string,
  plaintext: string,
): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(shopScopeId);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const file = await readVaultFile(shopScopeId);
  file.entries[vaultKey] = {
    v: 1,
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
  };
  await writeVaultFile(file);
}

export async function vaultGetSecret(shopScopeId: string, vaultKey: string): Promise<string | null> {
  const file = await readVaultFile(shopScopeId);
  const blob = file.entries[vaultKey];
  if (!blob) return null;
  try {
    const key = await deriveVaultKey(shopScopeId);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(blob.iv) },
      key,
      b64ToBytes(blob.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export async function vaultDeleteSecret(shopScopeId: string, vaultKey: string): Promise<void> {
  const file = await readVaultFile(shopScopeId);
  if (!(vaultKey in file.entries)) return;
  delete file.entries[vaultKey];
  await writeVaultFile(file);
}
