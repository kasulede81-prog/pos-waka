import type { ReactNode } from "react";
import clsx from "clsx";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function EditorSection({ title, description, children, className }: Props) {
  return (
    <section
      className={clsx(
        "space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
