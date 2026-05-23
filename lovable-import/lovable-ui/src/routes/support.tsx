import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle, Mail } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/support")({
  head: () =>
    seoHead({
      title: "Support — Waka POS",
      description: "Get help with Waka POS via WhatsApp or email.",
      path: "/support",
    }),
  component: SupportPage,
});

function SupportPage() {
  const { t } = useI18n();
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-4xl font-black tracking-tight">{t("support.title")}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t("support.body")}</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <a
            href="https://wa.me/256700000000"
            className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40"
          >
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold">{t("contact.whatsapp")}</p>
              <p className="text-xs text-muted-foreground">+256 700 000 000</p>
            </div>
          </a>
          <a
            href="mailto:hello@waka.ug"
            className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-5 transition hover:border-primary/40"
          >
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold">{t("contact.email")}</p>
              <p className="text-xs text-muted-foreground">hello@waka.ug</p>
            </div>
          </a>
        </div>
      </div>
    </MarketingLayout>
  );
}
