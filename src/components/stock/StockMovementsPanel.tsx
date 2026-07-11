import type { Language, StockMovement } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  movements: StockMovement[];
  pharmacyMode?: boolean;
  wholesaleMode?: boolean;
  emptyLabelKey?: "noStockMovementsYet" | "noStockMovementsInPeriod";
};

function friendlyMovement(lang: Language, mv: StockMovement, pharmacyMode?: boolean, wholesaleMode?: boolean): string {
  const sign = mv.deltaBaseUnits >= 0 ? "+" : "";
  const qty = Math.abs(mv.deltaBaseUnits);
  const summary = mv.summary.toLowerCase();
  if (summary.includes("void")) return t(lang, "stockMoveVoid").replace("{detail}", `${sign}${qty} ${mv.productName}`);
  if (summary.includes("return")) return t(lang, "stockMoveReturn").replace("{detail}", `${sign}${qty} ${mv.productName}`);
  if (summary.includes("sale") || mv.kind === "sale_out") {
    const key = pharmacyMode ? "pharmacyStockMoveDispensed" : wholesaleMode ? "wholesaleStockMoveInvoiced" : "stockMoveSold";
    return t(lang, key).replace("{detail}", `${qty} ${mv.productName}`);
  }
  if (mv.kind === "purchase_in" || summary.includes("purchase")) {
    return t(lang, "stockMoveRestock").replace("{detail}", `${sign}${qty} ${mv.productName}`);
  }
  if (mv.kind === "inventory_count_variance" || summary.toLowerCase().includes("count #")) {
    return `${t(lang, "inventoryCountVariance")}: ${sign}${qty} ${mv.productName}`;
  }
  return `${sign}${qty} ${mv.productName}`;
}

export function StockMovementsPanel({ lang, movements, pharmacyMode, wholesaleMode, emptyLabelKey }: Props) {
  const recent = movements.slice(0, 40);

  if (!recent.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-muted px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
        {t(lang, emptyLabelKey ?? "noStockMovementsYet")}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {recent.map((mv) => (
        <li key={mv.id} className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <p className="text-base font-black text-foreground">{friendlyMovement(lang, mv, pharmacyMode, wholesaleMode)}</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {new Date(mv.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </li>
      ))}
    </ul>
  );
}
