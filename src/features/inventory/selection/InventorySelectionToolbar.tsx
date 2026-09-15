import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WakaCheckbox } from "../../../components/enterprise/WakaCheckbox";
import { useInventorySelection } from "./useInventorySelection";

type Props = {
  lang: Language;
  /** Currently visible product IDs (virtual page). */
  visibleIds: readonly string[];
  /** Full filtered result IDs. */
  filteredIds: readonly string[];
  className?: string;
};

export function InventorySelectionToolbar({ lang, visibleIds, filteredIds, className }: Props) {
  const { selectionMode, count, selectPage, selectFiltered, clear, exit } = useInventorySelection();

  if (!selectionMode && count === 0) return null;

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 px-3 py-2",
        className,
      )}
      role="toolbar"
      aria-label={t(lang, "inventorySelectionToolbarLabel")}
    >
      <span className="text-xs font-black text-indigo-950">
        {count > 0
          ? t(lang, "inventorySelectionCount").replace("{count}", String(count))
          : t(lang, "inventorySelectionMode")}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {visibleIds.length > 0 ? (
          <button
            type="button"
            onClick={() => selectPage(visibleIds)}
            className="min-h-[32px] rounded-lg border border-indigo-200 bg-card px-2.5 text-[10px] font-black text-indigo-900"
          >
            {t(lang, "inventorySelectPage")}
          </button>
        ) : null}
        {filteredIds.length > 0 ? (
          <button
            type="button"
            onClick={() => selectFiltered(filteredIds)}
            className="min-h-[32px] rounded-lg border border-indigo-200 bg-card px-2.5 text-[10px] font-black text-indigo-900"
          >
            {t(lang, "inventorySelectFiltered")}
          </button>
        ) : null}
        {count > 0 ? (
          <button
            type="button"
            onClick={clear}
            className="min-h-[32px] rounded-lg border border-border bg-card px-2.5 text-[10px] font-black text-muted-foreground"
          >
            {t(lang, "inventoryClearSelection")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={exit}
          className="min-h-[32px] rounded-lg border border-border bg-card px-2.5 text-[10px] font-black text-muted-foreground"
        >
          {t(lang, "inventoryExitSelection")}
        </button>
      </div>
    </div>
  );
}

export function InventorySelectAllCheckbox({
  lang,
  filteredIds,
}: {
  lang: Language;
  filteredIds: readonly string[];
}) {
  const { selectionMode, enter, selectFiltered, clear, state } = useInventorySelection();
  const allOn = filteredIds.length > 0 && filteredIds.every((id) => state.selectedIds.has(id));
  const someOn = filteredIds.some((id) => state.selectedIds.has(id));

  if (!selectionMode) return null;

  return (
    <WakaCheckbox
      row={false}
      checked={allOn}
      aria-label={t(lang, "inventorySelectAllFiltered")}
      onCheckedChange={(checked) => {
        if (!selectionMode) enter();
        if (checked) selectFiltered(filteredIds);
        else clear();
      }}
      className={clsx(someOn && !allOn && "opacity-80")}
    />
  );
}
