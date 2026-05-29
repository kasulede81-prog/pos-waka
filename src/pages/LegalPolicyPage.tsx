import { Link } from "react-router-dom";
import type { Language } from "../types";
import { publicBrandHref, useAuthShellForPublicPage } from "../lib/nativeApp";
import { AuthLayout } from "../components/AuthLayout";
import { MarketingLayout } from "../components/marketing/MarketingLayout";
import { SeoHead } from "../components/marketing/SeoHead";
import { WakaSupportCard } from "../components/support/WakaSupportCard";
import { FOUNDER_NAME } from "../config/company";
import {
  WAKA_COMPANY_COUNTRY,
  WAKA_COMPANY_LOCATION,
  WAKA_COMPANY_POSTAL_ADDRESS,
  WAKA_COMPANY_TAGLINE,
  WAKA_COMPANY_TYPE,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_SUPPORT_EMAILS,
} from "../config/wakaSupport";

type LegalKind = "terms" | "privacy" | "refund" | "acceptable-use";

type Props = {
  kind: LegalKind;
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
};

type Section = {
  title: string;
  body: string[];
};

const policyContent: Record<LegalKind, { title: string; intro: string; sections: Section[] }> = {
  terms: {
    title: "Terms & Conditions",
    intro: `${WAKA_MAIN_PRODUCT} is operated by ${WAKA_LEGAL_COMPANY_NAME}, a Ugandan registered company founded by ${FOUNDER_NAME}. These terms explain the fair rules for using Waka POS and related Waka business services.`,
    sections: [
      {
        title: "Company identity",
        body: [
          `${WAKA_LEGAL_COMPANY_NAME} is a ${WAKA_COMPANY_TYPE} registered in ${WAKA_COMPANY_COUNTRY}.`,
          `Registered office: ${WAKA_COMPANY_LOCATION}. Postal address: ${WAKA_COMPANY_POSTAL_ADDRESS}.`,
        ],
      },
      {
        title: "Using Waka POS",
        body: [
          "Waka POS helps shops record sales, stock, debts, staff activity, receipts, reports, and daily business work.",
          "You are responsible for entering correct business information, keeping your login or PIN private, and using the app for lawful business activity.",
        ],
      },
      {
        title: "Free Mode and paid plans",
        body: [
          "New users may start in Free Mode with basic features and limits. You can upgrade to a paid plan when your business needs more products, backup, staff, devices, or advanced features.",
          "Paid subscriptions, renewals, expiries, and special activations may be handled by Waka support or authorised admins.",
        ],
      },
      {
        title: "Offline use and cloud backup",
        body: [
          "Waka POS is designed to keep working offline where possible. Some features, such as cloud backup, syncing, account changes, and multi-device features, need internet access.",
          "When sync is available, your device may send saved changes to Waka systems so your business records can be backed up or shared with authorised devices.",
        ],
      },
      {
        title: "Support handling",
        body: [
          `For help, contact ${WAKA_SUPPORT_EMAILS.join(" or ")}. We try to respond fairly and practically, especially for payment, activation, backup, and account issues.`,
          "We may need your shop name, phone number, email, device details, or screenshots to understand and resolve a support request.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: `${WAKA_LEGAL_COMPANY_NAME} respects the privacy of Waka POS users. This policy explains what information we collect and why we use it.`,
    sections: [
      {
        title: "Information we collect",
        body: [
          "We may collect account information, shop details, staff names or roles, product records, sales records, customer debt records, support messages, device information, and sync activity.",
          "We collect this information to provide Waka POS, support your account, improve reliability, manage subscriptions, and help with backup or recovery.",
        ],
      },
      {
        title: "Backups, sync, and offline mode",
        body: [
          "When you use Waka POS offline, records may stay on your device until internet connection is available.",
          "If your plan or settings include cloud backup or sync, your records may be uploaded to Waka systems so they can be restored, protected, or shared with authorised users in your business.",
        ],
      },
      {
        title: "How we protect information",
        body: [
          "We use reasonable measures to help protect your information.",
          "No system is perfect, so business owners should also protect their devices, passwords, staff PINs, and account access.",
        ],
      },
      {
        title: "No selling of data",
        body: [
          "We do not sell your business data.",
          "We may use trusted service providers, such as hosting, database, email, or support tools, only where needed to run Waka POS and related services.",
        ],
      },
      {
        title: "Contact",
        body: [
          `Questions about privacy can be sent to ${WAKA_SUPPORT_EMAILS.join(" or ")}.`,
          `Registered office: ${WAKA_COMPANY_LOCATION}.`,
        ],
      },
    ],
  },
  refund: {
    title: "Refund Policy",
    intro: "This refund policy explains how Waka POS handles subscription payments, renewals, accidental payments, and support reviews.",
    sections: [
      {
        title: "Subscription activation",
        body: [
          "When a paid plan is activated, Waka POS may unlock paid features such as more products, staff accounts, backup, or multi-device access.",
          "Completed billing periods are generally non-refundable once the plan has been activated and made available for use.",
        ],
      },
      {
        title: "Renewals and expiry",
        body: [
          "Renewals extend access to paid features for the selected period. If a paid plan expires, the account may return to Free Mode and paid features may become unavailable.",
          "If there is a payment or activation problem, contact support quickly so we can review it.",
        ],
      },
      {
        title: "Accidental payment review",
        body: [
          "If you made an accidental payment, duplicate payment, or paid the wrong amount, contact support with payment proof, phone number, shop name, and date of payment.",
          "We will review the case fairly. Depending on the situation, we may correct the subscription, extend days, or advise the next step.",
        ],
      },
      {
        title: "How to request help",
        body: [`Refund or billing questions should be sent to ${WAKA_SUPPORT_EMAILS.join(" or ")}.`],
      },
    ],
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    intro: "This policy keeps Waka POS safe, fair, and useful for Ugandan businesses.",
    sections: [
      {
        title: "Use Waka POS responsibly",
        body: [
          "Use Waka POS for lawful business operations, such as selling, managing stock, tracking debts, reports, and business records.",
          "Do not use Waka POS to commit fraud, hide illegal activity, abuse customers, or interfere with other users.",
        ],
      },
      {
        title: "Account and staff access",
        body: [
          "Business owners should only give access to trusted staff and should remove access when a worker leaves.",
          "Do not share admin access, staff PINs, or sensitive business information with unauthorised people.",
        ],
      },
      {
        title: "System protection",
        body: [
          "Do not try to break, overload, copy, reverse engineer, or misuse Waka systems.",
          "Do not upload harmful files, spam, or content that damages the service or other users.",
        ],
      },
      {
        title: "Fair action",
        body: [
          "If there is serious misuse, Waka may limit access, suspend support, or take steps needed to protect the service and customers.",
          "We aim to handle issues fairly and with clear communication where possible.",
        ],
      },
    ],
  },
};

const SEO_PATH: Record<LegalKind, string> = {
  terms: "/terms",
  privacy: "/privacy",
  refund: "/refund-policy",
  "acceptable-use": "/acceptable-use",
};

export function LegalPolicyPage({ kind, lang, setLang, isAuthenticated }: Props) {
  const content = policyContent[kind];
  const brandHref = publicBrandHref(isAuthenticated);
  const body = (
    <>
      <SeoHead title={content.title} description={content.intro} path={SEO_PATH[kind]} structuredData="legal" />
      <main className="space-y-5">
        <section className="rounded-3xl border border-orange-100 bg-white p-6 shadow-waka-sm">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-700">{WAKA_COMPANY_TAGLINE}</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-stone-950">{content.title}</h1>
          <p className="mt-3 text-base font-medium leading-relaxed text-stone-600">{content.intro}</p>
        </section>

        <section className="space-y-3">
          {content.sections.map((section) => (
            <article key={section.title} className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-stone-950">{section.title}</h2>
              <div className="mt-3 space-y-2">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm font-medium leading-relaxed text-stone-700">
                    {paragraph}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </section>

        <WakaSupportCard />

        <div className="flex flex-wrap justify-center gap-3 rounded-3xl border border-stone-100 bg-white p-4 text-sm font-black text-orange-800">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refund-policy">Refund Policy</Link>
          <Link to="/acceptable-use">Acceptable Use</Link>
          <Link to="/about">About</Link>
          <Link to="/company">Company</Link>
          <Link to="/founder">Founder</Link>
          <Link to="/support">Contact Support</Link>
        </div>
      </main>
    </>
  );

  if (useAuthShellForPublicPage(isAuthenticated)) {
    return (
      <AuthLayout lang={lang} setLang={setLang} brandHref={brandHref}>
        {body}
      </AuthLayout>
    );
  }

  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={false}>
      {body}
    </MarketingLayout>
  );
}
