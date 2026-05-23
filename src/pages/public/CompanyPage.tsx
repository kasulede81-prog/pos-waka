import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { MarketingLayout } from "../../components/marketing/MarketingLayout";
import { SeoHead } from "../../components/marketing/SeoHead";
import {
  FOUNDER_NAME,
  WAKA_COMPANY_COUNTRY,
  WAKA_COMPANY_POSTAL_ADDRESS,
  WAKA_COMPANY_TYPE,
  WAKA_BRAND_NAME,
  WAKA_LEGAL_COMPANY_NAME,
  WAKA_MAIN_PRODUCT,
  WAKA_SLOGAN,
  WAKA_OFFICE_STREET,
  WAKA_SITE_URL,
  WAKA_SUPPORT_EMAILS,
} from "../../config/company";
import { WAKA_COMPANY_LOCATION } from "../../config/wakaSupport";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

export function CompanyPage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead
        title="Company & legal information"
        description={`${WAKA_BRAND_NAME} (${WAKA_LEGAL_COMPANY_NAME}) operates ${WAKA_MAIN_PRODUCT} in ${WAKA_COMPANY_COUNTRY}. Registered office and legal details.`}
        path="/company"
      />

      <article className="space-y-6">
        <header className="space-y-3">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-700">Legal</p>
          <h1 className="text-4xl font-black text-stone-950">Company information</h1>
          <p className="text-base font-medium text-stone-600">
            Public brand: {WAKA_BRAND_NAME} · {WAKA_SLOGAN}. Legal registration below.
          </p>
        </header>

        <InfoBlock title="Public brand">{WAKA_BRAND_NAME}</InfoBlock>
        <InfoBlock title="Legal name">{WAKA_LEGAL_COMPANY_NAME}</InfoBlock>
        <InfoBlock title="Company type">{WAKA_COMPANY_TYPE}</InfoBlock>
        <InfoBlock title="Country of registration">{WAKA_COMPANY_COUNTRY}</InfoBlock>
        <InfoBlock title="Main product">{WAKA_MAIN_PRODUCT}</InfoBlock>
        <InfoBlock title="Website">
          <a href={WAKA_SITE_URL} className="text-orange-800 underline">
            {WAKA_SITE_URL}
          </a>
        </InfoBlock>
        <InfoBlock title="Founder">
          {FOUNDER_NAME} —{" "}
          <Link to="/founder" className="text-orange-800 underline">
            Founder profile
          </Link>
        </InfoBlock>
        <InfoBlock title="Registered office">{WAKA_COMPANY_LOCATION}</InfoBlock>
        <InfoBlock title="Street address">{WAKA_OFFICE_STREET}</InfoBlock>
        <InfoBlock title="Postal address">{WAKA_COMPANY_POSTAL_ADDRESS}</InfoBlock>
        <InfoBlock title="Contact email">{WAKA_SUPPORT_EMAILS.join(" · ")}</InfoBlock>
        <InfoBlock title="Industry">Business software / POS systems</InfoBlock>

        <nav className="flex flex-wrap gap-3 rounded-3xl border border-stone-100 bg-white p-5 text-sm font-black text-orange-800">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refund-policy">Refund policy</Link>
          <Link to="/acceptable-use">Acceptable use</Link>
        </nav>
      </article>
    </MarketingLayout>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <h2 className="text-[11px] font-black uppercase tracking-wide text-stone-500">{title}</h2>
      <p className="mt-2 text-sm font-semibold text-stone-800">{children}</p>
    </section>
  );
}
