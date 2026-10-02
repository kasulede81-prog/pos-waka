/**
 * Public brand, SEO, and legal identity.
 *
 * WAKA → DKASU REBRAND. The brand and product names below are DKASU; the LEGAL ENTITY is unchanged
 * (`WAKA_LEGAL_COMPANY_NAME`), because the operating company is still Waka Marketplace Limited and
 * the registered details must keep matching the paperwork.
 *
 * THE EXPORT NAMES ARE DELIBERATELY UNCHANGED. They are imported by 22 modules and asserted by
 * tests; renaming `WAKA_POS_URL` to `DKASU_POS_URL` would be a large, purely cosmetic refactor with
 * no user-visible benefit and real breakage risk. Only the VALUES the user sees have moved.
 */

import { publicAssetUrl } from "../lib/publicAssetUrl";

/** The consumer brand. */
export const DKASU_BRAND_NAME = "DKASU";
/** The product. */
export const DKASU_PRODUCT_NAME = "DKASU POS";
/** Approved tagline (matches the supplied artwork). */
export const DKASU_TAGLINE = "Empowering Businesses for a Brighter Tomorrow";
/** The name this product was previously sold under — for transitional copy only. */
export const DKASU_LEGACY_PRODUCT_NAME = "WAKA POS";

/**
 * DKASU PRODUCTION ORIGINS — the PUBLIC, canonical identity. Used for SEO (canonicals, `og:url`,
 * JSON-LD `url`, sitemap entries, public share links) AND, since the auth migration of 2026-10-02,
 * for authentication itself: `WAKA_POS_URL` / `WAKA_LOYALTY_URL` below now point at these origins.
 *
 * THE OLD DOMAINS STAY COMPATIBLE. Supabase Redirect URLs and Google OAuth origins were configured
 * for the DKASU origins BEFORE the switch, and the WAKA origins remain configured on both services
 * and 308-redirect to DKASU — so old links, old emails and open sessions keep working. Do not
 * remove the legacy hosts from the compatibility allowlists (`productHost.ts`,
 * `nativeAuthDeepLink.ts`, `webPrintHandoff.ts`, `authConfig.ts`).
 */
export const DKASU_SITE_URL = "https://dkasu.com";
export const DKASU_POS_URL = "https://pos.dkasu.com";
export const DKASU_LOYALTY_URL = "https://loyalty.dkasu.com";

/** Marketing site (home, about, legal pages). Public canonical origin — SEO only, never auth. */
export const WAKA_SITE_URL = DKASU_SITE_URL;

/**
 * AUTH-critical origins. See the note above before changing either one.
 * Live POS web app — used for auth redirects, the native OAuth proxy, and PWA scope.
 * DKASU origin since 2026-10-02; the WAKA host stays allowlisted on Supabase/Google and 308s here.
 */
export const WAKA_POS_URL = "https://pos.dkasu.com";

/**
 * Customer-facing loyalty card origin (B3).
 * Override with VITE_LOYALTY_APP_URL (e.g. http://localhost:5173 in development).
 * DKASU origin since 2026-10-02; the WAKA host stays allowlisted on Supabase/Google and 308s here.
 */
const loyaltyUrlFromEnv = String(import.meta.env.VITE_LOYALTY_APP_URL ?? "")
  .trim()
  .replace(/\/$/, "");
export const WAKA_LOYALTY_URL =
  loyaltyUrlFromEnv && /^https?:\/\//i.test(loyaltyUrlFromEnv)
    ? loyaltyUrlFromEnv
    : "https://loyalty.dkasu.com";

/** @deprecated Use WAKA_POS_URL for app; WAKA_SITE_URL for marketing canonicals. */
export const CANONICAL_MARKETING_ORIGIN = WAKA_SITE_URL.replace(/\/$/, "");

export const WAKA_BRAND_NAME = DKASU_BRAND_NAME;
export const WAKA_SLOGAN = DKASU_TAGLINE;
export const WAKA_BRAND_LINE = "Simple technology for everyday business";

/** Registered legal entity (terms, privacy, invoices, company page only). */
export const WAKA_LEGAL_COMPANY_NAME = "WAKA MARKETPLACE LIMITED";
export const WAKA_COMPANY_TYPE = "Private Limited By Shares";
export const WAKA_COMPANY_COUNTRY = "Uganda";

export const WAKA_MAIN_PRODUCT = DKASU_PRODUCT_NAME;
export const WAKA_PRODUCT_DESCRIPTION =
  "DKASU POS by DKASU helps shops, supermarkets, pharmacies, salons, and restaurants in Uganda manage sales, stock, and daily reports without complicated systems.";

