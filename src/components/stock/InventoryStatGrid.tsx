import clsx from "clsx";
import { AlertTriangle, Boxes, FolderOpen, Package } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";

type Props = {
  lang: Language;
  totalProducts: number;
  lowStockCount: number;
  shelfCount: number;
  inventoryValueUgx: number;
  onLowStockTap?: () => void;
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  warn,
  onClick,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "flex min-h-[76px] flex-col justify-between rounded-xl border bg-white p-2.5 text-left shadow-sm transition-all",
        warn ? "border-rose-200/90" : "border-stone-200/90",
        onClick && "active:scale-[0.98] active:shadow-md motion-reduce:active:scale-100",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            warn ? "bg-rose-50 text-rose-700" : "bg-stone-100 text-stone-600",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</span>
      </div>
      <div>
        <p className="text-lg font-black leading-tight text-stone-950">{value}</p>
        {hint ? <p className="mt-0.5 text-[10px] font-semibold text-stone-500">{hint}</p> : null}
      </div>
    </Tag>
  );
}

export function InventoryStatGrid({
  lang,
  totalProducts,
  lowStockCount,
  shelfCount,
  inventoryValueUgx,
  onLowStockTap,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
      <StatCard
        icon={Package}
        label={t(lang, "stockStatTotalProducts")}
        value={String(totalProducts)}
        hint={t(lang, "stockStatProductsHint")}
      />
      <StatCard
        icon={AlertTriangle}
        label={t(lang, "stockStatLow")}
        value={String(lowStockCount)}
        hint={t(lang, "stockStatLowHint")}
        warn={lowStockCount > 0}
        onClick={onLowStockTap}
      />
      <StatCard
        icon={FolderOpen}
        label={t(lang, "stockStatShelves")}
        value={String(shelfCount)}
        hint={t(lang, "stockStatShelvesHint")}
      />
      <StatCard
        icon={Boxes}
        label={t(lang, "stockStatValueShort")}
        value={formatUgx(inventoryValueUgx)}
        hint={t(lang, "stockStatValueHint")}
      />
    </div>
  );
}
