import { createFileRoute } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/company")({
  head: () =>
    seoHead({
      title: "Company — Waka Technologies",
      description: "Company registration and legal information for Waka Technologies.",
      path: "/company",
    }),
  component: CompanyPage,
});

function CompanyPage() {
  const { t } = useI18n();
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-black tracking-tight">{t("company.title")}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t("company.intro")}</p>
        <dl className="mt-10 space-y-4 rounded-2xl border border-border/60 bg-card p-6">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t("company.legal_name")}
            </dt>
            <dd className="mt-1 text-base font-bold">{t("brand.legal")}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Trading as
            </dt>
            <dd className="mt-1 text-base font-bold">Waka Technologies</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Country
            </dt>
            <dd className="mt-1 text-base font-bold">Uganda</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Website
            </dt>
            <dd className="mt-1 text-base font-bold">https://waka.ug</dd>
          </div>
        </dl>
      </article>
    </MarketingLayout>
  );
}
