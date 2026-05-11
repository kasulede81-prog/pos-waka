/** Waka POS customer support — Uganda team contacts */

export const WAKA_SUPPORT_WHATSAPP_E164 = "256792521711";

/** wa.me expects country code + number without + */
export const WAKA_SUPPORT_WHATSAPP_WA_ME = "256792521711";

export const WAKA_SUPPORT_EMAIL = "support@waka.ug";

export function wakaSupportWhatsAppUrl(): string {
  const text = encodeURIComponent("Hello Waka POS team, I need help.");
  return `https://wa.me/${WAKA_SUPPORT_WHATSAPP_WA_ME}?text=${text}`;
}

export function wakaSupportMailtoUrl(): string {
  const subject = encodeURIComponent("Waka POS help");
  const body = encodeURIComponent("Hello Waka POS team,\n\nI need help with:\n\n");
  return `mailto:${WAKA_SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
