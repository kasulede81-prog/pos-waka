import { useEffect, useState } from "react";
import { EnterpriseUpdateEngine, type UpdateEngineState } from "./EnterpriseUpdateEngine";

export function useUpdateEngine(): UpdateEngineState {
  const [state, setState] = useState<UpdateEngineState>(() => EnterpriseUpdateEngine.getState());

  useEffect(() => {
    return EnterpriseUpdateEngine.subscribe(setState);
  }, []);

  return state;
}

export function useUpdateEngineInit(): void {
  useEffect(() => EnterpriseUpdateEngine.initialize(), []);
}
