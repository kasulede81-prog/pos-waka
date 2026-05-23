import type { Sale, ShopProfile } from "./pos-store";
import { formatUGX } from "./pos-store";

export function buildReceiptText(sale: Sale, profile: ShopProfile): string {
  const lines: string[] = [];
  if (profile.shopName) lines.push(`*${profile.shopName}*`);
  lines.push(`Receipt #${sale.id.slice(0, 8).toUpperCase()}`);
  lines.push(new Date(sale.createdAt).toLocaleString("en-UG"));
  lines.push("");
  for (const it of sale.items) {
    lines.push(`${it.qty} × ${it.name} — ${formatUGX(it.price * it.qty)}`);
  }
  lines.push("");
  lines.push(`*Total: ${formatUGX(sale.total)}*`);
  lines.push(`Payment: ${sale.method.toUpperCase()}`);
  if (sale.customerName) lines.push(`Customer: ${sale.customerName}`);
  lines.push("");
  lines.push("Webale! — sent via Waka POS");
  return lines.join("\n");
}

/** Normalise UG numbers to international format for wa.me / sms links. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits.slice(1);
  if (digits.startsWith("256")) return digits;
  if (digits.startsWith("0")) return "256" + digits.slice(1);
  return digits;
}

export function whatsappLink(phone: string, text: string): string | null {
  const n = normalisePhone(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function smsLink(phone: string, text: string): string | null {
  const n = normalisePhone(phone);
  if (!n) return null;
  // Use the ?body= form which most mobile browsers accept.
  return `sms:+${n}?body=${encodeURIComponent(text)}`;
}
