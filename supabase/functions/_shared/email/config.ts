/** DKASU transactional email defaults (override via Supabase Edge secrets). */

export const WAKA_DEFAULT_EMAIL_FROM = "DKASU POS <noreply@waka.ug>";
export const WAKA_DEFAULT_EMAIL_REPLY_TO = "support@waka.ug";

export const WAKA_EMAIL_BRAND = {
  // DKASU hosts since the 2026-10-02 auth migration. The legacy WAKA hosts still 308 here and stay
  // allowlisted on Supabase and Google, but nothing user-facing should send people through a
  // redirect any more — least of all a staff invitation, whose whole job is one tap to accept.
  // `posUrl` is read ONLY by the staff invitation (staffInviteEmail.ts) to build the accept link;
  // `logoUrl` is the shared shell, and the same asset is served from both hosts.
  logoUrl: "https://pos.dkasu.com/waka-logo.png",
  siteUrl: "https://dkasu.com",
  posUrl: "https://pos.dkasu.com",
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
