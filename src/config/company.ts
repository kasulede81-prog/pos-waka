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

/** Short line for homepage and compact founder cards */
export const FOUNDER_BIO_SHORT =
  "Ugandan technology entrepreneur and founder of Waka POS. Building simple business software for shops and SMEs across Uganda.";

/** One sentence for homepage hero area */
export const FOUNDER_HOME_LINE =
  "Founded by Kasule Denis, a Ugandan software founder who built Waka POS from real shop experience.";

export const FOUNDER_VISION =
  "We want to build technology that genuinely helps African businesses grow. Simple systems that work well, save time, and make daily business easier for ordinary people.";

export const FOUNDER_QUOTE = FOUNDER_VISION;

export const FOUNDER_QUOTE_SECOND =
  "Waka POS is for everyday businesses: shops, pharmacies, salons, supermarkets, restaurants, and market vendors.";

/** SEO / meta snippets */
export const FOUNDER_JOURNEY_SUMMARY =
  "Kasule Denis founded Waka Marketplace Limited after running businesses in Uganda, working in Qatar in 2021, and later focusing on technology from Italy to build Waka POS for African SMEs.";

export const FOUNDER_JOURNEY_BUSINESS = `Before Waka POS, he owned and operated businesses including DK Computer Arena and Hospel Medical Center. As his interest in technology grew, he sold those businesses to focus fully on building software and digital systems for African businesses.`;

export const FOUNDER_JOURNEY_QATAR = `In 2021, he worked in Qatar. That experience helped shape his discipline, independence, and understanding of how everyday people work hard to build better lives and businesses.`;

export const FOUNDER_JOURNEY_ITALY = `Moving to Italy became another important step in his journey. It gave him time to learn more, experience different systems, focus deeply on technology, and raise more capital to invest into Waka POS and future projects for Uganda and Africa.`;

export const FOUNDER_WHY_WAKA = `Waka POS was created from real business experience and real market challenges. Many small businesses in Uganda still manage stock, sales, and records manually. The goal is to give shops, supermarkets, pharmacies, salons, restaurants, and market vendors a modern system that is simple, practical, and easy to use.`;

export const FOUNDER_JOURNEY_TODAY = `Today, Kasule Denis continues building business technology focused on African SMEs, with an emphasis on mobile-first systems, simplicity, and tools that work in real business environments.`;

/** Full founder page narrative (paragraphs) */
export const FOUNDER_BIO_PARAGRAPHS: readonly string[] = [
  "Kasule Denis is a Ugandan technology entrepreneur and the founder of Waka Marketplace Limited, the company behind Waka POS.",
  FOUNDER_JOURNEY_BUSINESS,
  FOUNDER_JOURNEY_QATAR,
  FOUNDER_JOURNEY_ITALY,
  FOUNDER_WHY_WAKA,
  FOUNDER_JOURNEY_TODAY,
];

/** @deprecated use FOUNDER_BIO_PARAGRAPHS */
export const FOUNDER_BIO_LONG = FOUNDER_BIO_PARAGRAPHS.join("\n\n");

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
