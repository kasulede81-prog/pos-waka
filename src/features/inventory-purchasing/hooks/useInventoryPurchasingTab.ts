import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { inventoryPurchasingTabFromSearch } from "../../../lib/pharmacyReceiveDeepLink";
import type { InventoryPurchasingTab } from "../types";

export function useInventoryPurchasingTab() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = useMemo(
    () =>
      inventoryPurchasingTabFromSearch({
        tab: searchParams.get("tab"),
        receive: searchParams.get("receive"),
      }),
    [searchParams],
  );

  const setTab = useCallback(
    (next: InventoryPurchasingTab, extra?: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("tab", next);
          if (extra) {
            for (const [k, v] of Object.entries(extra)) {
              if (v == null || v === "") p.delete(k);
              else p.set(k, v);
            }
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const supplierId = searchParams.get("supplierId");
  const purchaseId = searchParams.get("purchaseId");
  const openNewPurchase = searchParams.get("new") === "1";

  const setSupplierId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (id) p.set("supplierId", id);
          else p.delete("supplierId");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPurchaseId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (id) p.set("purchaseId", id);
          else p.delete("purchaseId");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setOpenNewPurchase = useCallback(
    (open: boolean) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (open) p.set("new", "1");
          else p.delete("new");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    tab,
    setTab,
    supplierId,
    setSupplierId,
    purchaseId,
    setPurchaseId,
    openNewPurchase,
    setOpenNewPurchase,
  };
}
