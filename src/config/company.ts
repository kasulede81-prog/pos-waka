/** Public brand, SEO, and legal identity for waka.ug / pos.waka.ug */

/** Marketing site (home, about, legal pages served from same app). */
export const WAKA_SITE_URL = "https://waka.ug";

/** Live POS web app — use for auth redirects, PWA scope, and app canonical URLs. */
export const WAKA_POS_URL = "https://pos.waka.ug";

/** @deprecated Use WAKA_POS_URL for app; WAKA_SITE_URL for marketing canonicals. */
export const CANONICAL_MARKETING_ORIGIN = WAKA_SITE_URL.replace(/\/$/, "");

export const WAKA_BRAND_NAME = "WAKA";
export const WAKA_SLOGAN = "Tech for next generation";
export const WAKA_BRAND_LINE = "Simple technology for everyday business";

/** Registered legal entity (terms, privacy, invoices, company page only). */
export const WAKA_LEGAL_COMPANY_NAME = "WAKA MARKETPLACE LIMITED";
export const WAKA_COMPANY_TYPE = "Private Limited By Shares";
export const WAKA_COMPANY_COUNTRY = "Uganda";

export const WAKA_MAIN_PRODUCT = "Waka POS";
export const WAKA_PRODUCT_DESCRIPTION =
  "Waka POS by WAKA helps shops, supermarkets, pharmacies, salons, and restaurants in Uganda manage sales, stock, and daily reports without complicated systems.";

export const WAKA_SEO_DEFAULT_TITLE = "Waka POS | Simple POS for Shops in Uganda";
export const WAKA_SEO_DEFAULT_DESCRIPTION = WAKA_PRODUCT_DESCRIPTION;

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
export const FOUNDER_PHOTO_ALT = "Kasule Denis, founder of Waka Technologies and Waka POS";

export const FOUNDER_BIO_SHORT =
  "Ugandan entrepreneur building Waka POS with WAKA. Simple tools for real shops and businesses.";

export const FOUNDER_HOME_LINE =
  "Built by Kasule Denis and WAKA for shop owners who want clear sales and stock without stress.";

export const FOUNDER_VISION =
  "We build technology that helps African businesses grow. Simple systems that save time and make daily work easier for ordinary people.";

export const FOUNDER_QUOTE = FOUNDER_VISION;

export const FOUNDER_QUOTE_SECOND =
  "Waka POS is for everyday businesses: shops, pharmacies, salons, supermarkets, restaurants, and market vendors.";

export const FOUNDER_JOURNEY_SUMMARY =
  "Kasule Denis built Waka Technologies and Waka POS after running businesses in Uganda, working abroad, and later focusing on software from Italy to serve African SMEs.";

export const FOUNDER_JOURNEY_BUSINESS = `Before Waka POS, he owned and operated businesses including DK Computer Arena and Hospel Medical Center. He later sold those businesses to focus on building software for African businesses.`;

export const FOUNDER_JOURNEY_QATAR = `In 2021, he worked in Qatar. That experience shaped his discipline and his understanding of how people work hard to build better lives and businesses.`;

export const FOUNDER_JOURNEY_ITALY = `Time in Italy helped him learn more, focus on technology, and raise capital to invest in Waka POS and future projects for Uganda and Africa.`;

export const FOUNDER_WHY_WAKA = `Waka POS comes from real shop experience. Many small businesses in Uganda still manage stock, sales, and records manually. The goal is a simple, practical system for shops, supermarkets, pharmacies, salons, restaurants, and market vendors.`;

export const FOUNDER_JOURNEY_TODAY = `Today, Kasule Denis continues building business technology for African SMEs, with mobile-first tools that work in real business environments.`;

export const FOUNDER_BIO_PARAGRAPHS: readonly string[] = [
  `${FOUNDER_NAME} is a Ugandan entrepreneur and founder of ${WAKA_BRAND_NAME}, the company behind ${WAKA_MAIN_PRODUCT}.`,
  FOUNDER_JOURNEY_BUSINESS,
  FOUNDER_JOURNEY_QATAR,
  FOUNDER_JOURNEY_ITALY,
  FOUNDER_WHY_WAKA,
  FOUNDER_JOURNEY_TODAY,
];

/** @deprecated use FOUNDER_BIO_PARAGRAPHS */
export const FOUNDER_BIO_LONG = FOUNDER_BIO_PARAGRAPHS.join("\n\n");

/** @deprecated use WAKA_BRAND_LINE */
export const WAKA_COMPANY_TAGLINE = WAKA_SLOGAN;

export const DEFAULT_OG_IMAGE = `${WAKA_SITE_URL}/og-waka-technologies.png`;

export const SEO_KEYWORDS = [
  "Uganda POS",
  "POS system Uganda",
  "Waka POS",
  "WAKA",
  "shop POS Uganda",
  "supermarket POS Uganda",
  "pharmacy POS Uganda",
  "salon POS Uganda",
  "restaurant POS Uganda",
  "offline POS Uganda",
  "inventory Uganda",
  "small business software Uganda",
  "Kasule Denis",
  "Uganda tech founder",
].join(", ");

export function absoluteUrl(path: string, base: string = WAKA_SITE_URL): string {
  if (path.startsWith("http")) return path;
  const origin = base.replace(/\/$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function marketingCanonical(path: string): string {
  return absoluteUrl(path, WAKA_SITE_URL);
}

export function posCanonical(path: string): string {
  return absoluteUrl(path, WAKA_POS_URL);
}

export function wakaSupportWhatsAppUrl(text = "Hello Waka Technologies, I need help with Waka POS."): string {
  return `https://wa.me/${WAKA_SUPPORT_WHATSAPP_WA_ME}?text=${encodeURIComponent(text)}`;
}

export function wakaSupportMailtoUrl(subject = "Waka POS enquiry", body = ""): string {
  const params = new URLSearchParams();
  params.set("subject", subject);
  if (body) params.set("body", body);
  return `mailto:${WAKA_SUPPORT_EMAILS.join(",")}?${params.toString()}`;
}
