import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
};

export function OfficeNavSection({ title, children }: Props) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-xs font-black uppercase tracking-wider text-stone-500">{title}</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
