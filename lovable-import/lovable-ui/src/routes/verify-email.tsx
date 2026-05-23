import { createFileRoute, Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/verify-email")({
  head: () => seoHead({ title: "Check your email — Waka POS", description: "Confirm your email to finish signing up.", path: "/verify-email" }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { t } = useI18n();
  return (
    <AuthLayout title={t("auth.verify.title")} subtitle={t("auth.verify.body")}>
      <div className="grid place-items-center py-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-waka-100 text-waka-700">
          <MailCheck className="h-8 w-8" />
        </div>
      </div>
      <Link to="/login" className="mt-4 block rounded-xl border border-border bg-card py-3 text-center text-sm font-bold hover:bg-muted">
        {t("auth.signin")}
      </Link>
    </AuthLayout>
  );
}
