import { createFileRoute } from "@tanstack/react-router";
import { LegalPolicyPage } from "@/components/marketing/legal-policy-page";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/acceptable-use")({
  head: () =>
    seoHead({
      title: "Acceptable use — Waka POS",
      description: "Acceptable use policy for Waka POS.",
      path: "/acceptable-use",
    }),
  component: AupPage,
});

function AupPage() {
  const { t } = useI18n();
  return (
    <LegalPolicyPage title={t("legal.acceptable")}>
      <h2>What you can't do</h2>
      <p>No illegal goods, no fraud, no harassment of other users or our staff, no abuse of the infrastructure.</p>
      <h2>Consequences</h2>
      <p>We can suspend or close accounts that violate this policy.</p>
    </LegalPolicyPage>
  );
}
