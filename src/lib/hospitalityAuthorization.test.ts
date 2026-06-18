import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { defaultHospitalityFloor } from "./hospitality";

describe("usePosStore — hospitality and pending sales authorization", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "staff:1", role: "cashier", displayName: "Cashier" },
      draftLines: [
        {
          id: "line-1",
          productId: "p1",
          name: "Item",
          inputMode: "quantity",
          quantity: 1,
          unitPriceUgx: 1000,
          unitCostUgx: 100,
          lineTotalUgx: 1000,
          estimatedProfitUgx: 900,
          updatedAt: "2026-06-01T10:00:00.000Z",
        },
      ],
      draftCartDiscountUgx: 0,
      preferences: usePosStore.getState().preferences,
      sales: [],
      auditLogs: [],
    });
  });

  it("stock keeper savePendingSale is denied", () => {
    usePosStore.setState({
      sessionActor: { userId: "staff:sk", role: "stock_keeper", displayName: "Stock" },
    });
    const r = usePosStore.getState().savePendingSale("Hold");
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("stock keeper openTable is denied", () => {
    usePosStore.setState({
      sessionActor: { userId: "staff:sk", role: "stock_keeper", displayName: "Stock" },
      preferences: {
        ...usePosStore.getState().preferences,
        hospitalityFloor: {
          ...defaultHospitalityFloor(),
          areas: [{ id: "area-1", name: "Main", sortOrder: 0, isActive: true }],
          tables: [
            {
              id: "table-1",
              areaId: "area-1",
              label: "T1",
              capacity: 4,
              sortOrder: 0,
              isActive: true,
              displayStatus: "available",
            },
          ],
          sessions: [],
          kitchenTickets: [],
        },
      },
    });
    const r = usePosStore.getState().openTable({
      tableId: "table-1",
      guestCount: 2,
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("forbidden");
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("waiter with hospitality permissions can save pending sale", () => {
    usePosStore.setState({
      sessionActor: { userId: "staff:w", role: "waiter", displayName: "Waiter" },
    });
    const r = usePosStore.getState().savePendingSale("Table 3");
    expect(r.ok).toBe(true);
  });

  it("owner can open table when floor exists", () => {
    usePosStore.setState({
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      preferences: {
        ...usePosStore.getState().preferences,
        hospitalityFloor: {
          ...defaultHospitalityFloor(),
          areas: [{ id: "area-1", name: "Main", sortOrder: 0, isActive: true }],
          tables: [
            {
              id: "table-1",
              areaId: "area-1",
              label: "T1",
              capacity: 4,
              sortOrder: 0,
              isActive: true,
              displayStatus: "available",
            },
          ],
          sessions: [],
          kitchenTickets: [],
        },
      },
    });
    const r = usePosStore.getState().openTable({ tableId: "table-1", guestCount: 2 });
    expect(r.ok).toBe(true);
  });
});
