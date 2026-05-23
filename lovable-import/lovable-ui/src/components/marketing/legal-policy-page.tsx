import type { ReactNode } from "react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";

export function LegalPolicyPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-black tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t("legal.intro")}</p>
        <div className="prose prose-stone mt-8 max-w-none text-foreground/90 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-black [&_p]:mt-3 [&_p]:text-muted-foreground">
          {children}
        </div>
      </article>
    </MarketingLayout>
  );
}
