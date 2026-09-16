import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

/** Shared layout pieces for the merchant "Notifications & Support" center. */

export function SupportSectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/90 bg-card p-4 shadow-waka-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-black uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function SupportEmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/50 px-4 py-8 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <p className="max-w-sm text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  );
}

export function SupportLoadingBlock({ lang }: { lang: Language }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="sr-only">{t(lang, "supportCenterLoading")}</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/80" />
      ))}
    </div>
  );
}

export function SupportErrorBlock({
  lang,
  onRetry,
}: {
  lang: Language;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-rose-700">{t(lang, "supportCenterLoadError")}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white active:scale-[0.99]"
        >
          {t(lang, "supportCenterRetry")}
        </button>
      ) : null}
    </div>
  );
}

export function formatSupportDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
