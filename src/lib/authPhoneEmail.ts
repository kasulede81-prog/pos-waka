import { normalizeUgPhoneE164 } from "./businessProfile";

const LOGIN_EMAIL_DOMAIN = "login.waka.ug";

/** Stable Supabase auth email for phone-primary owner accounts (not shown in UI). */
export function phoneToLoginEmail(phone: string): string {
  const e164 = normalizeUgPhoneE164(phone);
  if (!e164) throw new Error("Enter a valid Uganda mobile number (e.g. 07XXXXXXXX).");
  const digits = e164.replace(/\D/g, "");
  return `${digits}@${LOGIN_EMAIL_DOMAIN}`;
}

export function isPhoneLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
}
