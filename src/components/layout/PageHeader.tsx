import type { ReactNode } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { PageBackBar } from "./PageBackBar";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backFallback?: string;
  backLabel?: string;
  showBack?: boolean;
  /** Denser title row for back office hub screens. */
  compact?: boolean;
  children?: ReactNode;
};

export function PageHeader({
  lang,
  title,
  subtitle,
  backFallback,
  backLabel,
  showBack = true,
  compact = false,
  children,
}: Props) {
  return (
    <header className={compact ? "space-y-2" : "space-y-3"}>
      {showBack ? <PageBackBar lang={lang} fallbackTo={backFallback} label={backLabel} /> : null}
      <div>
        <h1
          className={
            compact
              ? "text-xl font-black tracking-tight text-stone-950 sm:text-2xl"
              : "text-2xl font-black tracking-tight text-stone-950 sm:text-3xl"
          }
        >
          {title}
        </h1>
        {subtitle ? (
          <p className={clsx("mt-0.5 font-medium text-stone-500", compact ? "text-xs" : "mt-1 text-sm")}>{subtitle}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}
