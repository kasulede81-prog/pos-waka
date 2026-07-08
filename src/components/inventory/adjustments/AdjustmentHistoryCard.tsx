import { useMemo } from "react";
import type { Language, StockMovement } from "../../../types";
import { t } from "../../../lib/i18n";
import { AdjustmentHeader } from "./AdjustmentHeader";

type Props = {
  lang: Language;
  movements: StockMovement[];
  productId: string;
  limit?: number;
};

export function AdjustmentHistoryCard({ lang, movements, productId, limit = 5 }: Props) {
  const recent = useMemo(
    () =>
      movements
        .filter((m) => m.productId === productId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    [movements, productId, limit],
  );

  if (recent.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/60 bg-muted/20 p-4">
      <AdjustmentHeader title={t(lang, "adjHistoryTitle")} />
      <ul className="mt-3 space-y-2">
        {recent.map((m) => (
          <li key={m.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-muted-foreground">
              {new Date(m.at).toLocaleDateString()} · {m.kind}
            </span>
            <span className="font-black tabular-nums text-foreground">
              {m.deltaBaseUnits >= 0 ? "+" : ""}
              {m.deltaBaseUnits}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
