import { Navigate } from "react-router-dom";
import type { Language } from "../types";

/** Legacy route — subscription engineering details live in internal admin only. */
export function SettingsSubscriptionDiagnosticsPage(_props: { lang: Language }) {
  return <Navigate to="/settings/health" replace />;
}
