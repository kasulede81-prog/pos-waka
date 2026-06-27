import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

export function InventoryPurchasingProtectedRoute({ children }: { children: ReactNode }) {
  const actor = useSessionActor();
  const allowed =
    hasPermission(actor.role, "stock.view") ||
    hasPermission(actor.role, "purchases.view") ||
    hasPermission(actor.role, "purchases.record") ||
    hasPermission(actor.role, "suppliers.view");

  if (!allowed) return <Navigate to="/" replace />;
  return children;
}
