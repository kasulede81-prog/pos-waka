import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  accent?: "brand" | "neutral";
};

export function WizardInfoCard({ children, accent }: Props) {
  return (
    <div
      className={clsx(
        "rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm",
        accent === "brand"
          ? "border-primary/20 bg-primary/5 text-foreground dark:border-primary/30 dark:bg-primary/10"
          : "border-border/70 bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}
