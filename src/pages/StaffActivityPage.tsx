import { Navigate } from "react-router-dom";
import type { Language } from "../types";

/** Legacy route — unified Investigation Center staff tab. */
export function StaffActivityPage(_props: { lang: Language }) {
  return <Navigate to="/office/audit-center?tab=staff" replace />;
}
