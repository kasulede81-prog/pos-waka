import { createFileRoute } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/founder")({
  head: () =>
    seoHead({
      title: "Kasule Denis — Founder, Waka Technologies",
      description: "Kasule Denis founded Waka Technologies to build POS software for Ugandan shops.",
      path: "/founder",
    }),
  component: FounderPage,
});

function FounderPage() {
  const { t } = useI18n();
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-4 py-16">
        <div className="flex items-center gap-5">
          <div className="h-24 w-24 shrink-0 rounded-full bg-gradient-to-br from-waka-200 to-waka-500" />
          <div>
            <h1 className="text-3xl font-black tracking-tight">{t("founder.title")}</h1>
            <p className="mt-1 text-sm font-semibold text-primary">{t("founder.role")}</p>
          </div>
        </div>
        <p className="mt-8 text-lg text-muted-foreground">{t("founder.body")}</p>
      </article>
    </MarketingLayout>
  );
}
