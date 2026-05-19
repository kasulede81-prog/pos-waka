/** Public company identity, founder, and SEO defaults for waka-ug.com */

export const WAKA_SITE_URL = "https://waka-ug.com";

export const WAKA_LEGAL_COMPANY_NAME = "WAKA MARKETPLACE LIMITED";
export const WAKA_COMPANY_TYPE = "Private Limited By Shares";
export const WAKA_COMPANY_COUNTRY = "Uganda";
export const WAKA_COMPANY_TAGLINE = "Uganda-based business software company";
export const WAKA_MAIN_PRODUCT = "Waka POS";
export const WAKA_PRODUCT_DESCRIPTION =
  "Waka POS is a Ugandan point-of-sale system designed for shops, supermarkets, pharmacies, salons, restaurants, and small businesses across Uganda.";

export const WAKA_OFFICE_STREET =
  "Opposite Freedom City, Namasuba – Kikajjo Road, Namasuba Central, Masajja Ward, Wakiso District";
export const WAKA_OFFICE_CITY = "Kampala";
export const WAKA_OFFICE_REGION = "Central Region";
export const WAKA_OFFICE_COUNTRY = "Uganda";
export const WAKA_COMPANY_POSTAL_ADDRESS = "P.O Box 4010, Kampala, Uganda";

export const WAKA_SUPPORT_EMAILS = ["info@waka.ug", "wakamarketplace@gmail.com"] as const;
export const WAKA_SUPPORT_EMAIL = WAKA_SUPPORT_EMAILS[0];
export const WAKA_SUPPORT_WHATSAPP_WA_ME = "256792521711";

export const WAKA_OFFICE_HOURS = {
  weekdays: "Monday–Friday: 8:00 AM – 6:00 PM",
  saturday: "Saturday: 10:00 AM – 4:00 PM",
  sunday: "Sunday: Closed",
} as const;

export const FOUNDER_NAME = "Kasule Denis";
export const FOUNDER_ROLE = "Founder & CEO";
export const FOUNDER_BIRTH_PLACE = "Uganda";
export const FOUNDER_BASE = "Uganda / Italy";
export const FOUNDER_PHOTO_SRC = "/founder-kasule-denis.jpg";
export const FOUNDER_PHOTO_ALT =
  "Kasule Denis, Ugandan technology entrepreneur and Founder & CEO of Waka Marketplace Limited, the company behind Waka POS";

export const FOUNDER_BIO_SHORT =
  "Ugandan technology entrepreneur and African startup founder building Waka POS — simple, affordable business software for Uganda and Africa.";

export const FOUNDER_JOURNEY_SUMMARY =
  "Before Waka Marketplace Limited, Kasule Denis worked in Qatar as a barista in 2021. He later sold DK Computer Arena and Hospel Medical Center to fully focus on building Waka POS and practical technology for African businesses.";

export const FOUNDER_JOURNEY_EARLY = `Before building Waka Marketplace Limited, Kasule Denis worked in Qatar as a barista in 2021. It was honest work far from home — and a season that shaped his discipline, patience, and respect for everyday business life.`;

export const FOUNDER_JOURNEY_BUSINESS = `Driven by a long-term vision to build practical technology for African businesses, he later sold previous ventures — DK Computer Arena and Hospel Medical Center — to commit fully to the technology company and Waka POS. That was not an exit for show; it was a choice to concentrate time, energy, and resources on software that local businesses can actually use.`;

export const FOUNDER_JOURNEY_VISION = `His mission is to create simple, affordable, and locally relevant digital business tools for businesses across Uganda and Africa — POS, inventory, reports, and systems that work on real shop floors, not only in presentations.`;

export const FOUNDER_WHY_WAKA = `Waka POS exists because many Ugandan shops still run on notebooks, memory, and guesswork. Kasule Denis founded it under Waka Marketplace Limited to give everyday businesses — shops, pharmacies, salons, supermarkets, and market vendors — a calm, mobile-first way to manage sales, stock, debts, and staff without enterprise complexity.`;

export const FOUNDER_BIO_LONG = `Kasule Denis is a Ugandan technology entrepreneur, African startup founder, and the founder of Waka Marketplace Limited, the company behind Waka POS. Born on 3 June 2002, he builds from Uganda and Italy with a focus on software that respects how real businesses operate.

${FOUNDER_JOURNEY_EARLY}

${FOUNDER_JOURNEY_BUSINESS}

${FOUNDER_JOURNEY_VISION}

${FOUNDER_WHY_WAKA}`;

export const FOUNDER_QUOTE =
  "Our goal is simple — help African businesses grow using simple technology that works in the real world.";

export const FOUNDER_QUOTE_SECOND =
  "Waka POS is built for everyday businesses: shops, pharmacies, salons, supermarkets, restaurants, and market vendors.";

export const DEFAULT_OG_IMAGE = `${WAKA_SITE_URL}/og-waka-pos.png`;

export const SEO_KEYWORDS = [
  "Uganda POS",
  "POS system Uganda",
  "Waka POS",
  "supermarket POS Uganda",
  "pharmacy POS Uganda",
  "salon POS Uganda",
  "offline POS Uganda",
  "Uganda inventory system",
  "Uganda business software",
  "Ugandan tech entrepreneur",
  "Founder of Waka POS",
  "Waka Marketplace Limited",
  "Uganda POS founder",
  "African software entrepreneur",
  "African startup founder",
  "Ugandan software founder",
].join(", ");

export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const base = WAKA_SITE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function wakaSupportWhatsAppUrl(text = "Hello Waka POS team, I need help."): string {
  return `https://wa.me/${WAKA_SUPPORT_WHATSAPP_WA_ME}?text=${encodeURIComponent(text)}`;
}

export function wakaSupportMailtoUrl(subject = "Waka POS enquiry", body = ""): string {
  const params = new URLSearchParams();
  params.set("subject", subject);
  if (body) params.set("body", body);
  return `mailto:${WAKA_SUPPORT_EMAILS.join(",")}?${params.toString()}`;
}
