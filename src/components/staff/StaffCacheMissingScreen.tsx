import { WifiOff } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
};

/** Shown when a secondary device has no staff cache and is offline. */
export function StaffCacheMissingScreen({ lang }: Props) {
  return (
    <div
      className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-center dark:border-amber-900/60 dark:bg-amber-950/30"
      role="alert"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        <WifiOff className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-black text-foreground dark:text-background">
        {t(lang, "staffCacheMissingTitle")}
      </h2>
      <p className="mt-2 text-sm font-medium text-muted-foreground dark:text-muted-foreground">
        {t(lang, "staffCacheMissingBody")}
      </p>
    </div>
  );
}
