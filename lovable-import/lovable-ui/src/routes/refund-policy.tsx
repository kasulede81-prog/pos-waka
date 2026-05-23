import { createFileRoute } from "@tanstack/react-router";
import { LegalPolicyPage } from "@/components/marketing/legal-policy-page";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/refund-policy")({
  head: () =>
    seoHead({
      title: "Refund policy — Waka POS",
      description: "Refund policy for Waka POS paid plans.",
      path: "/refund-policy",
    }),
  component: RefundPage,
});

function RefundPage() {
  const { t } = useI18n();
  return (
    <LegalPolicyPage title={t("legal.refund")}>
      <h2>Free plan</h2>
      <p>The Free plan is, well, free. Nothing to refund.</p>
      <h2>Paid plans</h2>
      <p>Plans are billed in advance. You can cancel at any time and you won't be billed again. We don't offer refunds for the current billing period.</p>
      <h2>Service issues</h2>
      <p>If our service is the problem, contact us. We'll make it right.</p>
    </LegalPolicyPage>
  );
}
