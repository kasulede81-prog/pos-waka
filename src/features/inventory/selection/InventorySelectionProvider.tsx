import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  clearSelection,
  enterSelectionMode,
  exitSelectionMode,
  isSelected as engineIsSelected,
  selectFilteredResults,
  selectPage,
  selectionCount,
  setSelectionId,
  toggleSelectionId,
  type InventorySelectionState,
} from "./InventorySelectionEngine";

type SelectionAction =
  | { type: "toggle"; id: string }
  | { type: "set"; id: string; selected: boolean }
  | { type: "selectPage"; ids: string[] }
  | { type: "selectFiltered"; ids: string[] }
  | { type: "clear" }
  | { type: "enter" }
  | { type: "exit" };

function reducer(state: InventorySelectionState, action: SelectionAction): InventorySelectionState {
  switch (action.type) {
    case "toggle":
      return toggleSelectionId(state, action.id);
    case "set":
      return setSelectionId(state, action.id, action.selected);
    case "selectPage":
      return selectPage(state, action.ids);
    case "selectFiltered":
      return selectFilteredResults(state, action.ids);
    case "clear":
      return clearSelection(state);
    case "enter":
      return enterSelectionMode(state);
    case "exit":
      return exitSelectionMode();
    default:
      return state;
  }
}

type InventorySelectionContextValue = {
  state: InventorySelectionState;
  count: number;
  selectionMode: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setSelected: (id: string, selected: boolean) => void;
  selectPage: (ids: readonly string[]) => void;
  selectFiltered: (ids: readonly string[]) => void;
  clear: () => void;
  enter: () => void;
  exit: () => void;
  dispatch: Dispatch<SelectionAction>;
};

const InventorySelectionContext = createContext<InventorySelectionContextValue | null>(null);

export function InventorySelectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    selectedIds: new Set<string>(),
    selectionMode: false,
    allFilteredSelected: false,
  }));

  const toggle = useCallback((id: string) => dispatch({ type: "toggle", id }), []);
  const setSelected = useCallback(
    (id: string, selected: boolean) => dispatch({ type: "set", id, selected }),
    [],
  );
  const selectPageCb = useCallback(
    (ids: readonly string[]) => dispatch({ type: "selectPage", ids: [...ids] }),
    [],
  );
  const selectFilteredCb = useCallback(
    (ids: readonly string[]) => dispatch({ type: "selectFiltered", ids: [...ids] }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const enter = useCallback(() => dispatch({ type: "enter" }), []);
  const exit = useCallback(() => dispatch({ type: "exit" }), []);

  const value = useMemo<InventorySelectionContextValue>(
    () => ({
      state,
      count: selectionCount(state),
      selectionMode: state.selectionMode,
      isSelected: (id) => engineIsSelected(state, id),
      toggle,
      setSelected,
      selectPage: selectPageCb,
      selectFiltered: selectFilteredCb,
      clear,
      enter,
      exit,
      dispatch,
    }),
    [state, toggle, setSelected, selectPageCb, selectFilteredCb, clear, enter, exit],
  );

  return <InventorySelectionContext.Provider value={value}>{children}</InventorySelectionContext.Provider>;
}

export function useInventorySelectionContext(): InventorySelectionContextValue {
  const ctx = useContext(InventorySelectionContext);
  if (!ctx) {
    throw new Error("useInventorySelection requires InventorySelectionProvider");
  }
  return ctx;
}

export function useInventorySelectionOptional(): InventorySelectionContextValue | null {
  return useContext(InventorySelectionContext);
}
