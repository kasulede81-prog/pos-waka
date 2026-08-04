import { useMemo } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { shelfIconFor } from "../../lib/productCategories";
import { statusTokens } from "../../lib/statusTokens";
import { EnterpriseDataTable, type EnterpriseDataColumn } from "../enterprise/data-table";
export type ShelfFolderRow = {
  key: string;
  label: string;
  count: number;
};

type Props = {
  lang: Language;
  shelves: ShelfFolderRow[];
  onSelectShelf: (key: string) => void;
};

/** Phase 31.1 — desktop table-first shelf management. */
export function ShelvesDesktopTable({ lang, shelves, onSelectShelf }: Props) {
  const columns: EnterpriseDataColumn<ShelfFolderRow>[] = useMemo(
    () => [
      {
        id: "shelf",
        header: t(lang, "stockTabShelves"),
        width: "minmax(180px,2.5fr)",
        cell: (shelf) => {
          const icon = shelfIconFor(shelf.label) ?? "📦";
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-lg leading-none">
                {icon}
              </span>
              <span className="truncate font-bold text-foreground">{shelf.label}</span>
            </div>
          );
        },
      },
      {
        id: "count",
        header: t(lang, "inventoryTableStock"),
        width: "minmax(96px,1fr)",
        align: "right",
        cell: (shelf) =>
          shelf.count === 0 ? (
            <span className={statusTokens.danger.badge}>{t(lang, "shelfEmptyRestockLabel")}</span>
          ) : (
            <span className="font-bold tabular-nums text-foreground">
              {tTemplate(lang, "stockShelfProductCount", { count: String(shelf.count) })}
            </span>
          ),
      },
    ],
    [lang],
  );

  return (
    <EnterpriseDataTable
      rows={shelves}
      columns={columns}
      rowKey={(s) => s.key}
      minWidthPx={560}
      estimateRowHeight={52}
      ariaLabel={t(lang, "stockTabShelves")}
      onRowActivate={(shelf) => onSelectShelf(shelf.key)}
    />
  );
}
