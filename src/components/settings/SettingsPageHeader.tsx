import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
};

export function SettingsPageHeader({ lang, title, subtitle, backTo = "/settings", backLabel }: Props) {
  return (
    <header className="space-y-3">
      <Link to={backTo} className="inline-flex min-h-[40px] items-center text-sm font-bold text-waka-800">
        ← {backLabel ?? t(lang, "settingsHubBack")}
      </Link>
      <div>
        <h1 className="text-2xl font-black text-stone-950">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm font-medium text-stone-500">{subtitle}</p> : null}
      </div>
    </header>
  );
}
