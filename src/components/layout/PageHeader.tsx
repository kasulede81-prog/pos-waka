import type { ReactNode } from "react";
import type { Language } from "../../types";
import { PageBackBar } from "./PageBackBar";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backFallback?: string;
  backLabel?: string;
  showBack?: boolean;
  children?: ReactNode;
};

export function PageHeader({
  lang,
  title,
  subtitle,
  backFallback,
  backLabel,
  showBack = true,
  children,
}: Props) {
  return (
    <header className="space-y-3">
      {showBack ? <PageBackBar lang={lang} fallbackTo={backFallback} label={backLabel} /> : null}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm font-medium text-stone-500">{subtitle}</p> : null}
      </div>
      {children}
    </header>
  );
}
