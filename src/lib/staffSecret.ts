/** Lightweight deterministic hash for local staff secrets (offline obfuscation, not bank-grade crypto). */
export function hashStaffSecret(raw: string): string {
  let hash = 2166136261;
  const text = raw.trim();
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

export function normalizePin(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
