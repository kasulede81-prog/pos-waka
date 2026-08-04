import { useCallback, useMemo, useState } from "react";
import type { EnterpriseDataSelectionApi } from "./types";
import { mergeToggleAll, toggleIdInSet } from "./selectionHelpers";

/**
 * Desktop bulk selection state — presentation only (Phase 30.1).
 * Callers gate destructive actions with existing permissions.
 */
export function useEnterpriseTableSelection(options?: { startEnabled?: boolean }): EnterpriseDataSelectionApi & {
  selectionMode: boolean;
  setSelectionMode: (on: boolean) => void;
  count: number;
} {
  const [selectionMode, setSelectionMode] = useState(Boolean(options?.startEnabled));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const setSelected = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => toggleIdInSet(prev, id, selected));
  }, []);

  const selectIds = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const toggleAll = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds((prev) => mergeToggleAll(prev, ids, selected));
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return useMemo(
    () => ({
      enabled: selectionMode,
      selectedIds,
      isSelected,
      setSelected,
      selectIds,
      clear,
      toggleAll,
      selectionMode,
      setSelectionMode,
      count: selectedIds.size,
    }),
    [selectionMode, selectedIds, isSelected, setSelected, selectIds, clear, toggleAll],
  );
}
