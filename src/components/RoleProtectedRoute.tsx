import { Navigate, useLocation } from "react-router-dom";
import type { Permission } from "../types";
import { hasPermission } from "../lib/permissions";
import { useSessionActor } from "../context/SessionActorContext";

type Props = {
  permission: Permission;
  children: React.ReactNode;
};

export function RoleProtectedRoute({ permission, children }: Props) {
  const actor = useSessionActor();
  const location = useLocation();
  if (!hasPermission(actor.role, permission)) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
