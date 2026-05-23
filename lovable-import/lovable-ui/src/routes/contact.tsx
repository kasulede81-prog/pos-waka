import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageCircle, MapPin, Clock } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/contact")({
  head: () =>
    seoHead({
      title: "Contact — Waka Technologies",
      description: "Reach Waka Technologies by WhatsApp, email or visit our Kampala office.",
      path: "/contact",
    }),
  component: ContactPage,
});

function ContactPage() {
  const { t } = useI18n();
  const items = [
    { icon: MessageCircle, label: t("contact.whatsapp"), value: "+256 700 000 000" },
    { icon: Mail, label: t("contact.email"), value: "hello@waka.ug" },
    { icon: MapPin, label: t("contact.office"), value: t("contact.office.value") },
    { icon: Clock, label: t("contact.hours"), value: t("contact.hours.value") },
  ];
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-black tracking-tight">{t("contact.title")}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t("contact.intro")}</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {items.map((i) => {
            const Icon = i.icon;
            return (
              <div key={i.label} className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="mt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {i.label}
                </p>
                <p className="mt-1 text-base font-bold text-foreground">{i.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    </MarketingLayout>
  );
}
