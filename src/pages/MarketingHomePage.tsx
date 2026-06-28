import type { Language } from "../types";
import { MarketingLayout } from "../components/marketing/MarketingLayout";
import { SeoHead } from "../components/marketing/SeoHead";
import { WAKA_SEO_HOME_DESCRIPTION, WAKA_SEO_HOME_TITLE } from "../config/company";
import { MarketingMotionProvider } from "../components/marketing/website2026/MarketingMotion";
import { MarketingHeroSection } from "../components/marketing/website2026/MarketingHeroSection";
import {
  MarketingBusinessTypesSection,
  MarketingComparisonSection,
  MarketingFaqSection,
  MarketingFeaturesSection,
  MarketingFinalCtaSection,
  MarketingHardwareSection,
  MarketingPricingSection,
  MarketingShowcaseSection,
  MarketingTestimonialsSection,
  MarketingTrustedSection,
} from "../components/marketing/website2026/MarketingSections";
import { FounderSection } from "../components/marketing/FounderSection";

type Props = {
  lang: Language;
  setLang: (l: Language) => void;
  isAuthenticated: boolean;
};

/** Waka POS marketing home — 2026 premium landing page. */
export function MarketingHomePage({ lang, setLang, isAuthenticated }: Props) {
  return (
    <MarketingLayout lang={lang} setLang={setLang} isAuthenticated={isAuthenticated}>
      <SeoHead title={WAKA_SEO_HOME_TITLE} description={WAKA_SEO_HOME_DESCRIPTION} path="/home" structuredData="home" />

      <MarketingMotionProvider>
        <div className="space-y-4 sm:space-y-8">
          <MarketingHeroSection isAuthenticated={isAuthenticated} />
          <MarketingTrustedSection />
          <MarketingBusinessTypesSection />
          <MarketingFeaturesSection />
          <MarketingShowcaseSection />
          <MarketingHardwareSection />
          <MarketingPricingSection />
          <MarketingComparisonSection />
          <MarketingTestimonialsSection />
          <MarketingFaqSection />
          <FounderSection compact />
          <MarketingFinalCtaSection />
        </div>
      </MarketingMotionProvider>
    </MarketingLayout>
  );
}
