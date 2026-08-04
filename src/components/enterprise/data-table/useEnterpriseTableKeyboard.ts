import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";

type Options<T> = {
  rows: T[];
  rowKey: (row: T) => string;
  focusedIndex: number;
  onFocusedIndexChange: (index: number) => void;
  onRowActivate?: (row: T) => void;
  selection?: {
    enabled: boolean;
    setSelected: (id: string, selected: boolean) => void;
    isSelected: (id: string) => boolean;
    selectIds: (ids: string[]) => void;
    clear: () => void;
  };
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true'], input, textarea, select"));
}

/**
 * Desktop table keyboard productivity — skips when focus is in text inputs.
 * ↑/↓ navigate · Space select · Ctrl/Cmd+A select visible · Enter open · Esc clear
 */
export function useEnterpriseTableKeyboard<T>({
  rows,
  rowKey,
  focusedIndex,
  onFocusedIndexChange,
  onRowActivate,
  selection,
}: Options<T>) {
  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isEditableTarget(event.target)) return;
      if (rows.length === 0) return;

      const key = event.key;
      const meta = event.metaKey || event.ctrlKey;

      if (key === "ArrowDown") {
        event.preventDefault();
        onFocusedIndexChange(Math.min(rows.length - 1, focusedIndex < 0 ? 0 : focusedIndex + 1));
        return;
      }
      if (key === "ArrowUp") {
        event.preventDefault();
        onFocusedIndexChange(Math.max(0, focusedIndex < 0 ? 0 : focusedIndex - 1));
        return;
      }
      if (key === "Home") {
        event.preventDefault();
        onFocusedIndexChange(0);
        return;
      }
      if (key === "End") {
        event.preventDefault();
        onFocusedIndexChange(rows.length - 1);
        return;
      }
      if (key === "Enter") {
        const row = rows[focusedIndex];
        if (!row || !onRowActivate) return;
        event.preventDefault();
        onRowActivate(row);
        return;
      }
      if (key === "Escape" && selection?.enabled) {
        event.preventDefault();
        selection.clear();
        return;
      }
      if (key === " " || key === "Spacebar") {
        const row = rows[focusedIndex];
        if (!row || !selection?.enabled) return;
        event.preventDefault();
        const id = rowKey(row);
        selection.setSelected(id, !selection.isSelected(id));
        return;
      }
      if (meta && (key === "a" || key === "A") && selection?.enabled) {
        event.preventDefault();
        selection.selectIds(rows.map(rowKey));
      }
    },
    [rows, rowKey, focusedIndex, onFocusedIndexChange, onRowActivate, selection],
  );
}
