/** Waka POS customer support — Uganda team contacts */

export const WAKA_LEGAL_COMPANY_NAME = "WAKA MARKETPLACE LIMITED";
export const WAKA_COMPANY_TYPE = "Private Limited By Shares";
export const WAKA_COMPANY_COUNTRY = "Uganda";
export const WAKA_COMPANY_LOCATION = "Namasuba Central, Masajja Ward, Wakiso District, Central Region, Uganda";
export const WAKA_COMPANY_POSTAL_ADDRESS = "P.O Box 4010, Kampala, Uganda";
export const WAKA_COMPANY_TAGLINE = "Uganda-based business software company";
export const WAKA_MAIN_PRODUCT = "Waka POS";
export const WAKA_SUPPORT_EMAILS = ["info@waka.ug", "wakamarketplace@gmail.com"] as const;
export const WAKA_SUPPORT_WHATSAPP_E164 = "256792521711";

/** wa.me expects country code + number without + */
export const WAKA_SUPPORT_WHATSAPP_WA_ME = "256792521711";

export const WAKA_SUPPORT_EMAIL = WAKA_SUPPORT_EMAILS[0];

export function wakaSupportWhatsAppUrl(): string {
  const text = encodeURIComponent("Hello Waka POS team, I need help.");
  return `https://wa.me/${WAKA_SUPPORT_WHATSAPP_WA_ME}?text=${text}`;
}

export function wakaSupportMailtoUrl(): string {
  const subject = encodeURIComponent("Waka POS help");
  const body = encodeURIComponent("Hello Waka POS team,\n\nI need help with:\n\n");
  return `mailto:${WAKA_SUPPORT_EMAILS.join(",")}?subject=${subject}&body=${body}`;
}
