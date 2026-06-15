import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  /** Multi-column grid on desktop terminal (lg+). */
  desktopGrid?: boolean;
};

export function OfficeNavSection({ title, children, desktopGrid = true }: Props) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-xs font-black uppercase tracking-wider text-stone-500">{title}</h2>
      <ul
        className={
          desktopGrid
            ? "space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3"
            : "space-y-2"
        }
      >
        {children}
      </ul>
    </section>
  );
}
