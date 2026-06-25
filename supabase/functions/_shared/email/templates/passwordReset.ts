import { wrapEmailLayout } from "../layout.ts";

export type PasswordResetTemplateInput = {
  confirmationUrl: string;
  recipientName?: string | null;
};

export function passwordResetSubject(): string {
  return "Reset your Waka POS password";
}

export function renderPasswordResetHtml(input: PasswordResetTemplateInput): string {
  const greeting = input.recipientName?.trim()
    ? `Hi ${input.recipientName.trim()},`
    : "Hi there,";

  return wrapEmailLayout({
    preheader: "Reset your Waka POS password securely.",
    title: "Reset your password",
    bodyHtml: `
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 12px;">We received a request to reset the password for your Waka POS shop account. Tap the button below to choose a new password.</p>
      <p style="margin:0;">This link expires in about one hour. If you did not request a reset, you can ignore this email — your password will stay the same.</p>
    `,
    cta: { label: "Reset password", href: input.confirmationUrl },
    footerNote: "For security, never share this link with anyone.",
  });
}

export function passwordResetPlainText(input: PasswordResetTemplateInput): string {
  return `Reset your Waka POS password

Open this link to set a new password (expires in about one hour):
${input.confirmationUrl}

If you did not request this, ignore this email.

— Waka POS / WAKA MARKETPLACE LIMITED
https://waka.ug`;
}
