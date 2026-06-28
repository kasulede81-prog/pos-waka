import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BusinessSceneState } from "../lib/businessBuilder/businessSceneState";
import {
  INITIAL_BUSINESS_SCENE,
  mergeSceneState,
} from "../lib/businessBuilder/businessSceneState";
import {
  loadBusinessSceneState,
  saveBusinessSceneState,
} from "../lib/businessBuilder/businessBuilderStorage";

type BusinessBuilderContextValue = {
  scene: BusinessSceneState;
  patchScene: (patch: Partial<BusinessSceneState>) => void;
  replaceScene: (next: BusinessSceneState) => void;
};

const BusinessBuilderContext = createContext<BusinessBuilderContextValue | null>(null);

export function BusinessBuilderProvider({ children }: { children: ReactNode }) {
  const [scene, setScene] = useState<BusinessSceneState>(() => loadBusinessSceneState());

  const patchScene = useCallback((patch: Partial<BusinessSceneState>) => {
    setScene((prev) => {
      const next = mergeSceneState(prev, patch);
      saveBusinessSceneState(next);
      return next;
    });
  }, []);

  const replaceScene = useCallback((next: BusinessSceneState) => {
    const merged = mergeSceneState(INITIAL_BUSINESS_SCENE, next);
    saveBusinessSceneState(merged);
    setScene(merged);
  }, []);

  const value = useMemo(
    () => ({ scene, patchScene, replaceScene }),
    [scene, patchScene, replaceScene],
  );

  return (
    <BusinessBuilderContext.Provider value={value}>{children}</BusinessBuilderContext.Provider>
  );
}

export function useBusinessBuilder(): BusinessBuilderContextValue {
  const ctx = useContext(BusinessBuilderContext);
  if (!ctx) {
    throw new Error("useBusinessBuilder requires BusinessBuilderProvider");
  }
  return ctx;
}

/** Safe when provider may be absent (e.g. tests). */
export function useBusinessBuilderOptional(): BusinessBuilderContextValue | null {
  return useContext(BusinessBuilderContext);
}
