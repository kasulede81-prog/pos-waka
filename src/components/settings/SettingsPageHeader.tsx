import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { getBackFallbackPath, historyCanGoBack } from "../../lib/navigationBack";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
};

export function SettingsPageHeader({ lang, title, subtitle, backTo, backLabel }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = useCallback(() => {
    const fallback = backTo ?? getBackFallbackPath(location.pathname);
    if (historyCanGoBack()) navigate(-1);
    else navigate(fallback);
  }, [navigate, location.pathname, backTo]);

  return (
    <header className="space-y-3">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold text-waka-800 active:opacity-70"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        {backLabel ?? t(lang, "settingsHubBack")}
      </button>
      <div>
        <h1 className="text-2xl font-black text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm font-medium text-muted-foreground">{subtitle}</p> : null}
      </div>
    </header>
  );
}
