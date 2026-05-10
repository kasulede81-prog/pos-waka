import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  children: ReactNode;
};

export function AuthLayout({ lang, setLang, children }: Props) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
        <header className="flex items-center justify-between">
          <Link to="/login" className="text-xl font-bold text-slate-900">
            {t(lang, "appName")}
          </Link>
          <button
            type="button"
            onClick={() => setLang(lang === "en" ? "lg" : "en")}
            className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm"
          >
            {lang === "en" ? "Luganda" : "English"}
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
