import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { useAppTheme } from "../context/AppThemeProvider";
import type { AppThemePreference } from "../lib/appTheme";

const OPTIONS: { id: AppThemePreference; Icon: typeof Sun; labelKey: string; subKey: string }[] = [
  { id: "light", Icon: Sun, labelKey: "themeMode_light", subKey: "settingsAppearanceLightSub" },
  { id: "dark", Icon: Moon, labelKey: "themeMode_dark", subKey: "settingsAppearanceDarkSub" },
  { id: "system", Icon: Monitor, labelKey: "themeMode_system", subKey: "settingsAppearanceSystemSub" },
];

export function SettingsAppearancePage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { preference, resolved, setPreference } = useAppTheme();

  if (!actorHasPermission(actor, "settings.view")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubAppearance")}
        subtitle={t(lang, "settingsHubAppearanceSub")}
      />

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:bg-foreground">
        <p className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">{t(lang, "settingsAppearanceCurrent")}</p>
        <p className="mt-1 text-lg font-black text-foreground dark:text-background">
          {t(lang, `themeMode_${preference}`)}
          {preference === "system" ? (
            <span className="ml-2 text-sm font-semibold text-muted-foreground dark:text-muted-foreground">
              ({t(lang, resolved === "dark" ? "themeMode_dark" : "themeMode_light")})
            </span>
          ) : null}
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {OPTIONS.map(({ id, Icon, labelKey, subKey }) => {
            const selected = preference === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPreference(id)}
                className={clsx(
                  "flex min-h-[88px] flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors",
                  selected
                    ? "border-waka-500 bg-waka-50 ring-2 ring-waka-200 dark:border-waka-500 dark:bg-waka-950/40 dark:ring-waka-800"
                    : "border-border bg-muted hover:border-border dark:bg-foreground/60 dark:hover:border-stone-600",
                )}
              >
                <Icon
                  className={clsx(
                    "h-5 w-5",
                    selected ? "text-waka-700 dark:text-waka-400" : "text-muted-foreground dark:text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="text-base font-black text-foreground dark:text-background">{t(lang, labelKey)}</span>
                <span className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">{t(lang, subKey)}</span>
              </button>
            );
          })}
        </div>
      </article>
    </div>
  );
}
