/** Waka transactional email defaults (override via Supabase Edge secrets). */

export const WAKA_DEFAULT_EMAIL_FROM = "Waka POS <noreply@waka.ug>";
export const WAKA_DEFAULT_EMAIL_REPLY_TO = "support@waka.ug";

export const WAKA_EMAIL_BRAND = {
  logoUrl: "https://pos.waka.ug/waka-logo.png",
  siteUrl: "https://waka.ug",
  posUrl: "https://pos.waka.ug",
  companyName: "WAKA MARKETPLACE LIMITED",
  /** Primary CTA / accent for email buttons (brand green). */
  primaryColor: "#16a34a",
  primaryColorDark: "#15803d",
  textColor: "#1c1917",
  mutedColor: "#78716c",
  borderColor: "#e7e5e4",
  backgroundColor: "#ffffff",
  canvasColor: "#f5f5f4",
} as const;

export function emailFromAddress(): string {
  return Deno.env.get("EMAIL_FROM") ?? WAKA_DEFAULT_EMAIL_FROM;
}

export function emailReplyTo(): string {
  return Deno.env.get("EMAIL_REPLY_TO") ?? WAKA_DEFAULT_EMAIL_REPLY_TO;
}

export function resendApiKey(): string | null {
  const key = Deno.env.get("RESEND_API_KEY")?.trim();
  return key || null;
}

export function sendWelcomeOnSignup(): boolean {
  return Deno.env.get("SEND_WELCOME_ON_SIGNUP") !== "false";
}

const PHONE_LOGIN_DOMAIN = "login.waka.ug";

export function isSyntheticPhoneLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${PHONE_LOGIN_DOMAIN}`);
}
