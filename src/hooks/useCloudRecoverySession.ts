import { useEffect, useState } from "react";
import {
  getCloudRecoverySession,
  subscribeCloudRecovery,
  type CloudRecoverySessionState,
} from "../lib/cloudRecoverySession";

export function useCloudRecoverySession(): CloudRecoverySessionState {
  const [session, setSession] = useState(getCloudRecoverySession);

  useEffect(() => subscribeCloudRecovery(() => setSession(getCloudRecoverySession())), []);

  return session;
}