export const WAKA_SEO_HOME_TITLE = "DKASU POS – Business Management & POS Software for Uganda";
export const WAKA_SEO_HOME_DESCRIPTION =
  "DKASU POS helps shops, supermarkets, pharmacies, boutiques and growing businesses manage sales, inventory, customers and staff in one powerful platform.";
export const WAKA_SEO_DEFAULT_TITLE = WAKA_SEO_HOME_TITLE;
export const WAKA_SEO_DEFAULT_DESCRIPTION = WAKA_SEO_HOME_DESCRIPTION;

export const WAKA_OFFICE_STREET =
  "Opposite Freedom City, Namasuba – Kikajjo Road, Namasuba Central, Masajja Ward, Wakiso District";
export const WAKA_OFFICE_CITY = "Kampala";
export const WAKA_OFFICE_REGION = "Central Region";
export const WAKA_OFFICE_COUNTRY = "Uganda";
export const WAKA_COMPANY_POSTAL_ADDRESS = "P.O Box 4010, Kampala, Uganda";

export const WAKA_SUPPORT_EMAILS = ["support@waka.ug", "wakamarketplace@gmail.com"] as const;
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
export const FOUNDER_PHOTO_SRC = publicAssetUrl("founder-kasule-denis.jpg.jpeg");
export const FOUNDER_PHOTO_ALT = "Kasule Denis, founder of DKASU and DKASU POS";

export const FOUNDER_BIO_SHORT =
  "Ugandan entrepreneur building DKASU POS with DKASU. Simple tools for real shops and businesses.";

export const FOUNDER_HOME_LINE =
  "Built by Kasule Denis and DKASU for shop owners who want clear sales and stock without stress.";

export const FOUNDER_VISION =
  "We build technology that helps African businesses grow. Simple systems that save time and make daily work easier for ordinary people.";

export const FOUNDER_QUOTE = FOUNDER_VISION;

export const FOUNDER_QUOTE_SECOND =
  "DKASU POS is for everyday businesses: shops, pharmacies, salons, supermarkets, restaurants, and market vendors.";

export const FOUNDER_JOURNEY_SUMMARY =
  "Kasule Denis built DKASU and DKASU POS after running businesses in Uganda, working abroad, and later focusing on software from Italy to serve African SMEs.";

export const FOUNDER_JOURNEY_BUSINESS = `Before DKASU POS, he owned and operated businesses including DK Computer Arena and Hospel Medical Center. He later sold those businesses to focus on building software for African businesses.`;

export const FOUNDER_JOURNEY_QATAR = `In 2021, he worked in Qatar. That experience shaped his discipline and his understanding of how people work hard to build better lives and businesses.`;

export const FOUNDER_JOURNEY_ITALY = `Time in Italy helped him learn more, focus on technology, and raise capital to invest in DKASU POS and future projects for Uganda and Africa.`;

export const FOUNDER_WHY_WAKA = `DKASU POS comes from real shop experience. Many small businesses in Uganda still manage stock, sales, and records manually. The goal is a simple, practical system for shops, supermarkets, pharmacies, salons, restaurants, and market vendors.`;

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

export const DEFAULT_OG_IMAGE = `${WAKA_SITE_URL}/og-dkasu.png`;

export const SEO_KEYWORDS = [
  "Uganda POS",
  "POS system Uganda",
  "DKASU POS",
  "DKASU",
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

/**
 * POS canonical / public share origin. SEO and public links ONLY — these are the DKASU origins, so
 * a canonical can never be an old WAKA URL that merely redirects. Auth uses `WAKA_POS_URL`, which
 * since 2026-10-02 points at the same DKASU origin.
 */
export function posCanonical(path: string): string {
  return absoluteUrl(path, DKASU_POS_URL);
}

/** Token-free loyalty card canonical/og:url (never include public_card_token). */
export function loyaltyCanonical(path: string): string {
  return absoluteUrl(path, DKASU_LOYALTY_URL);
}

export function wakaSupportWhatsAppUrl(text = "Hello DKASU, I need help with DKASU POS."): string {
  return `https://wa.me/${WAKA_SUPPORT_WHATSAPP_WA_ME}?text=${encodeURIComponent(text)}`;
}

export function wakaSupportMailtoUrl(subject = "DKASU POS enquiry", body = ""): string {
  const params = new URLSearchParams();
  params.set("subject", subject);
  if (body) params.set("body", body);
  return `mailto:${WAKA_SUPPORT_EMAILS.join(",")}?${params.toString()}`;
}

/** Visual identity — re-export for legal/marketing; canonical tokens in `src/lib/brandTokens.ts` */
export {
  WAKA_BRAND_ORANGE,
  WAKA_BRAND_ORANGE_DARK,
  WAKA_BRAND_CREAM,
  WAKA_BRAND_CREAM_WASH,
  WAKA_BRAND_FONT_STACK,
} from "../lib/brandTokens";
