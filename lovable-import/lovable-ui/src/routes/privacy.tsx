import { createFileRoute } from "@tanstack/react-router";
import { LegalPolicyPage } from "@/components/marketing/legal-policy-page";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/privacy")({
  head: () =>
    seoHead({
      title: "Privacy policy — Waka POS",
      description: "How Waka POS handles your data.",
      path: "/privacy",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { t } = useI18n();
  return (
    <LegalPolicyPage title={t("legal.privacy")}>
      <h2>Information we collect</h2>
      <p>Account info (email, shop name, phone), shop data you enter, and basic usage logs to keep the service reliable.</p>
      <h2>How we use it</h2>
      <p>To run Waka POS for you, sync your data across devices, and contact you about your account.</p>
      <h2>Sharing</h2>
      <p>We don't sell your data. We share only with the providers required to run the service (cloud hosting, payments).</p>
      <h2>Your rights</h2>
      <p>Export or delete your data at any time. Email hello@waka.ug.</p>
    </LegalPolicyPage>
  );
}
