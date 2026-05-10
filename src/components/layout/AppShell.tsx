import { Link, Outlet, useLocation } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";

type Props = {
  lang: Language;
  setLang: (lang: Language) => void;
  onSignOut: () => Promise<void>;
};

const navKeys = ["dashboard", "inventory", "pos", "customers", "receipts", "settings"] as const;

export function AppShell({ lang, setLang, onSignOut }: Props) {
  const location = useLocation();
  const { isOnline } = useOfflineStatus();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">{t(lang, "appName")}</h1>
            <p className="text-xs text-slate-500">{isOnline ? "Online" : "Offline mode"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === "en" ? "lg" : "en")}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {lang === "en" ? "Luganda" : "English"}
            </button>
            <button onClick={onSignOut} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
              {t(lang, "signOut")}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl gap-4 px-3 py-4">
        <nav className="hidden w-56 shrink-0 rounded-xl border bg-white p-3 md:block">
          <ul className="space-y-1">
            {navKeys.map((key) => {
              const path = key === "dashboard" ? "/" : `/${key}`;
              const active = location.pathname === path;
              return (
                <li key={key}>
                  <Link
                    to={path}
                    className={`block rounded-lg px-3 py-2 text-sm ${
                      active ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                    }`}
                  >
                    {t(lang, key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <section className="w-full">
          <Outlet />
        </section>
      </main>
      <nav className="fixed bottom-0 left-0 right-0 border-t bg-white md:hidden">
        <div className="grid grid-cols-5 gap-1 px-2 py-2 text-xs">
          {["dashboard", "inventory", "pos", "customers", "settings"].map((key) => {
            const path = key === "dashboard" ? "/" : `/${key}`;
            const active = location.pathname === path;
            return (
              <Link key={key} to={path} className={`rounded-md px-2 py-2 text-center ${active ? "bg-slate-900 text-white" : ""}`}>
                {t(lang, key)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
