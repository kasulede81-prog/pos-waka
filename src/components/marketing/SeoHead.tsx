import { useEffect } from "react";
import {
  FOUNDER_JOURNEY_SUMMARY,
  FOUNDER_NAME,
  FOUNDER_PHOTO_SRC,
  WAKA_BRAND_NAME,
  WAKA_COMPANY_COUNTRY,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_OFFICE_CITY,
  WAKA_OFFICE_COUNTRY,
  WAKA_OFFICE_STREET,
  WAKA_PRODUCT_DESCRIPTION,
  WAKA_SITE_URL,
  WAKA_SLOGAN,
  WAKA_SUPPORT_EMAIL,
  marketingCanonical,
  DEFAULT_OG_IMAGE,
  SEO_KEYWORDS,
} from "../../config/company";

export type SeoProps = {
  title: string;
  description?: string;
  path?: string;
  image?: string;
  type?: "website" | "article" | "profile";
  noindex?: boolean;
  /** Include Organization + SoftwareApplication + Person JSON-LD */
  structuredData?: "home" | "page" | "founder" | "contact" | "legal";
};

function setMeta(name: string, content: string, attribute: "name" | "property" = "name") {
  let el = document.querySelector(`meta[${attribute}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attribute, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function injectJsonLd(id: string, data: Record<string, unknown>) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const script = document.createElement("script");
  script.id = id;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: WAKA_BRAND_NAME,
    legalName: WAKA_LEGAL_COMPANY_NAME,
    slogan: WAKA_SLOGAN,
    url: WAKA_SITE_URL,
    logo: marketingCanonical("/waka-logo.png"),
    email: WAKA_SUPPORT_EMAIL,
    foundingDate: "2023",
    founder: { "@type": "Person", name: FOUNDER_NAME },
    address: {
      "@type": "PostalAddress",
      streetAddress: WAKA_OFFICE_STREET,
      addressLocality: WAKA_OFFICE_CITY,
      addressCountry: WAKA_COMPANY_COUNTRY,
    },
    sameAs: [] as string[],
  };
}

function softwareSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: WAKA_MAIN_PRODUCT,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Android",
    offers: { "@type": "Offer", price: "0", priceCurrency: "UGX" },
    description: WAKA_PRODUCT_DESCRIPTION,
    url: "https://pos.waka.ug",
    provider: { "@type": "Organization", name: WAKA_BRAND_NAME },
    author: { "@type": "Person", name: FOUNDER_NAME },
  };
}

function personSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: FOUNDER_NAME,
    jobTitle: "Founder & CEO",
    description: `${FOUNDER_NAME} founded ${WAKA_BRAND_NAME} and ${WAKA_MAIN_PRODUCT}. ${FOUNDER_JOURNEY_SUMMARY}`,
    image: marketingCanonical(FOUNDER_PHOTO_SRC),
    worksFor: { "@type": "Organization", name: WAKA_BRAND_NAME },
    nationality: { "@type": "Country", name: "Uganda" },
    knowsAbout: ["Point of sale", "Shop software", "Inventory", "Ugandan SMEs"],
    url: marketingCanonical("/founder"),
  };
}

function localBusinessSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: WAKA_BRAND_NAME,
    image: DEFAULT_OG_IMAGE,
    url: marketingCanonical("/contact"),
    telephone: "+256-792-521711",
    email: WAKA_SUPPORT_EMAIL,
    address: {
      "@type": "PostalAddress",
      streetAddress: WAKA_OFFICE_STREET,
      addressLocality: WAKA_OFFICE_CITY,
      addressCountry: WAKA_OFFICE_COUNTRY,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "08:00",
        closes: "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Saturday",
        opens: "10:00",
        closes: "16:00",
      },
    ],
  };
}

export function SeoHead({
  title,
  description = WAKA_PRODUCT_DESCRIPTION,
  path = "/",
  image = DEFAULT_OG_IMAGE,
  type = "website",
  noindex = false,
  structuredData = "page",
}: SeoProps) {
  const canonical = marketingCanonical(path);
  const fullTitle = title.includes("|") ? title : `${title} | ${WAKA_MAIN_PRODUCT}`;

  useEffect(() => {
    document.title = fullTitle;
    setMeta("description", description);
    setMeta("keywords", SEO_KEYWORDS);
    setMeta("robots", noindex ? "noindex, nofollow" : "index, follow");
    setCanonical(canonical);

    setMeta("og:title", fullTitle, "property");
    setMeta("og:description", description, "property");
    setMeta("og:type", type, "property");
    setMeta("og:url", canonical, "property");
    setMeta("og:image", image, "property");
    setMeta("og:site_name", WAKA_BRAND_NAME, "property");
    setMeta("og:locale", "en_UG", "property");

    setMeta("twitter:card", "summary_large_image", "property");
    setMeta("twitter:title", fullTitle, "property");
    setMeta("twitter:description", description, "property");
    setMeta("twitter:image", image, "property");

    injectJsonLd("waka-schema-org", organizationSchema());
    injectJsonLd("waka-schema-software", softwareSchema());

    if (structuredData === "home" || structuredData === "founder") {
      injectJsonLd("waka-schema-person", personSchema());
    }
    if (structuredData === "home" || structuredData === "contact") {
      injectJsonLd("waka-schema-local", localBusinessSchema());
    }
  }, [fullTitle, description, canonical, image, type, noindex, structuredData]);

  return null;
}
