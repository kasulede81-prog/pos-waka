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

type StaffSecretFields = {
  pin?: string | null;
  password?: string | null;
  pinHash?: string | null;
  passwordHash?: string | null;
};

/** Match staff PIN or password against plain or hashed storage (synced / offline staff). */
export function staffSecretMatches(staff: StaffSecretFields, raw: string): boolean {
  const probe = raw.trim();
  if (!probe) return false;
  const pin = normalizePin(staff.pin ?? "");
  const password = (staff.password ?? "").trim();
  const probePin = normalizePin(probe);
  const probeHash = hashStaffSecret(probe);
  const probePinHash = probePin ? hashStaffSecret(probePin) : "";
  const pinHash = (staff.pinHash ?? "").trim();
  const passwordHash = (staff.passwordHash ?? "").trim();
  return (
    (pin.length > 0 && pin === probePin) ||
    (password.length > 0 && password === probe) ||
    (pinHash.length > 0 && pinHash === probePinHash) ||
    (passwordHash.length > 0 && passwordHash === probeHash)
  );
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
