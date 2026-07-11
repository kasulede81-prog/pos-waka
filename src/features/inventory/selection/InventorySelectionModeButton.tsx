import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { useInventorySelection } from "./useInventorySelection";

export function InventorySelectionModeButton({ lang }: { lang: Language }) {
  const { selectionMode, enter, exit, count } = useInventorySelection();

  if (selectionMode) {
    return (
      <button
        type="button"
        onClick={exit}
        className="min-h-[36px] rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-black text-indigo-900"
      >
        {count > 0
          ? t(lang, "inventorySelectionCount").replace("{count}", String(count))
          : t(lang, "inventoryExitSelection")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={enter}
      className="min-h-[36px] rounded-xl border border-border bg-card px-3 text-xs font-black text-muted-foreground"
    >
      {t(lang, "inventoryEnterSelection")}
    </button>
  );
}
