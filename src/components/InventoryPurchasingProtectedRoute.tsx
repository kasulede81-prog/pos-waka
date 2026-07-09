import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { ReactNode } from "react";
import { useSessionActor } from "../context/SessionActorContext";

export function InventoryPurchasingProtectedRoute({ children }: { children: ReactNode }) {
  const actor = useSessionActor();
  const allowed =
    actorHasPermission(actor, "stock.view") ||
    actorHasPermission(actor, "purchases.view") ||
    actorHasPermission(actor, "purchases.record") ||
    actorHasPermission(actor, "suppliers.view");

  if (!allowed) return <Navigate to="/" replace />;
  return children;
}
