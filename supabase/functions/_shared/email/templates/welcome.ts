import { wrapEmailLayout } from "../layout.ts";
import { WAKA_EMAIL_BRAND } from "../config.ts";

export type WelcomeEmailTemplateInput = {
  recipientName?: string | null;
  shopName?: string | null;
};

export function welcomeEmailSubject(): string {
  return "Welcome to Waka POS";
}

export function renderWelcomeEmailHtml(input: WelcomeEmailTemplateInput): string {
  const name = input.recipientName?.trim() || "there";
  const shopLine = input.shopName?.trim()
    ? `<p style="margin:0 0 12px;">Your shop <strong>${input.shopName.trim()}</strong> is ready. You can start adding products, recording sales, and inviting staff from the app.</p>`
    : `<p style="margin:0 0 12px;">Your account is ready. Start adding products, recording sales, and inviting staff from the app.</p>`;

  return wrapEmailLayout({
    preheader: "Your Waka POS account is ready — simple sales and stock for your shop.",
    title: "Welcome to Waka POS",
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${name},</p>
      <p style="margin:0 0 12px;">Welcome aboard! Waka POS helps shops across Uganda manage sales, stock, and daily reports — even when the network is slow.</p>
      ${shopLine}
      <p style="margin:0;">Open the app anytime to continue setup or jump straight to the POS.</p>
    `,
    cta: { label: "Open Waka POS", href: WAKA_EMAIL_BRAND.posUrl },
    footerNote: `Need help? Reply to this email or contact us at support@waka.ug.`,
  });
}

export function welcomeEmailPlainText(input: WelcomeEmailTemplateInput): string {
  const name = input.recipientName?.trim() || "there";
  const shop = input.shopName?.trim();
  return `Welcome to Waka POS

Hi ${name},

Your Waka POS account is ready${shop ? ` for ${shop}` : ""}.

Open the app: ${WAKA_EMAIL_BRAND.posUrl}

Need help? Contact support@waka.ug

— Waka POS / WAKA MARKETPLACE LIMITED
https://waka.ug`;
}
