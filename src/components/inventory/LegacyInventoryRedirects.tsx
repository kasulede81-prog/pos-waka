import { Navigate, useParams } from "react-router-dom";

export function LegacySupplierDetailRedirect() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const q = supplierId ? `?tab=suppliers&supplierId=${encodeURIComponent(supplierId)}` : "?tab=suppliers";
  return <Navigate to={`/stock${q}`} replace />;
}

export function LegacyPurchaseDetailRedirect() {
  const { purchaseId } = useParams<{ purchaseId: string }>();
  const q = purchaseId ? `?tab=purchases&purchaseId=${encodeURIComponent(purchaseId)}` : "?tab=purchases";
  return <Navigate to={`/stock${q}`} replace />;
}
