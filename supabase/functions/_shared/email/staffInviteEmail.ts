import { WAKA_EMAIL_BRAND } from "./config.ts";
import { wrapEmailLayout } from "./layout.ts";

export function staffInviteAcceptUrl(token: string): string {
  const base = WAKA_EMAIL_BRAND.posUrl.replace(/\/$/, "");
  return `${base}/staff/accept?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderStaffInviteEmail(input: {
  shopName?: string | null;
  roleLabel: string;
  acceptUrl: string;
}): { subject: string; html: string; text: string } {
  const shop = (input.shopName ?? "").trim() || "a Waka POS shop";
  const role = (input.roleLabel ?? "staff").trim() || "staff";
  const subject = `You're invited to join ${shop} on Waka POS`;
  const html = wrapEmailLayout({
    preheader: `Join ${shop} as ${role}.`,
    title: "Join your shop on Waka POS",
    bodyHtml: `<p style="margin:0 0 12px;">You were invited to work at <strong>${escapeHtml(shop)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
<p style="margin:0;">Create or sign in with this email, then accept the invitation. The link expires in 7 days and can only be used once.</p>`,
    cta: { label: "Accept invitation", href: input.acceptUrl },
    footerNote: "If you were not expecting this invite, you can ignore this email.",
  });
  const text = [
    `You were invited to work at ${shop} as ${input.roleLabel}.`,
    `Accept: ${input.acceptUrl}`,
    "This link expires in 7 days and can only be used once.",
  ].join("\n");
  return { subject, html, text };
}
