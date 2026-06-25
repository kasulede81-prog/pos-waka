import { wrapEmailLayout } from "../layout.ts";

export type VerifyEmailTemplateInput = {
  confirmationUrl: string;
  recipientName?: string | null;
};

export function verifyEmailSubject(): string {
  return "Confirm your Waka POS email";
}

export function renderVerifyEmailHtml(input: VerifyEmailTemplateInput): string {
  const greeting = input.recipientName?.trim()
    ? `Hi ${input.recipientName.trim()},`
    : "Hi there,";

  return wrapEmailLayout({
    preheader: "Confirm your email to finish setting up Waka POS.",
    title: "Verify your email",
    bodyHtml: `
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 12px;">Thanks for creating a Waka POS account. Confirm your email address to unlock cloud sync, staff access, and subscriptions.</p>
      <p style="margin:0;">This link expires in about one hour and can only be used once.</p>
    `,
    cta: { label: "Confirm email", href: input.confirmationUrl },
    footerNote: "If you did not create a Waka POS account, you can safely ignore this email.",
  });
}

export function verifyEmailPlainText(input: VerifyEmailTemplateInput): string {
  return `Confirm your Waka POS email

Open this link to verify your address (expires in about one hour):
${input.confirmationUrl}

If you did not create a Waka POS account, ignore this email.

— Waka POS / WAKA MARKETPLACE LIMITED
https://waka.ug`;
}
