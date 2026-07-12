import { useEffect, useState } from "react";
import {
  getSessionConnectionState,
  subscribeSessionConnectionState,
  type SessionConnectionState,
} from "../lib/sessionConnectionState";

export function useSessionConnectionState(): SessionConnectionState {
  const [state, setState] = useState<SessionConnectionState>(() => getSessionConnectionState());

  useEffect(() => subscribeSessionConnectionState(setState), []);

  return state;
}
