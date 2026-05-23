import { createFileRoute } from "@tanstack/react-router";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/about")({
  head: () =>
    seoHead({
      title: "About — Waka Technologies",
      description:
        "Waka Technologies builds simple, trustworthy tools for Ugandan small businesses.",
      path: "/about",
    }),
  component: AboutPage,
});

function AboutPage() {
  const { t } = useI18n();
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-black tracking-tight">{t("about.title")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("about.intro")}</p>

        <h2 className="mt-12 text-2xl font-black">{t("about.vision.title")}</h2>
        <p className="mt-3 text-muted-foreground">{t("about.vision.body")}</p>

        <h2 className="mt-12 text-2xl font-black">{t("about.values.title")}</h2>
        <ul className="mt-3 space-y-2 text-muted-foreground">
          <li>• {t("about.values.simple")}</li>
          <li>• {t("about.values.offline")}</li>
          <li>• {t("about.values.local")}</li>
          <li>• {t("about.values.trust")}</li>
        </ul>
      </article>
    </MarketingLayout>
  );
}
