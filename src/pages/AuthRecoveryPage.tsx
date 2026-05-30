import { Navigate, useLocation } from "react-router-dom";

/** Legacy Supabase recovery URL — forwards query/hash to branded `/reset-password`. */
export function AuthRecoveryPage() {
  const { search, hash } = useLocation();
  return <Navigate to={`/reset-password${search}${hash}`} replace />;
}
