import { createFileRoute } from "@tanstack/react-router";
import { LegalPolicyPage } from "@/components/marketing/legal-policy-page";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/terms")({
  head: () =>
    seoHead({
      title: "Terms & conditions — Waka POS",
      description: "Terms and conditions for using Waka POS.",
      path: "/terms",
    }),
  component: TermsPage,
});

function TermsPage() {
  const { t } = useI18n();
  return (
    <LegalPolicyPage title={t("legal.terms")}>
      <h2>1. Your account</h2>
      <p>You are responsible for the activity on your Waka POS account and for keeping your login credentials safe.</p>
      <h2>2. Your shop data</h2>
      <p>Your sales, stock, customers and supplier information belong to you. We store it securely and only access it to provide the service.</p>
      <h2>3. Payment</h2>
      <p>Paid plans are billed in UGX. You can downgrade at any time; we don't offer refunds for the current billing period.</p>
      <h2>4. Acceptable use</h2>
      <p>Don't use Waka POS for illegal activity or to harm other users. See the Acceptable Use policy for details.</p>
      <h2>5. Contact</h2>
      <p>Questions about these terms: hello@waka.ug</p>
    </LegalPolicyPage>
  );
}
