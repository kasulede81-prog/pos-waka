/**
 * E1 — a product pull must never erase or roll back locally maintained PrepBatches.
 *
 * Found in the PrepBatch sync audit: the server stamps `updated_at = now()` on every stock movement, so the
 * pulled product row looks newer than the device's own copy and used to replace the WHOLE `menu` — batches
 * included — while the dish's stock stayed put (leaving stock with no batches, i.e. `unbatchedStock`).
 * The guard lives in the product merge (`mergeProductCatalogFields` → `mergePrepBatchesOnPull`): client-only,
 * it changes no stock, sale, void or return behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../offline/syncEngine";
import type { PrepBatch, Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { mergePrepBatchesOnPull, mergeProductCatalogFields, mergeProductFromCloudPull } from "./inventoryIntegrity";
import { preparedPortionsAvailable } from "./recipeEngine";

const DISH = "dish-1";
const T_LOCAL = "2026-09-19T08:00:00.000Z";
const T_SERVER = "2026-09-19T08:00:02.000Z"; // the server re-stamps updated_at when the stock RPC lands: always later

const batch = (id: string, remaining: number, extra: Partial<PrepBatch> = {}): PrepBatch => ({
  id,
  menuProductId: DISH,
  preparedAt: "2026-09-19T07:00:00.000Z",
  portionsPrepared: 10,
  remainingPortions: remaining,
  unitCostUgx: 1_000,
  status: "active",
  createdAt: "2026-09-19T07:00:00.000Z",
  updatedAt: T_LOCAL,
  version: 1,
  ...extra,
});

const dish = (over: Partial<Product> = {}, batches?: PrepBatch[], menuOver: Record<string, unknown> = {}): Product => ({
  id: DISH,
  name: "Prepared Chicken",
  sellingMode: "unit",
  baseUnit: "portion",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 0,
  stockOnHand: 4,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: T_LOCAL,
  version: 3,
  menu: {
    productKind: "finished_menu",
    prepMode: "batch_prepared",
    recipe: { yieldQty: 1, lines: [{ ingredientProductId: "ing", quantityBase: 1, unitLabel: "u" }] },
    modifierGroups: [],
    variants: [],
    ...(batches ? { prepBatches: batches } : {}),
    ...menuOver,
  },
  ...over,
});

const ids = (p: Product) => (p.menu?.prepBatches ?? []).map((b) => [b.id, b.remainingPortions, b.status]);
const serverRow = (over: Partial<Product> = {}, batches?: PrepBatch[], menuOver: Record<string, unknown> = {}) =>
  dish({ updatedAt: T_SERVER, ...over }, batches, menuOver);

describe("the product pull keeps local PrepBatches", () => {
  it("A. local b1 (remaining 4); the server row has no prepBatches at all -> b1 survives", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 })]);
    const remote = serverRow(); // menu present, no prepBatches key
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
    expect(preparedPortionsAvailable(merged)).toBe(4); // still equals the dish stock
  });

  it("A2. the server row has an empty prepBatches array -> b1 survives", () => {
    const merged = mergeProductFromCloudPull(dish({}, [batch("b1", 4, { version: 3 })]), serverRow({}, []), {});
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
  });

  it("A3. the server row has no menu at all -> the local menu (with its batches and prepMode) stays", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 })]);
    const remote: Product = { ...serverRow(), menu: null };
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
    expect(merged.menu?.prepMode).toBe("batch_prepared");
    expect(merged.menu?.recipe).toBeTruthy();
  });

  it("B. the server copy is an older menu snapshot (b1 still at 10) -> the local, newer b1 is not rolled back", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 })]);
    const stale = serverRow({}, [batch("b1", 10, { version: 1 })]);
    const merged = mergeProductFromCloudPull(local, stale, {});
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
  });

  it("B2. a stale ACTIVE copy cannot resurrect a batch this device cancelled", () => {
    const local = dish({}, [batch("b1", 0, { status: "cancelled", version: 4 })]);
    const stale = serverRow({}, [batch("b1", 10, { version: 1 })]);
    expect(ids(mergeProductFromCloudPull(local, stale, {}))).toEqual([["b1", 0, "cancelled"]]);
  });

  it("C. an unrelated price/name/menu change from the server applies, and b1 survives", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 })]);
    const remote = serverRow(
      { name: "Chicken Special", sellingPricePerUnitUgx: 12_000, version: 4, stockOnHand: 4 },
      undefined,
      { menuSection: "Mains", modifierGroups: [{ id: "g", name: "Sauce", required: false, options: [{ id: "o", label: "BBQ", priceDeltaUgx: 0 }] }] },
    );
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect(merged.name).toBe("Chicken Special");
    expect(merged.sellingPricePerUnitUgx).toBe(12_000);
    expect(merged.menu?.menuSection).toBe("Mains");
    expect(merged.menu?.modifierGroups?.[0]?.id).toBe("g");
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
  });

  it("C2. the same holds when this device also has an unsynced catalog edit queued", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 })]);
    const merged = mergeProductFromCloudPull(local, serverRow({ name: "Renamed" }), { pendingLocalCatalog: true });
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
  });

  it("C3. stock still comes from the server (the guard touches batches only)", () => {
    const local = dish({ stockOnHand: 4 }, [batch("b1", 4, { version: 3 })]);
    const merged = mergeProductFromCloudPull(local, serverRow({ stockOnHand: 7 }), {});
    expect(merged.stockOnHand).toBe(7);
    expect(merged.updatedAt).toBe(T_SERVER);
  });

  it("D. a product with no local batches is returned exactly as before (same object from the guard)", () => {
    const local = dish();
    const remote = serverRow({}, [batch("b1", 10)]);
    const base = mergeProductCatalogFields(local, remote);
    expect(mergePrepBatchesOnPull(local, remote, base)).toBe(base); // untouched
    // and the incoming batches are still adopted, as they always were
    expect(ids(mergeProductFromCloudPull(local, remote, {}))).toEqual([["b1", 10, "active"]]);
  });

  it("E. legacy / non-hospitality products (no menu, no batches) merge exactly as before", () => {
    const retail = (over: Partial<Product>): Product => ({
      id: "coke",
      name: "Coke",
      sellingMode: "unit",
      baseUnit: "bottle",
      sellingPricePerUnitUgx: 2_000,
      costPricePerUnitUgx: 1_200,
      stockOnHand: 10,
      minimumStockAlert: 0,
      category: "Drinks",
      sku: "",
      updatedAt: T_LOCAL,
      version: 1,
      ...over,
    });
    const local = retail({});
    const remote = retail({ name: "Coca-Cola", sellingPricePerUnitUgx: 2_500, stockOnHand: 8, updatedAt: T_SERVER, version: 2 });
    const merged = mergeProductFromCloudPull(local, remote, {});
    // the server row wins as it always did, and the guard adds no `menu` to a product that never had one
    expect([merged.name, merged.sellingPricePerUnitUgx, merged.stockOnHand, merged.updatedAt, merged.version]).toEqual(["Coca-Cola", 2_500, 8, T_SERVER, 2]);
    expect(merged).not.toHaveProperty("menu");
    // and the guard itself is the identity for it
    const base = mergeProductCatalogFields(local, remote);
    expect(mergePrepBatchesOnPull(local, remote, base)).toBe(base);
  });

  it("F. the pull is idempotent: applying the same server row again changes nothing", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 }), batch("b2", 6, { version: 2 })]);
    const remote = serverRow({ name: "Renamed" }, [batch("b1", 10, { version: 1 }), batch("b3", 5, { version: 1 })]);
    const once = mergeProductFromCloudPull(local, remote, {});
    const twice = mergeProductFromCloudPull(once, remote, {});
    expect(twice).toEqual(once);
    expect(ids(once)).toEqual([["b1", 4, "active"], ["b2", 6, "active"], ["b3", 5, "active"]]);
  });

  it("a higher per-batch version from the incoming row (another device kept working) is adopted; ties keep local", () => {
    const local = dish({}, [batch("b1", 4, { version: 3 }), batch("b2", 6, { version: 2 })]);
    const remote = serverRow({}, [batch("b1", 1, { version: 5 }), batch("b2", 9, { version: 2 })]);
    expect(ids(mergeProductFromCloudPull(local, remote, {}))).toEqual([["b1", 1, "active"], ["b2", 6, "active"]]);
  });

  it("the batches of the local copy are never dropped, whichever side is newer", () => {
    const local = dish({ updatedAt: T_SERVER }, [batch("b1", 4, { version: 3 })]);
    const olderRemote = dish({ updatedAt: T_LOCAL }, []);
    expect(ids(mergeProductFromCloudPull(local, olderRemote, {}))).toEqual([["b1", 4, "active"]]);
    expect(ids(mergeProductFromCloudPull(local, serverRow(), {}))).toEqual([["b1", 4, "active"]]);
  });
});

describe("E1 end to end: prepare, sell, then the server row arrives", () => {
  beforeEach(() => {
    vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("the dish keeps its batches and stays sellable after the pull", () => {
    const ing = (id: string): Product => ({ ...dish({ id, name: id, stockOnHand: 100, costPricePerUnitUgx: 500, baseUnit: "u", menu: { productKind: "ingredient" } }) });
    const recipeDish: Product = {
      ...dish({ stockOnHand: 0, updatedAt: "2026-09-19T06:00:00.000Z", version: 1 }),
      menu: { productKind: "finished_menu", prepMode: "batch_prepared", recipe: { yieldQty: 1, lines: [{ ingredientProductId: "ing", quantityBase: 1, unitLabel: "u" }] }, modifierGroups: [], variants: [] },
    };
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [ing("ing"), recipeDish],
      customers: [],
      sales: [],
      stockMovements: [],
      archivedStockMovements: [],
      voidRecords: [],
      returnRecords: [],
      auditLogs: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      draftInput: null,
      draftPaymentMethod: "cash",
    });
    expect(openTestShift().ok).toBe(true);
    expect(usePosStore.getState().prepareMenuBatch({ productId: DISH, portions: 10, batchId: "b1" }).ok).toBe(true);
    const p0 = usePosStore.getState().products.find((p) => p.id === DISH)!;
    usePosStore.setState({
      draftLines: [{ id: "l1", productId: DISH, name: p0.name, inputMode: "quantity", quantity: 6, unitPriceUgx: 10_000, unitCostUgx: 0, lineTotalUgx: 60_000, estimatedProfitUgx: 0, updatedAt: T_LOCAL }],
    });
    expect(usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);

    const local = usePosStore.getState().products.find((p) => p.id === DISH)!;
    expect(local.stockOnHand).toBe(4);
    expect(ids(local)).toEqual([["b1", 4, "active"]]);

    // What the cloud hands back: stock after the deltas, a catalog menu with NO batches, stamped later.
    const remote: Product = { ...local, stockOnHand: 4, updatedAt: new Date(Date.parse(local.updatedAt) + 2_000).toISOString(), menu: { ...local.menu!, prepBatches: [] } };
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect(ids(merged)).toEqual([["b1", 4, "active"]]);
    expect(preparedPortionsAvailable(merged)).toBe(merged.stockOnHand);

    // ...and the next sale is not blocked as "unbatched stock".
    usePosStore.setState({ products: usePosStore.getState().products.map((p) => (p.id === DISH ? merged : p)) });
    usePosStore.setState({
      draftLines: [{ id: "l2", productId: DISH, name: p0.name, inputMode: "quantity", quantity: 1, unitPriceUgx: 10_000, unitCostUgx: 0, lineTotalUgx: 10_000, estimatedProfitUgx: 0, updatedAt: T_LOCAL }],
    });
    expect(usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    expect(ids(usePosStore.getState().products.find((p) => p.id === DISH)!)).toEqual([["b1", 3, "active"]]);
  });
});
