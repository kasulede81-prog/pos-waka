import { wrapEmailLayout } from "../layout.ts";
import { WAKA_EMAIL_BRAND } from "../config.ts";

export type WelcomeEmailTemplateInput = {
  recipientName?: string | null;
  shopName?: string | null;
};

export function welcomeEmailSubject(): string {
  return "Welcome to DKASU POS";
}

export function renderWelcomeEmailHtml(input: WelcomeEmailTemplateInput): string {
  const name = input.recipientName?.trim() || "there";
  const shopLine = input.shopName?.trim()
    ? `<p style="margin:0 0 12px;">Your shop <strong>${input.shopName.trim()}</strong> is ready. You can start adding products, recording sales, and inviting staff from the app.</p>`
    : `<p style="margin:0 0 12px;">Your account is ready. Start adding products, recording sales, and inviting staff from the app.</p>`;

  return wrapEmailLayout({
    preheader: "Your DKASU POS account is ready — simple sales and stock for your shop.",
    title: "Welcome to DKASU POS",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${name},</p>
      <p style="margin:0 0 12px;">Welcome aboard! DKASU POS helps shops across Uganda manage sales, stock, and daily reports — even when the network is slow.</p>
      ${shopLine}
      <p style="margin:0;">Open the app anytime to continue setup or jump straight to the POS.</p>
    `,
    cta: { label: "Open DKASU POS", href: WAKA_EMAIL_BRAND.posUrl },
    footerNote: `Need help? Reply to this email or contact us at support@waka.ug.`,
  });
}

export function welcomeEmailPlainText(input: WelcomeEmailTemplateInput): string {
  const name = input.recipientName?.trim() || "there";
  const shop = input.shopName?.trim();
  return `Welcome to DKASU POS

Hi ${name},

Your DKASU POS account is ready${shop ? ` for ${shop}` : ""}.

Open the app: ${WAKA_EMAIL_BRAND.posUrl}

Need help? Contact support@waka.ug

— DKASU POS / WAKA MARKETPLACE LIMITED
https://waka.ug`;
}
