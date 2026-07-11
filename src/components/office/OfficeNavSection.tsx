import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { OFFICE_NAV_TILE_GRID } from "./BackOfficePageLayout";

type Props = {
  title: string;
  children: ReactNode;
  /** Multi-column grid on desktop terminal (lg+). */
  desktopGrid?: boolean;
  /** Collapsible on mobile; always expanded on lg+. */
  collapsible?: boolean;
};

export function OfficeNavSection({ title, children, desktopGrid = true, collapsible = true }: Props) {
  const listClass = desktopGrid ? OFFICE_NAV_TILE_GRID : "grid grid-cols-1 gap-2";

  if (!collapsible) {
    return (
      <section className="space-y-2">
        <h2 className="px-0.5 text-xs font-black uppercase tracking-wider text-muted-foreground">{title}</h2>
        <ul className={listClass}>{children}</ul>
      </section>
    );
  }

  return (
    <details open className="group space-y-2 rounded-2xl border border-border bg-white/60 p-3 lg:border-0 lg:bg-transparent lg:p-0">
      <summary
        className={clsx(
          "flex cursor-pointer list-none items-center justify-between gap-2 px-0.5 marker:content-none [&::-webkit-details-marker]:hidden",
          "lg:pointer-events-none lg:cursor-default",
        )}
      >
        <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">{title}</h2>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 lg:hidden"
          aria-hidden
        />
      </summary>
      <ul className={listClass}>{children}</ul>
    </details>
  );
}
