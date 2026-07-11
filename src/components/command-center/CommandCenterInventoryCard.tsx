import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerInventoryExtended } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  inventory: OwnerInventoryExtended;
};

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={clsx("rounded-2xl px-2.5 py-2", warn ? "bg-rose-50" : "bg-muted")}>
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={clsx("mt-0.5 text-sm font-black tabular-nums", warn ? "text-rose-800" : "text-foreground")}>{value}</p>
    </div>
  );
}

export function CommandCenterInventoryCard({ lang, inventory }: Props) {
  const accuracyPct =
    inventory.countVarianceCount === 0 && inventory.negativeStock.length === 0
      ? 99
      : Math.max(0, 100 - inventory.countVarianceCount * 5 - inventory.negativeStock.length * 3);

  return (
    <section className="rounded-3xl border border-border/90 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cmdCenterInventoryTitle")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "ownerInventoryRiskTitle")}</p>
        </div>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
          {accuracyPct}% {t(lang, "cmdCenterAccuracy")}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label={t(lang, "ownerInventoryValue")} value={formatShortUgx(inventory.inventoryValueUgx)} />
        <Metric label={t(lang, "ownerInventoryNegative")} value={String(inventory.negativeStock.length)} warn={inventory.negativeStock.length > 0} />
        <Metric label={t(lang, "ownerInventoryLow")} value={String(inventory.lowStockCount)} warn={inventory.lowStockCount > 0} />
        <Metric label={t(lang, "ownerInventoryOos")} value={String(inventory.outOfStockCount)} warn={inventory.outOfStockCount > 0} />
        <Metric label={t(lang, "ownerInventoryCountPending")} value={String(inventory.pendingCountSessions.length)} />
        <Metric label={t(lang, "cmdCenterDeadStock")} value={String(inventory.slowMovers.length)} />
      </div>

      {inventory.fastMovers.length > 0 ? (
        <p className="mt-3 text-[11px] font-semibold text-muted-foreground">
          {t(lang, "ownerInventoryFastMovers")}: {inventory.fastMovers.slice(0, 2).map((m) => m.name).join(", ")}
        </p>
      ) : null}

      <Link
        to="/stock"
        className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-2xl border-2 border-border px-4 text-sm font-black text-foreground"
      >
        {t(lang, "cmdCenterOpenInventory")} →
      </Link>
    </section>
  );
}
