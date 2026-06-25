import { WAKA_EMAIL_BRAND } from "./config.ts";

export type EmailLayoutContent = {
  preheader?: string;
  title: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  footerNote?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Shared responsive Waka email shell for all transactional templates. */
export function wrapEmailLayout(content: EmailLayoutContent): string {
  const b = WAKA_EMAIL_BRAND;
  const preheader = content.preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(content.preheader)}</span>`
    : "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
        <tr>
          <td style="border-radius:12px;background:${b.primaryColor};">
            <a href="${escapeHtml(content.cta.href)}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;padding:14px 28px;font-family:DM Sans,Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">
              ${escapeHtml(content.cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : "";
  const footerNote = content.footerNote
    ? `<p style="margin:20px 0 0;font-family:DM Sans,Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:${b.mutedColor};">${content.footerNote}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(content.title)}</title>
</head>
<body style="margin:0;padding:0;background:${b.canvasColor};-webkit-text-size-adjust:100%;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.canvasColor};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${b.backgroundColor};border:1px solid ${b.borderColor};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 28px 20px;text-align:center;background:linear-gradient(180deg,#f0fdf4 0%,#ffffff 100%);">
              <img src="${b.logoUrl}" width="120" height="auto" alt="Waka POS" style="display:block;margin:0 auto;max-width:120px;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 32px;">
              <h1 style="margin:0 0 16px;font-family:DM Sans,Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:800;color:${b.textColor};text-align:center;">
                ${escapeHtml(content.title)}
              </h1>
              <div style="font-family:DM Sans,Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#44403c;">
                ${content.bodyHtml}
              </div>
              ${cta}
              ${footerNote}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid ${b.borderColor};text-align:center;">
              <p style="margin:0 0 6px;font-family:DM Sans,Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${b.mutedColor};">
                ${escapeHtml(b.companyName)}
              </p>
              <p style="margin:0;font-family:DM Sans,Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;">
                <a href="${b.siteUrl}" style="color:${b.primaryColorDark};text-decoration:none;font-weight:600;">${b.siteUrl.replace(/^https?:\/\//, "")}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
