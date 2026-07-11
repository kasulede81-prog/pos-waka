/** Shared owner password validation — UX only; Supabase enforces server-side rules. */
export const OWNER_PASSWORD_MIN_LENGTH = 8;

export type PasswordStrength = "weak" | "fair" | "strong";

export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length < OWNER_PASSWORD_MIN_LENGTH) return "weak";
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const score = [hasUpper, hasLower, hasDigit, hasSymbol, pw.length >= 12].filter(Boolean).length;
  if (score >= 4) return "strong";
  if (score >= 2) return "fair";
  return "weak";
}

export function isOwnerPasswordValid(pw: string): boolean {
  return pw.length >= OWNER_PASSWORD_MIN_LENGTH;
}
