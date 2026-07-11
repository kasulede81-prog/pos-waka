/** Pure selection state helpers — virtualization-safe (IDs only, no row refs). */

export type InventorySelectionState = {
  selectedIds: Set<string>;
  /** When true, UI shows checkboxes and bulk toolbar. */
  selectionMode: boolean;
  /** Tracks whether "select filtered" is active (all filtered IDs selected). */
  allFilteredSelected: boolean;
};

export function createEmptySelection(): InventorySelectionState {
  return { selectedIds: new Set(), selectionMode: false, allFilteredSelected: false };
}

export function toggleSelectionId(state: InventorySelectionState, id: string): InventorySelectionState {
  const next = new Set(state.selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...state, selectedIds: next, allFilteredSelected: false };
}

export function setSelectionId(state: InventorySelectionState, id: string, selected: boolean): InventorySelectionState {
  const next = new Set(state.selectedIds);
  if (selected) next.add(id);
  else next.delete(id);
  return { ...state, selectedIds: next, allFilteredSelected: false };
}

export function selectIds(state: InventorySelectionState, ids: readonly string[]): InventorySelectionState {
  const next = new Set(state.selectedIds);
  for (const id of ids) next.add(id);
  return { ...state, selectedIds: next };
}

export function selectFilteredResults(
  state: InventorySelectionState,
  filteredIds: readonly string[],
): InventorySelectionState {
  return {
    ...state,
    selectedIds: new Set(filteredIds),
    allFilteredSelected: true,
    selectionMode: true,
  };
}

export function selectPage(state: InventorySelectionState, pageIds: readonly string[]): InventorySelectionState {
  return selectIds({ ...state, selectionMode: true }, pageIds);
}

export function clearSelection(state: InventorySelectionState): InventorySelectionState {
  return { selectedIds: new Set(), selectionMode: state.selectionMode, allFilteredSelected: false };
}

export function exitSelectionMode(): InventorySelectionState {
  return createEmptySelection();
}

export function enterSelectionMode(state: InventorySelectionState): InventorySelectionState {
  return { ...state, selectionMode: true };
}

export function selectionCount(state: InventorySelectionState): number {
  return state.selectedIds.size;
}

export function isSelected(state: InventorySelectionState, id: string): boolean {
  return state.selectedIds.has(id);
}

export function areAllSelected(state: InventorySelectionState, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => state.selectedIds.has(id));
}

export function areSomeSelected(state: InventorySelectionState, ids: readonly string[]): boolean {
  return ids.some((id) => state.selectedIds.has(id));
}
