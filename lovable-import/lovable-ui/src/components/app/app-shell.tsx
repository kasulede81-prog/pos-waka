import { Link, Outlet, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Home, ShoppingCart, Receipt, Briefcase, LogOut, ShieldCheck, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { LangToggle } from "@/components/lang-toggle";
import { WakaLogo } from "@/components/waka-logo";
import { useProfile } from "@/lib/use-profile";
import { useWakaInternalMe } from "@/lib/waka-admin";
import { usePWAInstall } from "@/lib/use-pwa";
import { StaffSwitcher } from "@/components/staff-switcher";
import { OnboardingTour } from "@/components/onboarding-tour";
import { useKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { SupportFAB } from "@/components/support-fab";

export function AppShell({ children }: { children?: ReactNode }) {
  const { signOut } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const { isAdmin } = useProfile();
  const { isAdmin: isInternalAdmin } = useWakaInternalMe();
  const { canInstall, promptInstall } = usePWAInstall();
  useKeyboardShortcuts();

  const handleSignOut = async () => {
    await signOut();
    router.navigate({ to: "/" });
  };

  const tabs = [
    { to: "/dashboard", label: t("app.home"), icon: Home },
    { to: "/sell", label: t("app.sell"), icon: ShoppingCart },
    { to: "/receipts", label: t("app.sales_history"), icon: Receipt },
    { to: "/office", label: t("app.back_office"), icon: Briefcase },
  ] as const;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <WakaLogo size="sm" />
          <div className="flex items-center gap-2">
            <StaffSwitcher />
            <LangToggle />
            {canInstall && (
              <button
                onClick={promptInstall}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-waka-100 px-3 py-1.5 text-xs font-bold text-waka-700 hover:bg-waka-200"
              >
                <Download className="h-3.5 w-3.5" /> Install
              </button>
            )}
            {isInternalAdmin && (
              <Link to="/internal/waka" className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-3 py-1.5 text-xs font-bold text-white">
                <ShieldCheck className="h-3.5 w-3.5" /> Waka admin
              </Link>
            )}
            {isAdmin && !isInternalAdmin && (
              <Link
                to="/admin"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-bold text-background"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Admin
              </Link>
            )}
            <button
              onClick={handleSignOut}
              aria-label={t("auth.signout")}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <OnboardingTour />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6">
        {children ?? <Outlet />}
      </main>

      <SupportFAB />

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-2 px-3 py-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className="group flex flex-col items-center gap-1 py-1 text-[11px] font-bold text-foreground/80"
                activeProps={{ className: "text-waka-700" }}
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`grid h-12 w-16 place-items-center rounded-2xl border-2 transition ${
                        isActive
                          ? "border-waka-600 bg-waka-600 text-primary-foreground"
                          : "border-transparent bg-transparent text-foreground"
                      }`}
                    >
                      <Icon className="h-6 w-6" strokeWidth={2.2} />
                    </span>
                    <span>{tab.label}</span>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
