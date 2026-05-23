import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { WakaLogo } from "@/components/waka-logo";
import { LangToggle } from "@/components/lang-toggle";
import { useI18n } from "@/lib/i18n";

export function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-waka-50 via-background to-background">
      <header className="flex items-center justify-between p-4">
        <Link to="/">
          <WakaLogo size="sm" />
        </Link>
        <LangToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-xl shadow-primary/5 sm:p-8">
            <h1 className="text-2xl font-black tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-primary">{t("legal.terms")}</Link>
            <span className="mx-2">·</span>
            <Link to="/privacy" className="hover:text-primary">{t("legal.privacy")}</Link>
          </p>
        </div>
      </main>
      <footer className="p-4 text-center text-xs text-muted-foreground">
        <p>{t("brand.slogan")}</p>
        <p className="mt-1">
          © {new Date().getFullYear()} {t("brand.legal")}
        </p>
      </footer>
    </div>
  );
}
