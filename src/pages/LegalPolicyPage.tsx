import { Link } from "react-router-dom";
import type { Language } from "../types";
import { publicBrandHref, useAuthShellForPublicPage } from "../lib/nativeApp";
import { AuthLayout } from "../components/AuthLayout";
import { MarketingLayout } from "../components/marketing/MarketingLayout";
import { SeoHead } from "../components/marketing/SeoHead";
import { WakaSupportCard } from "../components/support/WakaSupportCard";
import {
  WAKA_COMPANY_COUNTRY,
  WAKA_COMPANY_POSTAL_ADDRESS,
  WAKA_COMPANY_TAGLINE,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_SUPPORT_EMAILS,
} from "../config/wakaSupport";

type LegalKind = "terms" | "privacy" | "acceptable-use";

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
    intro:
      "Last Updated: June 2026. Welcome to Waka POS. These Terms & Conditions (\"Terms\") govern your access to and use of Waka POS, including our mobile applications, web applications, cloud services, backups, synchronization services, and related business tools (collectively, the \"Services\"). By creating an account, accessing, or using Waka POS, you agree to be bound by these Terms.",
    sections: [
      {
        title: "1. About Waka POS",
        body: [
          `Waka POS is operated by ${WAKA_LEGAL_COMPANY_NAME}, a company registered in ${WAKA_COMPANY_COUNTRY}.`,
          "Waka POS provides business management tools including but not limited to: Point of Sale (POS), Inventory Management, Customer Debt Tracking, Supplier Management, Staff & Shift Management, Cash Drawer Management, Reporting & Analytics, Inventory Count Sessions, Cloud Backup & Synchronization, Audit Logs & Business Intelligence, and Multi-Device Operations.",
          "Waka POS is designed to help businesses manage daily operations, record transactions, monitor performance, and protect business records.",
        ],
      },
      {
        title: "2. Eligibility",
        body: [
          "To use Waka POS, you must be at least 18 years old; or be authorized to act on behalf of a registered business or organization.",
          "You are responsible for ensuring that all registration information provided to Waka POS is accurate, complete, and kept up to date.",
        ],
      },
      {
        title: "3. Account Registration & Security",
        body: [
          "You are responsible for maintaining the confidentiality of account credentials, PINs, staff access codes, biometric access enabled on your devices, and authorized devices connected to your account.",
          "You agree to notify Waka POS immediately if you believe your account, device, or credentials have been compromised.",
          "Waka POS is not responsible for losses resulting from shared passwords or PINs, unsecured devices, unauthorized staff access, device theft, malware or phishing attacks, or failure to follow reasonable security practices.",
          "You remain responsible for activities performed under your account unless otherwise required by law.",
        ],
      },
      {
        title: "4. Subscription Plans & Access",
        body: [
          "Waka POS may offer free plans, trial plans, paid subscriptions, enterprise agreements, and promotional activations.",
          "Available features, limits, storage, backups, staff accounts, devices, and integrations may vary depending on the selected plan.",
          "Failure to maintain an active subscription may result in reduced functionality, account restrictions, or suspension of premium services.",
          "Subscription fees are generally non-refundable unless required by applicable law or expressly approved by Waka POS.",
        ],
      },
      {
        title: "5. Offline Operation & Synchronization",
        body: [
          "Waka POS is designed to operate both online and offline. While offline, business records may be stored locally on your device until synchronization becomes available.",
          "When internet connectivity is restored, Waka POS may upload transactions, synchronize inventory, update cloud backups, restore business records, and synchronize authorized devices.",
          "You acknowledge that temporary differences may occur between devices until synchronization is completed.",
          "Users are responsible for ensuring devices are periodically connected to the internet to maintain accurate synchronization and backup protection.",
        ],
      },
      {
        title: "6. Cash Management, Staff Accountability & Business Records",
        body: [
          "Waka POS may record operational events including day drawer opens, shift starts and closures, cash variances, float verification, inventory adjustments, void transactions, returns and refunds, discounts, debt collections, and audit events.",
          "These records are intended to assist business owners in managing operations and accountability.",
          "Waka POS provides reporting and monitoring tools but does not independently determine employee misconduct, theft, fraud, negligence, or legal liability.",
          "Business owners remain responsible for reviewing records and making management decisions.",
        ],
      },
      {
        title: "7. Data Ownership & Privacy",
        body: [
          "You retain ownership of the business data you enter into Waka POS. This may include products, customers, sales, suppliers, inventory records, staff records, reports, audit logs, and operational history.",
          "Waka POS processes and stores data according to its Privacy Policy. We do not sell customer business data.",
          "Data may be disclosed only when required by law, required by a court order, necessary to protect our systems or users, or necessary to provide requested services.",
        ],
      },
      {
        title: "8. Cloud Backups & Data Recovery",
        body: [
          "Where enabled, Waka POS may create cloud backups and synchronization snapshots.",
          "While we take reasonable measures to protect business data, no backup or synchronization system can guarantee prevention of all data loss.",
          "Users are strongly encouraged to keep devices secure, maintain internet connectivity when possible, export important records periodically, and review synchronization status regularly.",
          "Waka POS is not responsible for losses caused by deleted exports, damaged devices, third-party platform failures, or user actions that permanently remove business records.",
        ],
      },
      {
        title: "9. Data Deletion & Account Closure",
        body: [
          "Business owners may request account closure or permanent deletion of an organization.",
          "Deletion may result in the removal of business records, cloud backups, synchronization data, associated accounts, and access permissions.",
          "Certain records may be retained where required by law, fraud prevention requirements, security obligations, dispute resolution, or legitimate business interests.",
          "Once deletion has been completed, some data may no longer be recoverable.",
        ],
      },
      {
        title: "10. Acceptable Use",
        body: [
          "You agree not to use Waka POS for unlawful activities, upload malicious software, attempt unauthorized access to systems, reverse engineer or copy proprietary software, interfere with platform security, use Waka POS to harm other users, misrepresent business information, or circumvent subscription or licensing controls.",
          "Violations may result in suspension or termination of access.",
        ],
      },
      {
        title: "11. Suspension & Termination",
        body: [
          "Waka POS may suspend or terminate accounts when these Terms are violated, fraudulent activity is suspected, payment obligations are not met, security risks are identified, or required information is intentionally falsified.",
          "Users may also close their accounts at any time.",
          "Termination of access does not automatically remove obligations that arose before termination.",
        ],
      },
      {
        title: "12. Limitation of Liability",
        body: [
          "Waka POS is provided on an \"as available\" and \"as is\" basis.",
          `To the maximum extent permitted by law, ${WAKA_LEGAL_COMPANY_NAME} shall not be liable for lost profits, lost revenue, business interruption, data loss, device failure, synchronization delays, staff misconduct, inventory discrepancies, or indirect or consequential damages.`,
          "Users remain responsible for verifying business records and maintaining appropriate operational controls.",
        ],
      },
      {
        title: "13. Changes to These Terms",
        body: [
          "We may update these Terms periodically to reflect new features, legal requirements, security improvements, or business changes.",
          "Material updates may be communicated through in-app notifications, email, or official Waka POS announcements.",
          "Continued use of the Services after updates become effective constitutes acceptance of the revised Terms.",
        ],
      },
      {
        title: "14. Governing Law",
        body: [
          `These Terms shall be governed by and interpreted in accordance with the laws of the Republic of ${WAKA_COMPANY_COUNTRY}.`,
          `Any disputes arising from the use of Waka POS shall be resolved through the appropriate courts and legal processes of ${WAKA_COMPANY_COUNTRY} unless otherwise required by applicable law.`,
        ],
      },
      {
        title: "15. Contact Information",
        body: [
          WAKA_LEGAL_COMPANY_NAME,
          "Registered Office: Opposite Freedom City, Namasuba – Kikajjo Road, Masajja Ward, Wakiso District, Kampala, Uganda.",
          `Postal Address: ${WAKA_COMPANY_POSTAL_ADDRESS}.`,
          `Email: ${WAKA_SUPPORT_EMAILS.join(", ")}.`,
          "Website: www.waka.ug",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: `Effective Date: June 2026. ${WAKA_LEGAL_COMPANY_NAME} ("Waka POS", "we", "our", or "us") is committed to protecting your privacy and handling your information responsibly. This Privacy Policy explains how we collect, use, store, process, and protect information when you use Waka POS, including our website, mobile applications, cloud services, synchronization services, and related business tools (collectively, the "Services"). By accessing or using Waka POS, you agree to the practices described in this Privacy Policy.`,
    sections: [
      {
        title: "Definitions",
        body: [
          "Personal Data: Information that identifies or can reasonably identify an individual, including names, phone numbers, email addresses, staff information, customer records, and business account details.",
          "Business Data: Information entered into Waka POS by business owners or authorized staff, including products, inventory records, sales, expenses, suppliers, customers, debts, reports, inventory counts, cash drawer records, and operational history.",
          "Usage Data: Technical information automatically collected when using Waka POS, including device information, browser information, application version, error logs, performance statistics, and synchronization activity.",
          "Cookies: Small files stored on your device that help remember preferences, maintain sessions, and improve user experience.",
        ],
      },
      {
        title: "1. Information We Collect",
        body: [
          "Information you provide: We may collect full name, email address, phone number, business name, business registration information (where provided), subscription information, billing information, support communications, and business preferences and settings.",
          "Business records: Waka POS may store products and inventory, sales transactions, customer records, customer debt records, supplier records, purchase records, expenses, cash drawer records, shift records, inventory count sessions, reports and analytics, and audit logs.",
          "Staff information: Where enabled by a business owner, Waka POS may store staff names, staff roles, permissions, shift activity, operational actions, and accountability records.",
          "Device and technical information: We may automatically collect device identifiers, device type and operating system, browser information, application version, crash reports, error logs, performance metrics, synchronization activity, backup activity, and security events.",
        ],
      },
      {
        title: "2. How We Use Information",
        body: [
          "We use collected information to provide Waka POS services, authenticate users, manage subscriptions and activations, synchronize business records, create backups and recovery snapshots, improve reliability and performance, detect fraud, abuse, and security threats, provide customer support, comply with legal obligations, and develop and improve features.",
          "We do not sell your business data.",
        ],
      },
      {
        title: "3. Offline Use, Synchronization & Cloud Services",
        body: [
          "Waka POS is designed to operate both online and offline. When operating offline, business records may remain stored locally on your device and data may not immediately appear on other authorized devices.",
          "When synchronization is enabled, business records may be transmitted to Waka POS cloud infrastructure, authorized devices may receive synchronized information, cloud backups and recovery snapshots may be generated, and business data may be restored following device replacement, recovery, or reinstallation.",
          "Synchronization may include sales, inventory updates, customer records, supplier records, shift records, cash drawer records, inventory count sessions, audit logs, and operational history.",
        ],
      },
      {
        title: "4. Audit Logs & Operational Monitoring",
        body: [
          "To improve accountability, security, and support, Waka POS may record operational events including sign-ins and authentication activity, device activity, staff actions, inventory adjustments, cash drawer events, shift activity, synchronization events, and security-related activity.",
          "These records help us diagnose technical issues, investigate support requests, improve reliability, protect business accounts, and detect unauthorized access.",
          "Audit logs are not used for advertising purposes.",
        ],
      },
      {
        title: "5. Cookies & Similar Technologies",
        body: [
          "Waka POS may use cookies and similar technologies to maintain sessions, remember preferences, improve user experience, measure platform performance, and improve reliability.",
          "Users may disable cookies through browser settings; however, some features may not function correctly if cookies are disabled.",
        ],
      },
      {
        title: "6. Sharing of Information",
        body: [
          "We do not sell customer or business data.",
          "Service providers: Trusted providers may assist us with cloud hosting, databases, email delivery, customer support, analytics, and infrastructure monitoring. These providers may access information only as necessary to provide services on our behalf.",
          "Legal requirements: We may disclose information when required by law, by court order, by regulatory authorities, to protect our legal rights, or to prevent fraud or abuse.",
        ],
      },
      {
        title: "7. Data Retention",
        body: [
          "We retain information for as long as necessary to operate Waka POS, provide support, maintain backups, resolve disputes, prevent fraud, and meet legal obligations.",
          "Retention periods may vary depending on the type of information involved.",
          "Business owners may request deletion of eligible information, subject to legal and operational requirements.",
        ],
      },
      {
        title: "8. Data Security",
        body: [
          "We use reasonable technical and organizational measures to protect information, including authentication controls, access controls, secure infrastructure, monitoring and logging, backup systems, and security reviews.",
          "However, no security system can guarantee absolute protection.",
          "Business owners are responsible for protecting passwords and PINs, managing staff permissions, securing devices, and monitoring authorized access.",
        ],
      },
      {
        title: "9. Data Access, Export & Deletion",
        body: [
          "Business owners may access their information, export supported records, request account closure, and request deletion of eligible information.",
          "Certain information may be retained where necessary for legal compliance, fraud prevention, security investigations, or dispute resolution.",
          "Once deletion is completed, some information may become permanently unrecoverable.",
        ],
      },
      {
        title: "10. International Data Processing",
        body: [
          "Information may be processed or stored using cloud infrastructure and service providers located in different countries.",
          "By using Waka POS, you acknowledge that information may be transferred and processed where necessary to provide the Services.",
          "Appropriate safeguards are applied where required.",
        ],
      },
      {
        title: "11. Children's Privacy",
        body: [
          "Waka POS is intended for business users and individuals aged 18 years or older.",
          "We do not knowingly collect personal information from children.",
          "If we become aware that information from a child has been collected without proper authorization, we will take reasonable steps to remove it.",
        ],
      },
      {
        title: "12. Your Privacy Rights",
        body: [
          "Subject to applicable law, users may have rights to access information we hold, correct inaccurate information, request deletion of eligible information, request export of supported information, object to certain processing activities, and withdraw consent where applicable.",
          "Requests may be submitted using the contact details below.",
        ],
      },
      {
        title: "13. Changes to this Privacy Policy",
        body: [
          "We may update this Privacy Policy from time to time.",
          "Material changes may be communicated through in-app notifications, email notifications, or official Waka POS communication channels.",
          "Continued use of Waka POS after changes become effective constitutes acceptance of the updated Privacy Policy.",
        ],
      },
      {
        title: "14. Contact Information",
        body: [
          WAKA_LEGAL_COMPANY_NAME,
          "Registered Office: Opposite Freedom City, Namasuba – Kikajjo Road, Masajja Ward, Wakiso District, Kampala, Uganda.",
          `Postal Address: ${WAKA_COMPANY_POSTAL_ADDRESS}.`,
          `Email: ${WAKA_SUPPORT_EMAILS.join(", ")}.`,
          "Website: www.waka.ug",
          "For privacy-related questions, requests, or concerns, please contact us using the details above.",
        ],
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
