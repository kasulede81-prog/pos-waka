import { create } from "zustand";
import type {
  AuditAction,
  AuditLogEntry,
  BusinessType,
  ShopSellingStyle,
  Customer,
  DayCloseSummary,
  DebtPayment,
  LineInputMode,
  Product,
  Purchase,
  PurchaseLine,
  ReturnReason,
  ReturnRecord,
  Sale,
  SaleLine,
  SellingMode,
  ShiftRecord,
  ShopPreferences,
  Permission,
  StaffAccount,
  StockMovement,
  StockMovementKind,
  Supplier,
  SupplierPayment,
  SyncOperationKind,
  UserRole,
  VoidReason,
  VoidRecord,
  CashExpense,
  CashDrawerAdjustment,
  CashDrawerAdjustmentType,
  DayDrawerOpen,
  InventoryCountSession,
} from "../types";
import type { SessionActor } from "../lib/sessionActor";
import { checkStorePermissionEffective } from "../lib/storeAuthorization";
import { getStoreSubscriptionContext } from "../lib/storeSubscriptionContext";
import {
  validateCanAddProduct,
  validateDraftLinesPlanAccess,
  validateProductPlanAccess,
  resolveStorePlanTier,
} from "../lib/productPlanEnforcement";
import { validateCanAddStaffAccount } from "../lib/staffPlanEnforcement";
import { authorizeBackupRestore } from "../lib/backupRestoreAuthorization";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { normalizeProductHospitalityRouting } from "../lib/productHospitalityRouting";
import { createDefaultPreferences, createDefaultProducts } from "../data/defaultSeed";
import { readCachedOwnerOnboardingComplete } from "../lib/ownerOnboarding";
import { readPendingRegistrationProfileForUser } from "../lib/registrationProfileCache";
import { isWorkspaceBootstrapped } from "../lib/workspaceBootstrapCache";
import { hasSupabaseConfig } from "../lib/supabase";
import { writeSnapshot, readSnapshotWithFallback, claimLegacySnapshotForCurrentAccount } from "../offline/localDb";
import { normalizeInventoryCountSession } from "../lib/inventoryCount";
import { createInventoryCountStoreActions } from "./inventoryCountMutations";
import { createDayDrawerOpenStoreActions } from "./dayDrawerOpenMutations";
import { createRestaurantBillingStoreActions } from "./restaurantBillingMutations";
import { createHospitalityMenuStoreActions } from "./hospitalityMenuMutations";
import { createHardwarePrintStoreActions, ensureHardwarePrefsOnBootstrap } from "./hardwarePrintMutations";
import { publishCustomerDisplay } from "../lib/customerDisplayChannel";
import { resolveHospitalityHardware } from "../lib/hospitalityHardware";
import { normalizeDayDrawerOpen, isFormulaV2, resolveCashDrawerFormulaVersion } from "../lib/dayDrawerOpen";
import { getActiveAccountKey } from "../offline/accountScope";
import { isNativeApp } from "../lib/nativeApp";
import { persistDebounceMs, runWhenIdle, yieldUiTick } from "../lib/uiYield";
import { scanTodaySalesHead } from "../lib/salesDayIndex";
import {
  buildPendingSaleFromDraft,
  closeTableSession,
  ensureHospitalityFloor,
  openNamedTabSessionOnFloor,
  openTableSessionOnFloor,
  sessionDisplayLabel,
  syncTableDisplayStatuses,
  defaultHospitalityFloor,
  defaultKitchenEnabledForBusinessType,
  isHospitalityBusinessType,
} from "../lib/hospitality";
import { sessionWaiterAttribution } from "../lib/waiterAttribution";
import { isPharmacyBusinessType, isPharmacyMode } from "../lib/pharmacy";
import { inferProductGuess } from "../lib/pharmacyUx";
import { isProductExpired, normalizeExpiryDate, shouldBlockExpiredSale } from "../lib/pharmacyExpiry";
import { pharmacyQuickAddRequiresBuyPrice } from "../lib/pharmacyCostIntegrity";
import { buildPharmacySaleLine, buyingUnitFromPackaging } from "../lib/pharmacyPackaging";
import { applyIndustryReceiptDefaults, buildReceiptBrandingSnapshot } from "../lib/receiptBranding";
import type { SubscriptionPlanCode } from "../lib/subscriptionEntitlements";
import { normalizeMedicineForm, normalizeMedicineStrength } from "../lib/pharmacyMedicine";
import {
  addWaitlistEntry as addWaitlistEntryOp,
  cancelReservation,
  cancelWaitlistEntry as cancelWaitlistEntryOp,
  combineTables as combineTablesOp,
  createReservation,
  finishTableCleaning as finishTableCleaningOp,
  isTableSeatable,
  lockTable as lockTableOp,
  markReservationNoShow as markReservationNoShowOp,
  seatReservationOnFloor,
  seatWaitlistOnFloor,
  splitCombinedTables as splitTablesOp,
  startTableCleaning as startTableCleaningOp,
  suggestTables,
  unlockTable as unlockTableOp,
  updateReservation,
  upsertWaiterSection as upsertWaiterSectionOp,
} from "../lib/hospitalityFrontOfHouse";
import { KITCHEN_FIRE_STATION_TYPES } from "../lib/productHospitalityRouting";
import {
  fireKitchenTicketsForLines,
  cancelKitchenTicket,
  mergeSaleLines,
  mergeSessionsOnFloor,
  pruneServedKitchenTickets,
  transferSessionToTable,
  updateKitchenTicketStatus,
} from "../lib/hospitalityOps";
import {
  advanceKitchenTicket as advanceKitchenTicketOnFloor,
  recallKitchenTicket as recallKitchenTicketOnFloor,
  cancelKitchenTicketItem as cancelKitchenTicketItemOnFloor,
} from "../lib/kitchenProduction";
import { validateCombinedDraftDiscount } from "../lib/discountGovernance";
import {
  addDiningArea,
  addDiningTable,
  addKitchenStation,
  removeDiningArea,
  removeDiningTable,
  removeKitchenStation,
  renameDiningArea,
  updateDiningTable,
  updateKitchenStation,
} from "../lib/hospitalityFloorEditor";
import { normalizeDataRetentionPolicy } from "../lib/dataRetention";
import { canEnableBiometricAuth } from "../lib/sensitiveActionAuth";
import { archiveSalesBeyondActiveWindow, INITIAL_SALES_LOAD_COUNT, SALES_PAGE_LOAD_SIZE } from "../lib/activeSalesWindow";
import { partitionForArchive } from "../lib/recordArchive";
import { normalizePosShelfLayout, clampShelfScale, fillDefaultShelfLayout } from "../lib/posShelfLayout";
import { distinctTrimmedCategories } from "../lib/productCategories";
import { POS_SHELF_PRESET_IDS } from "../lib/posShelfPresets";
import { normalizeShelfHex } from "../lib/shelfColor";
import { normalizeLauncherTileLayout } from "../lib/launcherTiles";
import { normalizeOfficeHubTileLayout } from "../lib/officeHubSections";
import type { PosShelfPresetId } from "../types";
import { assertBackupRestoreNotAborted, cancelBackupRestoreSession } from "../lib/backupRestoreSession";
import { maybeAppendDailyAutoBackup } from "../offline/backupEngine";
import { clearPersistedDraft, readPersistedDraft, resolveDraftFromPersisted, writePersistedDraft } from "../offline/draftStorage";
import type { PersistedSnapshot } from "../offline/localDb";
import { tryMigrateLegacyLocalStorage, clearLegacyLocalStorage } from "../offline/migrateLegacyStore";
import { enqueueSync } from "../offline/syncEngine";
import {
  buildSaleLine,
  buyingUnitsToBaseUnits,
  costPerBaseFromBuyingUnitCost,
  pricePerBaseUnitUgx,
  purchaseLineCostTotalUgx,
  weightedCostAfterStockIn,
} from "../lib/sellingEngine";
import { lineCostForProductQuantity, lineCostUgx, lineProfitUgx, normalizeUnitCostUgx, advancePackCostUnitsDepleted, retractPackCostUnitsDepleted, resolvePackCostUnitsDepleted, applyPackSlotCostsToSaleLine, hasPackCostAllocation } from "../lib/costPrecision";
import {
  applyDiscountToLine,
  lineDiscountUgx,
  listPriceForLine,
  applyCustomerDebtDelta,
  creditDebtReductionFromSaleAdjustment,
  reduceSaleTotalsByAmount,
  shiftExpectedCash,
  type DiscountMode,
} from "../lib/saleAdjustments";
import {
  assertCanCloseShift,
  getActiveShiftForActor,
  requireActiveShift,
} from "../lib/shiftEnforcement";
import { cartDiscountFromPendingSale, mergeDraftSaleLine, rebuildDraftLineQuantity, shouldMergeDraftSaleLines } from "../lib/draftCart";
import {
  applyCartDiscountSnapshot,
  ensureMoneySaleQuantity,
  findSaleLineForReturn,
  resolveReturnCogsFromSaleLine,
  saleEstimatedProfitUgx,
} from "../lib/saleFinancialEngine";
import { deletedLineIdsFromDraft, ensureSaleLineId } from "../lib/pendingSaleMerge";
import { getDeviceOnline } from "../lib/deviceOnline";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../lib/walkInSupplier";
import {
  diffSupplierEdit,
  isPurchaseVoided,
  lastSupplyAtForSupplier,
  supplierTotalsAfterPurchaseVoid,
  validatePurchaseVoidStock,
} from "../lib/purchaseCorrections";
import { getBusinessProfile } from "../config/businessTypes";
import { dateKeyKampala } from "../lib/datesUg";
import { getCompletedFinancials } from "../lib/financialMetrics";
import { getDrawerCashForDayInput } from "../lib/cashReconciliation";
import { normalizeCashDrawerAdjustment } from "../lib/cashDrawerLedger";
import { cashReduceFromRefund } from "../lib/cashDrawerSales";
import { resolveDebtorForSale } from "../lib/customerDebtActivity";
import { draftQuantityExceedsStock, totalDraftQuantityForProduct } from "../lib/draftStockCheck";
import { verifyCustomerDebtIntegrity } from "../lib/customerDebtIntegrity";
import { canSafelyHealCustomerDebt } from "../lib/debtSyncState";
import { activeDayCloseForDate, canRecordDayClose } from "../lib/dayCloseIdempotency";
import { assertBusinessDateNotLocked } from "../lib/businessDateLock";
import {
  assertDayClosePreflightPassed,
  runDayClosePreflight as runDayCloseEnforcementPreflight,
} from "../lib/dayCloseEnforcement";
import {
  dayCloseVarianceIsFlagged,
  resolveDayCloseApproval,
} from "../lib/dayCloseApprovals";
import { assertSequentialBusinessDay } from "../lib/sequentialBusinessDays";
import { buildDayCloseSnapshot } from "../lib/dayCloseDocument";
import { normalizeProductMenu } from "../lib/menuModifiers";
import {
  applyRecipeStockDeduction,
  checkIngredientAvailability,
  requirementsFromSaleLines,
  shouldDeductFinishedProductStock,
} from "../lib/recipeEngine";
import { buildArchiveForensicSummary } from "../lib/archiveForensics";
import { validateReturnAgainstSale } from "../lib/returnLimits";
import { returnRestocksInventory, validateReturnAuthorization } from "../lib/returnPolicy";
import { emitInventoryStockChanges, type InventoryStockSyncMessage, type InventorySyncEventType } from "../lib/inventorySyncChannel";
import { mergeRemoteInventoryStock, validateDraftSaleStockBeforeFinalize } from "../lib/inventoryVersionProtection";
import { assertCanFinalizeStockSale } from "../lib/primaryRegisterMode";
import { isLocalStockFresh } from "../lib/stockFreshness";
import { authorizePreferencesPatch, requiredPermissionsForPreferencesPatch } from "../lib/settingsAuthorization";
import { appendAcknowledgement } from "../lib/ownerAlertAcknowledgement";
import {
  assertStaffAccountMutationAllowed,
  authorizeStaffAccountMutationWithDevice,
  StaffAccountAuthorizationError,
} from "../lib/staffAccountAuthorization";
import { isPrimaryDeviceCachedSync } from "../lib/deviceAuthority";
import { isCompletedSale } from "../lib/saleStatus";
import { diffProductCatalog, formatCatalogAuditSummary } from "../lib/catalogAudit";
import { auditReasonErrorKey, normalizeAuditReason, validateAuditReason } from "../lib/auditReasons";
import { canRecordCashExpenses, resolveNewExpenseApprovalStatus } from "../lib/cashExpenses";
import { logPilotEventFromAudit, appendPilotEvent } from "../lib/pilotEventLog";
import { saleStockMovementsFromSale, openingStockMovementFromProduct } from "../lib/inventoryIntegrity";
import { mergeStockMovementsWithArchive } from "../lib/stockMovementLedger";
import { repairLegacySaleFinancials } from "../lib/legacyFinancialRepair";
import { inventoryMovementNamespace } from "../lib/shopSyncContext";
import { detectSaleStockConflict, logInventoryConflict } from "../lib/inventoryConflictLog";
import { canTogglePosUiMode, normalizeUserRole, permissionsForRole } from "../lib/permissions";
import { normalizeShopCurrency } from "../lib/shopCurrency";
import { generateStaffUsername } from "../lib/staffAccountHelpers";
import { hashStaffSecretAsync, normalizePin } from "../lib/staffSecret";
import {
  clearPendingStaffSelection,
  readPendingStaffSelection,
  readStaffSession,
} from "../lib/staffOfflineAuth";

const MAX_AUDIT_LOGS = 5000;

function mergeStockMovements(
  existing: StockMovement[],
  incoming: StockMovement[],
  archived: StockMovement[] = [],
): { stockMovements: StockMovement[]; archivedStockMovements: StockMovement[] } {
  const merged = mergeStockMovementsWithArchive(existing, incoming, archived);
  return {
    stockMovements: merged.stockMovements.map(normalizeStockMovement),
    archivedStockMovements: merged.archivedStockMovements.map(normalizeStockMovement),
  };
}

function applyMovementMerge(
  existing: StockMovement[],
  incoming: StockMovement[],
  archived: StockMovement[] = [],
): { stockMovements: StockMovement[]; archivedStockMovements: StockMovement[] } {
  return mergeStockMovements(existing, incoming, archived);
}

function movementMergePatch(
  state: { stockMovements: StockMovement[]; archivedStockMovements?: StockMovement[] },
  incoming: StockMovement[],
): { stockMovements: StockMovement[]; archivedStockMovements: StockMovement[] } {
  return applyMovementMerge(state.stockMovements, incoming, state.archivedStockMovements ?? []);
}

function queueHospitalityChange(input: { sessionIds?: string[]; ticketIds?: string[]; layout?: boolean }) {
  void import("../offline/hospitalityCloudSync").then(({ syncHospitalityAfterFloorChange }) =>
    syncHospitalityAfterFloorChange(input),
  );
}

function mergeAuditLogs(existing: AuditLogEntry[], incoming: AuditLogEntry[]): AuditLogEntry[] {
  const byId = new Map<string, AuditLogEntry>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_AUDIT_LOGS);
}

function broadcastInventoryStock(products: Product[], type: InventorySyncEventType): void {
  if (products.length === 0) return;
  emitInventoryStockChanges(
    products.map((p) => ({ productId: p.id, newStock: p.stockOnHand, version: p.version })),
    type,
  );
}

function stockKindFromAdjustReason(reason: string | undefined): StockMovementKind {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("damage") || r.includes("spoiled") || r.includes("waste")) return "adjust_damage";
  if (r.includes("home") || r.includes("took") || r.includes("use")) return "adjust_use";
  if (r.includes("count") || r.includes("stocktake")) return "adjust_count";
  return "adjust_other";
}

function parseStoredUserRole(v: unknown): UserRole | null {
  return normalizeUserRole(v);
}

function normalizeStaffAccounts(raw: unknown): StaffAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffAccount[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const role = parseStoredUserRole(obj.role);
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!role || !name) continue;
    out.push({
      id: typeof obj.id === "string" && obj.id ? obj.id : crypto.randomUUID(),
      name,
      username: typeof obj.username === "string" ? obj.username.trim().toLowerCase() || null : null,
      role,
      permissions: permissionsForRole(role),
      pin: typeof obj.pin === "string" ? obj.pin.replace(/\D/g, "").slice(0, 6) || null : null,
      password: typeof obj.password === "string" ? obj.password || null : null,
      pinHash: typeof obj.pinHash === "string" ? obj.pinHash.trim() || null : null,
      passwordHash: typeof obj.passwordHash === "string" ? obj.passwordHash.trim() || null : null,
      phone: typeof obj.phone === "string" ? obj.phone || null : null,
      active: obj.active !== false,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
      email: typeof obj.email === "string" ? obj.email.trim().toLowerCase() || null : null,
      pendingCloudSync: obj.pendingCloudSync === true,
      lastLoginAt: typeof obj.lastLoginAt === "string" ? obj.lastLoginAt : null,
      lastDeviceFingerprint:
        typeof obj.lastDeviceFingerprint === "string" ? obj.lastDeviceFingerprint : null,
      failedPinAttempts: typeof obj.failedPinAttempts === "number" ? obj.failedPinAttempts : 0,
      lockedUntil: typeof obj.lockedUntil === "string" ? obj.lockedUntil : null,
      lastFailedLoginAt: typeof obj.lastFailedLoginAt === "string" ? obj.lastFailedLoginAt : null,
    });
  }
  return out;
}

function normalizeShifts(raw: unknown): ShiftRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item as Partial<ShiftRecord>;
      const role = parseStoredUserRole((o as { role?: unknown }).role);
      if (!o || !role || !o.actorUserId || !o.startAt) return null;
      return {
        id: o.id || crypto.randomUUID(),
        actorUserId: String(o.actorUserId),
        actorName: o.actorName ? String(o.actorName) : undefined,
        role,
        startAt: String(o.startAt),
        endAt: o.endAt ? String(o.endAt) : null,
        salesTotalUgx: Number(o.salesTotalUgx ?? 0) || 0,
        debtTotalUgx: Number(o.debtTotalUgx ?? 0) || 0,
        refundsUgx: Number(o.refundsUgx ?? 0) || 0,
        estimatedCashUgx: Number(o.estimatedCashUgx ?? 0) || 0,
        discountsTotalUgx: Number(o.discountsTotalUgx ?? 0) || 0,
        voidsTotalUgx: Number(o.voidsTotalUgx ?? 0) || 0,
        returnsTotalUgx: Number(o.returnsTotalUgx ?? 0) || 0,
        debtPaymentsTotalUgx: Number(o.debtPaymentsTotalUgx ?? 0) || 0,
        countedCashUgx: o.countedCashUgx != null ? Number(o.countedCashUgx) : null,
        cashDifferenceUgx: o.cashDifferenceUgx != null ? Number(o.cashDifferenceUgx) : null,
        openingFloatUgx: o.openingFloatUgx != null ? Number(o.openingFloatUgx) : null,
      };
    })
    .filter(Boolean) as ShiftRecord[];
}

function isPosShelfPresetId(v: unknown): v is PosShelfPresetId {
  return typeof v === "string" && (POS_SHELF_PRESET_IDS as string[]).includes(v);
}

function normalizePosShelfLayoutFromStore(raw: unknown) {
  return normalizePosShelfLayout(raw);
}

function preferencesWithDefaultShelfLayout(
  preferences: ShopPreferences,
  products: Product[],
): ShopPreferences {
  const layout = fillDefaultShelfLayout(
    preferences.posShelfLayout ?? {},
    distinctTrimmedCategories(products),
    preferences.posPinnedShelfKeys ?? [],
  );
  if (layout === preferences.posShelfLayout) return preferences;
  return { ...preferences, posShelfLayout: layout };
}

type DraftLineInput = {
  product: Product;
  inputMode: LineInputMode;
  value: number;
  /** Pharmacy POS: `value` is count in this unit (tablet / strip / box). */
  pharmacySaleUnit?: import("../types").PharmacySaleUnitType;
};

export type PosState = {
  _hydrated: boolean;
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  preferences: ShopPreferences;
  debtPayments: DebtPayment[];
  dayCloses: DayCloseSummary[];
  auditLogs: AuditLogEntry[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  stockMovements: StockMovement[];
  /** Archived stock movements — preserved when active window exceeds cap */
  archivedStockMovements: StockMovement[];
  voidRecords: VoidRecord[];
  returnRecords: ReturnRecord[];
  cashExpenses: CashExpense[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  dayDrawerOpens: DayDrawerOpen[];
  inventoryCountSessions: InventoryCountSession[];
  archivedSales: Sale[];
  archivedAuditLogs: AuditLogEntry[];
  archivedDayCloses: DayCloseSummary[];
  archivedVoidRecords: VoidRecord[];
  archivedReturnRecords: ReturnRecord[];
  /** Current signed-in actor (not persisted); synced from App shell / auth. */
  sessionActor: SessionActor | null;
  draftLines: SaleLine[];
  draftInput: DraftLineInput | null;
  /** Whole-cart discount in UGX (applied at checkout, not per line). */
  draftCartDiscountUgx: number;
  /** When set, draft cart belongs to an open table / pending sale */
  activePendingSaleId: string | null;
  /** Background sales history load — shows trust banner while older sales hydrate. */
  salesHistoryHydration: { active: boolean; loaded: number; total: number } | null;

  hydrate: (
    data: {
      products: Product[];
      customers: Customer[];
      sales: Sale[];
      preferences: ShopPreferences;
      debtPayments?: DebtPayment[];
      dayCloses?: DayCloseSummary[];
      auditLogs?: AuditLogEntry[];
      suppliers?: Supplier[];
      purchases?: Purchase[];
      supplierPayments?: SupplierPayment[];
      stockMovements?: StockMovement[];
      archivedStockMovements?: StockMovement[];
      voidRecords?: VoidRecord[];
      returnRecords?: ReturnRecord[];
      cashExpenses?: CashExpense[];
      cashDrawerAdjustments?: CashDrawerAdjustment[];
      dayDrawerOpens?: DayDrawerOpen[];
      inventoryCountSessions?: InventoryCountSession[];
      archivedSales?: Sale[];
      archivedAuditLogs?: AuditLogEntry[];
      archivedDayCloses?: DayCloseSummary[];
      archivedVoidRecords?: VoidRecord[];
      archivedReturnRecords?: ReturnRecord[];
    },
    opts?: { replaceAudit?: boolean },
  ) => void;

  /** Fast path: products + preferences only — UI can render while sales load in background. */
  hydrateEssentials: (data: {
    products: Product[];
    customers: Customer[];
    preferences: ShopPreferences;
  }) => void;

  /** Background path: sales history and back-office collections (sales optional if already set). */
  hydrateRemainder: (data: {
    sales?: Sale[];
    debtPayments?: DebtPayment[];
    dayCloses?: DayCloseSummary[];
    auditLogs?: AuditLogEntry[];
    suppliers?: Supplier[];
    purchases?: Purchase[];
    supplierPayments?: SupplierPayment[];
    stockMovements?: StockMovement[];
    voidRecords?: VoidRecord[];
    returnRecords?: ReturnRecord[];
    cashExpenses?: CashExpense[];
    cashDrawerAdjustments?: CashDrawerAdjustment[];
    dayDrawerOpens?: DayDrawerOpen[];
    inventoryCountSessions?: InventoryCountSession[];
    archivedSales?: Sale[];
    archivedAuditLogs?: AuditLogEntry[];
    archivedDayCloses?: DayCloseSummary[];
    archivedVoidRecords?: VoidRecord[];
    archivedReturnRecords?: ReturnRecord[];
  }) => void;

  /** Replace local state + disk from a full backup (owner only in UI). Prefer await applyRestoredSnapshotFromBackup. */
  applyRestoredSnapshot: (snap: PersistedSnapshot) => void;

  /**
   * Detach the current session: drop ALL in-memory state and mark the store
   * unhydrated so that no further disk writes leak the previous account's data.
   * Persisted data on disk is NOT deleted; the namespaced snapshot for that
   * account stays intact and will be re-hydrated next time the same account
   * signs in.
   */
  resetForSignOut: () => void;

  /** Apply inventory stock from another browser tab (BroadcastChannel / storage). */
  applyRemoteInventorySync: (msg: InventoryStockSyncMessage) => void;

  setSessionActor: (actor: SessionActor | null) => void;

  setPreferences: (p: Partial<ShopPreferences>, opts?: { silent?: boolean }) => void;
  addStaffAccount: (input: {
    name: string;
    username?: string;
    role: UserRole;
    pin?: string;
    password?: string;
    phone?: string;
    email?: string;
    permissions?: Permission[];
  }) => Promise<{ ok: boolean; errorKey?: string; id?: string; queued?: boolean }>;
  updateStaffAccount: (id: string, patch: { name?: string; username?: string; role?: UserRole; phone?: string; active?: boolean }) => void;
  removeStaffAccount: (id: string) => void;
  resetStaffSecret: (id: string, patch: { pin?: string | null; password?: string | null }) => void;
  unlockStaffAccount: (id: string) => Promise<{ ok: boolean; errorKey?: string }>;
  switchStaffAccount: (id: string | null, opts?: { force?: boolean }) => { ok: boolean; errorKey?: string };
  setPosLocked: (locked: boolean) => void;
  setPilotModeEnabled: (enabled: boolean) => void;
  acknowledgeOwnerAlert: (alertId: string) => void;
  beginShift: (openingFloatUgx?: number) => { ok: boolean; errorKey?: string };
  beginShiftV2: (input: import("./dayDrawerOpenMutations").BeginShiftV2Input) => { ok: boolean; errorKey?: string; shiftId?: string };
  recordDayDrawerOpen: (input: {
    openingFloatUgx: number;
    note?: string;
    witnessUserId?: string | null;
    dateKey?: string;
  }) => { ok: boolean; errorKey?: string; dayOpenId?: string };
  supersedeDayDrawerOpen: (input: {
    previousId: string;
    openingFloatUgx: number;
    note?: string;
    reason?: string;
    ownerOverridePin?: string;
  }) => { ok: boolean; errorKey?: string; dayOpenId?: string };
  voidDayDrawerOpen: (input: {
    dayOpenId: string;
    reason: string;
    ownerOverridePin?: string;
  }) => { ok: boolean; errorKey?: string };
  endActiveShift: (actorUserId?: string) => void;
  logAuditAction: (action: AuditAction, summary: string, payload?: Record<string, unknown>) => void;
  completeBusinessOnboarding: (businessType: BusinessType) => void;
  completeShopOnboardingWizard: (input: {
    businessType: BusinessType;
    sellingStyle: ShopSellingStyle;
    latitude?: number;
    longitude?: number;
    gpsSkipped?: boolean;
  }) => void;
  updateBusinessType: (businessType: BusinessType) => void;

  setDraftInput: (input: DraftLineInput | null) => void;
  addDraftLineFromInput: () => { ok: boolean; errorKey?: string };
  removeDraftLine: (productId: string) => void;
  setDraftLineQuantity: (productId: string, quantity: number) => { ok: boolean; errorKey?: string };
  adjustDraftLineQuantity: (productId: string, delta: number) => { ok: boolean; errorKey?: string };
  applyDraftLineDiscount: (productId: string, mode: DiscountMode, value: number) => { ok: boolean; errorKey?: string };
  setDraftCartDiscount: (amountUgx: number) => { ok: boolean; errorKey?: string };
  clearDraft: () => void;
  ensureHospitalityFloor: () => void;
  openTable: (input: {
    tableId: string;
    guestCount: number;
    adultCount?: number;
    childrenCount?: number;
    customerName?: string;
    customerPhone?: string;
    specialNotes?: string;
    reservationId?: string;
    waitlistEntryId?: string;
  }) => { ok: boolean; errorKey?: string; sessionId?: string };
  openNamedTab: (input: {
    tabLabel: string;
    guestCount?: number;
    customerName?: string;
    customerPhone?: string;
  }) => { ok: boolean; errorKey?: string; sessionId?: string };
  resumeTableSession: (sessionId: string) => Promise<{ ok: boolean; errorKey?: string }>;
  saveTableBill: () => { ok: boolean; errorKey?: string };
  requestTableBill: (sessionId: string) => void;
  updateTableBillDraft: (
    patch: Partial<import("../types").RestaurantBillDraft>,
  ) => { ok: boolean; errorKey?: string };
  applyTableBillSplits: (input: {
    mode: import("../types").RestaurantBillSplitMode;
    splits: import("../types").BillSplitLine[];
  }) => { ok: boolean; errorKey?: string };
  recordTableBillPayment: (input: {
    method: import("../types").RestaurantPaymentMethod;
    amountUgx: number;
    reference?: string | null;
    voucherCode?: string | null;
    splitId?: string | null;
  }) => { ok: boolean; errorKey?: string; remainingBalanceUgx?: number; canFinalize?: boolean };
  finalizeTableBill: (input?: { changeGivenUgx?: number }) => {
    ok: boolean;
    errorKey?: string;
    firstSale?: boolean;
    saleId?: string;
  };
  approveTableBillDiscount: (input: {
    kind: "line" | "bill";
    reason: string;
    managerPin?: string;
  }) => { ok: boolean; errorKey?: string };
  reopenTableBill: (input: {
    sessionId: string;
    reason: string;
    managerPin: string;
  }) => { ok: boolean; errorKey?: string; sessionId?: string };
  voidSettledTableBill: (input: {
    sessionId: string;
    reason: string;
    managerPin: string;
  }) => { ok: boolean; errorKey?: string; saleId?: string };
  setDraftLineSeat: (lineId: string, seatNumber: number | null) => { ok: boolean };
  addHospitalityDraftLine: (input: {
    product: Product;
    quantity?: number;
    variantId?: string | null;
    modifiers?: import("../types").SaleLineModifier[];
    comboSelections?: import("../types").SaleLineComboSelection[];
    notes?: string | null;
    course?: import("../types").HospitalityCourse | null;
    seatNumber?: number | null;
    managerOverride?: boolean;
  }) => { ok: boolean; errorKey?: string; lineId?: string; shortages?: import("../types").IngredientShortage[] };
  setDraftLineNotesById: (lineId: string, notes: string | null) => { ok: boolean };
  setDraftLineCourseById: (lineId: string, course: import("../types").HospitalityCourse | null) => { ok: boolean };
  removeDraftLineById: (lineId: string) => void;
  adjustDraftLineQuantityById: (lineId: string, delta: number) => { ok: boolean; errorKey?: string };
  productNeedsOrderConfig: (product: Product) => boolean;
  clearActiveTableOrder: () => void;
  transferTableSession: (sessionId: string, toTableId: string) => { ok: boolean; errorKey?: string };
  mergeTableSessions: (sourceSessionId: string, targetSessionId: string) => { ok: boolean; errorKey?: string };
  updateKitchenTicketStatus: (ticketId: string, status: import("../types").KitchenTicketStatus) => void;
  advanceKitchenTicket: (ticketId: string) => void;
  recallKitchenTicket: (ticketId: string, reason: string) => { ok: boolean; errorKey?: string };
  cancelKitchenTicket: (ticketId: string) => void;
  cancelKitchenTicketItem: (
    ticketId: string,
    itemId: string,
    reason: string,
  ) => { ok: boolean; errorKey?: string };
  cleanupKitchenTickets: () => void;
  fireTableKitchenTickets: () => { ok: boolean; errorKey?: string };
  fireTableStationTickets: (stationTypes: import("../types").KitchenStationType[]) => {
    ok: boolean;
    errorKey?: string;
    ticketsFired?: number;
  };
  fireTableCourseTickets: (courses: import("../types").HospitalityCourse[]) => {
    ok: boolean;
    errorKey?: string;
    ticketsFired?: number;
  };
  enqueueKitchenTicketPrints: (ticketIds: string[], kind?: import("../lib/kitchenChitPrint").KitchenChitPrintKind) => void;
  reprintKitchenTicket: (ticketId: string) => { ok: boolean; errorKey?: string };
  upsertPrinter: (input: {
    id?: string;
    name: string;
    connectionType: import("../types").PrinterConnectionType;
    paperWidth: "58mm" | "80mm";
    stationRoles: import("../types").PrinterStationRole[];
    isDefaultReceipt?: boolean;
    networkHost?: string | null;
    networkPort?: number | null;
  }) => { ok: boolean; printerId?: string };
  removePrinter: (printerId: string) => { ok: boolean };
  assignStationPrinter: (stationId: string, printerId: string | null) => { ok: boolean; errorKey?: string };
  testConfiguredPrinter: (printerId: string) => Promise<{ ok: boolean; error?: string }>;
  setHospitalityHardwarePrefs: (patch: Partial<import("../types").HospitalityHardwarePrefs>) => { ok: boolean };
  openCashDrawerManual: (reason?: string) => Promise<{ ok: boolean; error?: string }>;
  printRestaurantReceiptForSale: (
    saleId: string,
    context?: {
      tableLabel?: string | null;
      waiterLabel?: string | null;
      guestCount?: number | null;
      voidReceipt?: boolean;
      reprint?: boolean;
      receiptKind?: import("../lib/restaurantReceiptPrint").RestaurantReceiptKind;
      splitId?: string | null;
      splitLabel?: string | null;
      splitIndex?: number | null;
      orderRound?: number | null;
    },
  ) => Promise<{ ok: boolean; mode?: string; error?: string }>;
  openCashDrawerOnPayment: (saleId: string) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
  syncCustomerDisplay: () => void;
  processPendingPrintQueue: () => void;
  bootstrapResumePrintQueue: () => void;
  cancelQueuedPrintJob: (jobId: string) => { ok: boolean };
  retryFailedPrintJobs: () => { ok: boolean };
  setHospitalityManualKitchenFire: (enabled: boolean) => void;
  addDiningArea: (name: string) => void;
  renameDiningArea: (areaId: string, name: string) => void;
  removeDiningArea: (areaId: string) => { ok: boolean; errorKey?: string };
  addDiningTable: (input: { areaId: string; label: string; capacity?: number }) => void;
  updateDiningTable: (
    tableId: string,
    patch: Partial<{ label: string; capacity: number; areaId: string; sortOrder: number; isActive: boolean }>,
  ) => void;
  removeDiningTable: (tableId: string) => { ok: boolean; errorKey?: string };
  addKitchenStation: (input: { name: string; stationType: import("../types").KitchenStationType }) => void;
  updateKitchenStation: (
    stationId: string,
    patch: Partial<{ name: string; stationType: import("../types").KitchenStationType; isActive: boolean }>,
  ) => void;
  removeKitchenStation: (stationId: string) => { ok: boolean; errorKey?: string };
  createTableReservation: (
    input: Omit<import("../types").TableReservation, "id" | "reservationNumber" | "status" | "createdAt" | "updatedAt" | "pendingSync">,
  ) => { ok: boolean; errorKey?: string; reservationId?: string };
  updateTableReservation: (reservationId: string, patch: Partial<import("../types").TableReservation>) => void;
  cancelTableReservation: (reservationId: string, reason: string) => void;
  confirmTableReservation: (reservationId: string) => void;
  markReservationNoShow: (reservationId: string) => void;
  addWaitlistEntry: (
    input: Omit<import("../types").WaitlistEntry, "id" | "status" | "createdAt" | "updatedAt" | "pendingSync">,
  ) => { ok: boolean; entryId?: string };
  cancelWaitlistEntry: (entryId: string) => void;
  suggestTablesForGuests: (input: {
    guestCount: number;
    areaId?: string | null;
    preferredTableId?: string | null;
    isVip?: boolean;
  }) => import("../lib/hospitalityFrontOfHouse").TableSuggestion[];
  combineTables: (tableIds: string[]) => { ok: boolean; errorKey?: string };
  splitCombinedTables: (groupId: string) => { ok: boolean; errorKey?: string };
  lockTable: (tableId: string, reason: import("../types").TableLockReason, note?: string) => void;
  unlockTable: (tableId: string) => void;
  startTableCleaning: (tableId: string) => void;
  finishTableCleaning: (tableId: string) => void;
  upsertWaiterSection: (section: Omit<import("../types").WaiterSection, "id"> & { id?: string }) => void;
  savePendingSale: (referenceLabel?: string | null) => { ok: boolean; errorKey?: string; saleId?: string };
  resumePendingSale: (saleId: string) => { ok: boolean; errorKey?: string };
  cancelPendingSale: (saleId: string) => { ok: boolean; errorKey?: string };
  voidSaleLine: (input: {
    saleId: string;
    lineIndex: number;
    reason: VoidReason;
    note?: string;
  }) => { ok: boolean; errorKey?: string };
  returnProduct: (input: {
    saleId?: string | null;
    productId: string;
    quantity: number;
    refundAmountUgx: number;
    reason: ReturnReason;
    note?: string;
  }) => { ok: boolean; errorKey?: string; returnRecord?: ReturnRecord };
  closeShiftWithCashCount: (
    countedCashUgx: number,
    handoffFloatUgx?: number,
  ) => { ok: boolean; errorKey?: string; differenceUgx?: number };
  finalizeDraftSale: (opts: {
    debtUgx: number;
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    paymentMethod?: "cash" | "atm" | "mobile_money" | "mixed" | "credit" | "voucher";
    amountPaidUgx?: number;
    changeGivenUgx?: number;
    splitBreakdown?: import("../types").BillSplitLine[] | null;
    serviceChargeUgx?: number;
    tipUgx?: number;
    taxUgx?: number;
    billPayments?: import("../types").BillPaymentRecord[] | null;
  }) => { ok: boolean; errorKey?: string; firstSale?: boolean; saleId?: string };

  addProduct: (p: Omit<Product, "id" | "updatedAt" | "version"> & Partial<Pick<Product, "quickPresetsMoneyUgx" | "quickPresetsQty">>) => void;
  quickAddProduct: (input: {
    name: string;
    priceUgx: number;
    stockQty: number;
    category: string;
    inferName?: string;
    sellingMode?: SellingMode;
    baseUnit?: string;
    buyingUnit?: string | null;
    conversionRate?: number | null;
    /** When set (e.g. from pack cost ÷ pieces), used instead of a guessed cost */
    costPricePerUnitUgx?: number | null;
    buyingPackCostUgx?: number | null;
    quickPresetsMoneyUgx?: number[];
    quickPresetsQty?: number[];
    medicineStrength?: string | null;
    medicineForm?: string | null;
    expiryDate?: string | null;
    minimumStockAlert?: number;
    pharmacyPackaging?: import("../types").PharmacyPackaging | null;
  }) => { ok: boolean; errorKey?: string };
  bulkQuickAddProducts: (
    rows: Array<{
      name: string;
      priceUgx: number;
      stockQty: number;
      category: string;
      inferName?: string;
      sellingMode?: SellingMode;
      baseUnit?: string;
      medicineStrength?: string | null;
      medicineForm?: string | null;
    }>,
  ) => { added: number; skipped: number };
  duplicateProduct: (productId: string, nameSuffix: string) => { ok: boolean; errorKey?: string };
  removeProduct: (productId: string, reason: string) => { ok: boolean; errorKey?: string };
  updateProductQuickPresets: (
    productId: string,
    presets: { quickPresetsMoneyUgx?: number[]; quickPresetsQty?: number[] },
  ) => void;
  /** Full product edit (name, prices, stock count, pack/cost, presets). Stock count changes log a count adjustment. */
  updateProduct: (
    productId: string,
    patch: Partial<
      Pick<
        Product,
        | "name"
        | "sellingMode"
        | "baseUnit"
        | "buyingUnit"
        | "conversionRate"
        | "sellingPricePerUnitUgx"
        | "costPricePerUnitUgx"
        | "buyingPackCostUgx"
        | "stockOnHand"
        | "minimumStockAlert"
        | "category"
        | "sku"
        | "expiryDate"
        | "medicineStrength"
        | "medicineForm"
        | "pharmacyPackaging"
        | "quickPresetsMoneyUgx"
        | "quickPresetsQty"
        | "hospitality"
        | "menu"
      >
    >,
    opts?: { auditReason?: string },
  ) => { ok: boolean; errorKey?: string };
  adjustStock: (productId: string, delta: number, reason?: string) => { ok: boolean; errorKey?: string };
  /** Pharmacy: write off expired stock with audit trail and inventory loss value. */
  writeOffExpiredStock: (input: {
    productId: string;
    quantity?: number;
    note?: string;
  }) => { ok: boolean; errorKey?: string; lossValueUgx?: number };
  addCustomer: (c: Omit<Customer, "id" | "createdAt" | "version" | "debtBalanceUgx">) => Customer;
  assignOrphanDebtSale: (saleId: string, customerId: string) => { ok: boolean; errorKey?: string };
  addDebtPayment: (
    customerId: string,
    amountUgx: number,
  ) => { ok: boolean; errorKey?: string; payment?: import("../types").DebtPayment };
  recordDayClose: (opts: {
    dateKey: string;
    countedCashUgx: number;
    override?: boolean;
    overrideReason?: string;
    emergency?: boolean;
    emergencyReason?: string;
    managerPin?: string;
    syncOverride?: boolean;
    sequentialOverride?: boolean;
    varianceOverride?: boolean;
  }) => Promise<{ ok: boolean; errorKey?: string; warnings?: string[] }>;
  reopenBusinessDay: (opts: {
    dateKey: string;
    reason: string;
    ownerPin: string;
  }) => { ok: boolean; errorKey?: string };
  repairCustomerDebtIntegrity: () => {
    ok: boolean;
    healedCount: number;
    mismatchCount: number;
    errorKey?: string;
  };
  addCashExpense: (input: { amountUgx: number; category: string; description?: string }) => { ok: boolean; errorKey?: string; expenseId?: string };
  approveCashExpense: (id: string) => { ok: boolean; errorKey?: string };
  rejectCashExpense: (id: string) => { ok: boolean; errorKey?: string };
  voidCashExpense: (id: string, reason: string) => { ok: boolean; errorKey?: string };
  addCashDrawerAdjustment: (input: {
    type: CashDrawerAdjustmentType;
    amountUgx: number;
    note?: string;
    occurredAt?: string;
  }) => { ok: boolean; errorKey?: string; adjustmentId?: string };

  addSupplier: (input: { name: string; phone?: string; location?: string; notes?: string }) => void;
  updateSupplier: (
    supplierId: string,
    patch: { name?: string; phone?: string; location?: string; notes?: string },
  ) => { ok: boolean; errorKey?: string };
  addSupplierPayment: (supplierId: string, amountUgx: number) => { ok: boolean; errorKey?: string };
  voidPurchase: (purchaseId: string, reason: string) => { ok: boolean; errorKey?: string };
  recordPurchase: (input: {
    supplierId?: string | null;
    /** Display name when buying in town (no fixed supplier). */
    supplierName?: string;
    lines: Array<{
      productId: string;
      qtyBuyingUnits?: number;
      costPerBuyingUnitUgx?: number;
      /** Pharmacy restock by tablet/strip/box — skips buying-unit conversion. */
      baseUnitsIn?: number;
      costPerBaseUnitUgx?: number;
    }>;
    amountPaidUgx: number;
    notes?: string;
  }) => { ok: boolean; errorKey?: string };

  /** Move old sales / activity to archive per retention policy (never auto-deletes). */
  runDataArchive: () => {
    moved: { sales: number; auditLogs: number; dayCloses: number; voidRecords: number; returnRecords: number; shifts: number };
  };
  /** Owner-only permanent removal of archived buckets on this device. */
  permanentlyDeleteArchived: () => Promise<{ ok: boolean; errorKey?: string }>;

  createInventoryCountSession: (notes?: string) => { ok: boolean; errorKey?: string; sessionId?: string };
  startInventoryCountSession: (sessionId: string) => { ok: boolean; errorKey?: string };
  setInventoryCountLine: (
    sessionId: string,
    productId: string,
    countedQty: number,
    reason?: string,
  ) => { ok: boolean; errorKey?: string };
  submitInventoryCountSession: (sessionId: string) => { ok: boolean; errorKey?: string };
  approveInventoryCountSession: (sessionId: string) => { ok: boolean; errorKey?: string };
  applyInventoryCountSession: (sessionId: string) => { ok: boolean; errorKey?: string; movementCount?: number };
  cancelInventoryCountSession: (sessionId: string) => { ok: boolean; errorKey?: string };
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let draftPersistTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced incremental persist: accumulate prev/next across rapid mutations. */
let pendingPersistPrev: PosState | null = null;
let pendingPersistNext: PosState | null = null;
/** While > 0, auto-persist is paused (restore, cloud merge, etc.). */
let persistSuspended = 0;
let snapshotWriteInFlight = false;
let snapshotWriteQueued = false;

/** Pause debounced snapshot writes during heavy store mutations. */
export function suspendStorePersist(): () => void {
  persistSuspended += 1;
  return () => {
    persistSuspended = Math.max(0, persistSuspended - 1);
  };
}

function fireSnapshotWrite(forceFull = false): void {
  if (snapshotWriteInFlight) {
    snapshotWriteQueued = true;
    return;
  }
  snapshotWriteInFlight = true;
  void (async () => {
    try {
      if (isNativeApp()) {
        await yieldUiTick();
      }
      const cur = usePosStore.getState();
      if (!cur._hydrated || persistSuspended > 0) return;

      const prev = pendingPersistPrev ?? cur;
      const next = pendingPersistNext ?? cur;
      pendingPersistPrev = null;
      pendingPersistNext = null;

      const { flushIncrementalPersist, flushFullSnapshotPersist } = await import("../offline/incrementalPersist");
      const result = forceFull
        ? await flushFullSnapshotPersist(next, { skipLastGood: true })
        : await flushIncrementalPersist(prev, next);

      const { isDiagnosticsEnabled, recordPersistWrite, recordIncrementalPersist } = await import(
        "../lib/stabilityDiagnostics",
      );
      if (isDiagnosticsEnabled()) {
        if (result.mode === "full") recordPersistWrite(result.bytesWritten, result.durationMs);
        else recordIncrementalPersist(result);
      }

      const after = usePosStore.getState();
      if (!after._hydrated || persistSuspended > 0) return;

      const runBackup = () => {
        void (async () => {
          const latest = usePosStore.getState();
          if (!latest._hydrated) return;
          const nextKey = await maybeAppendDailyAutoBackup(latest.preferences.lastAutoBackupDateKey);
          if (nextKey && nextKey !== latest.preferences.lastAutoBackupDateKey) {
            usePosStore.setState((st) => ({
              preferences: { ...st.preferences, lastAutoBackupDateKey: nextKey },
            }));
          }
        })();
      };
      if (isNativeApp()) {
        runWhenIdle(runBackup, 4000);
      } else {
        runBackup();
      }
    } finally {
      snapshotWriteInFlight = false;
      if (snapshotWriteQueued) {
        snapshotWriteQueued = false;
        fireSnapshotWrite(false);
      }
    }
  })();
}

function fireDraftWrite(s: PosState): void {
  const input = s.draftInput
    ? { productId: s.draftInput.product.id, inputMode: s.draftInput.inputMode, value: s.draftInput.value }
    : null;
  void writePersistedDraft(s.draftLines, input, s.draftCartDiscountUgx);
}

function schedulePersist(prev: PosState, next: PosState) {
  if (!next._hydrated || persistSuspended > 0) return;
  if (!pendingPersistPrev) pendingPersistPrev = prev;
  pendingPersistNext = next;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    fireSnapshotWrite(false);
  }, persistDebounceMs());
}

function scheduleDraftPersist(get: () => PosState) {
  if (!get()._hydrated) return;
  if (draftPersistTimer) clearTimeout(draftPersistTimer);
  draftPersistTimer = setTimeout(() => {
    draftPersistTimer = null;
    fireDraftWrite(get());
  }, 400);
}

/**
 * Synchronously fire any pending persist timers so the in-flight snapshot is
 * captured under the CURRENT account key before an account switch swaps the
 * namespace. The async writes themselves capture the scoped key inside
 * `writeSnapshot` at call time, so they remain bound to the outgoing account
 * even after the active key flips to null / the next account.
 */
export function flushPendingPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    const next = pendingPersistNext ?? usePosStore.getState();
    const prev = pendingPersistPrev ?? next;
    pendingPersistPrev = null;
    pendingPersistNext = null;
    if (next._hydrated && persistSuspended === 0) {
      void import("../offline/incrementalPersist").then((m) => m.flushIncrementalPersist(prev, next));
    }
  }
  if (draftPersistTimer) {
    clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
    const s = usePosStore.getState();
    if (s._hydrated) fireDraftWrite(s);
  }
}

async function queueRemote(kind: SyncOperationKind, payload: unknown) {
  if (getActiveAccountKey()?.startsWith("demo:")) return;
  await enqueueSync({
    id: crypto.randomUUID(),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

function defaultQuickPresetsForProduct(p: Omit<Product, "id" | "updatedAt" | "version">): Pick<Product, "quickPresetsMoneyUgx" | "quickPresetsQty"> {
  if (p.quickPresetsMoneyUgx?.length || p.quickPresetsQty?.length) {
    return { quickPresetsMoneyUgx: p.quickPresetsMoneyUgx, quickPresetsQty: p.quickPresetsQty };
  }
  if (p.sellingMode === "portion") return { quickPresetsMoneyUgx: [500, 1000, 2000], quickPresetsQty: [0.5, 1, 2] };
  if (p.sellingMode === "weighted") {
    const u = p.sellingPricePerUnitUgx;
    return {
      quickPresetsQty: [1, 2, 5],
      quickPresetsMoneyUgx: [u, u * 2, u * 5],
    };
  }
  const u = p.sellingPricePerUnitUgx;
  return { quickPresetsMoneyUgx: u > 0 ? [u, u * 2, u * 3] : [], quickPresetsQty: [1, 2, 3] };
}

function receiptSnapshotPlanTier(preferences: ShopPreferences): SubscriptionPlanCode {
  if (!hasSupabaseConfig) return "waka_plus";
  if (preferences.receiptShowPoweredByWaka === false) return "business";
  return "free";
}

function normalizeProduct(p: Product): Product {
  const d = defaultQuickPresetsForProduct(p);
  const hasMoney = (p.quickPresetsMoneyUgx?.length ?? 0) > 0;
  const hasQty = (p.quickPresetsQty?.length ?? 0) > 0;
  const packAlloc = hasPackCostAllocation(p);
  return {
    ...p,
    quickPresetsMoneyUgx: hasMoney ? p.quickPresetsMoneyUgx : d.quickPresetsMoneyUgx,
    quickPresetsQty: hasQty ? p.quickPresetsQty : d.quickPresetsQty,
    packCostUnitsDepleted: packAlloc ? resolvePackCostUnitsDepleted(p) : p.packCostUnitsDepleted,
    hospitality: p.hospitality ? normalizeProductHospitalityRouting(p.hospitality, p) : p.hospitality ?? null,
  };
}

function normalizeCustomer(c: Customer): Customer {
  return { ...c, debtBalanceUgx: typeof c.debtBalanceUgx === "number" ? c.debtBalanceUgx : 0 };
}

function normalizeSaleLine(line: SaleLine): SaleLine {
  const unitPriceUgx = Math.max(0, Math.floor(Number(line.unitPriceUgx) || 0));
  const unitCostUgx = normalizeUnitCostUgx(line.unitCostUgx);
  const lineTotalUgx = Math.max(0, Math.floor(Number(line.lineTotalUgx) || 0));
  const quantity = Math.max(0, Number(line.quantity) || 0);
  const estimatedProfitUgx =
    line.financialDataStatus === "legacy" || line.financialDataStatus === "needs_repair"
      ? 0
      : Number.isFinite(line.estimatedProfitUgx)
        ? Math.round(line.estimatedProfitUgx)
        : lineProfitUgx(
            Math.max(0, Math.floor(Number(line.netRevenueUgx ?? line.lineTotalUgx) || 0)),
            lineCostUgx(unitCostUgx, quantity),
          );
  return {
    ...line,
    quantity,
    unitPriceUgx,
    unitCostUgx,
    lineTotalUgx,
    originalLineTotalUgx: Math.max(0, Math.floor(Number(line.originalLineTotalUgx ?? lineTotalUgx) || 0)),
    discountUgx: Math.max(0, Math.floor(Number(line.discountUgx) || 0)),
    cogsUgx: Number.isFinite(line.cogsUgx) ? Math.round(line.cogsUgx!) : line.cogsUgx,
    cartDiscountUgx: Number.isFinite(line.cartDiscountUgx) ? Math.round(line.cartDiscountUgx!) : line.cartDiscountUgx,
    netRevenueUgx: Number.isFinite(line.netRevenueUgx) ? Math.round(line.netRevenueUgx!) : line.netRevenueUgx,
    grossProfitUgx: Number.isFinite(line.grossProfitUgx) ? Math.round(line.grossProfitUgx!) : line.grossProfitUgx,
    baseUnit: line.baseUnit?.trim() || undefined,
    estimatedProfitUgx,
    moneyAmountUgx: line.moneyAmountUgx ?? null,
    saleUnitType:
      line.saleUnitType === "tablet" || line.saleUnitType === "strip" || line.saleUnitType === "box"
        ? line.saleUnitType
        : null,
    saleUnitQty: line.saleUnitQty != null && line.saleUnitQty > 0 ? line.saleUnitQty : null,
    voided: line.voided === true,
    voidedAt: line.voidedAt ?? null,
  };
}

function normalizeSale(s: Sale): Sale {
  const lines = (s.lines ?? []).map(normalizeSaleLine);
  const estimatedProfitUgx = Number.isFinite(s.estimatedProfitUgx)
    ? Math.round(s.estimatedProfitUgx)
    : lines.reduce((sum, line) => sum + line.estimatedProfitUgx, 0);
  return repairLegacySaleFinancials({
    ...s,
    status: s.status ?? "completed",
    lines,
    estimatedProfitUgx,
    customerId: s.customerId ?? null,
    soldByUserId: s.soldByUserId ?? null,
    waiterStaffId: s.waiterStaffId ?? null,
    waiterName: s.waiterName ?? null,
    referenceLabel: s.referenceLabel ?? null,
    tableSessionId: s.tableSessionId ?? null,
  });
}

function normalizeSupplier(s: Supplier): Supplier {
  return {
    ...s,
    balanceOwedUgx: typeof s.balanceOwedUgx === "number" ? s.balanceOwedUgx : 0,
    totalPurchasesUgx: typeof s.totalPurchasesUgx === "number" ? s.totalPurchasesUgx : 0,
    phone: s.phone ?? "",
    location: s.location ?? "",
    notes: s.notes ?? "",
    lastSupplyAt: s.lastSupplyAt ?? null,
  };
}

function normalizePurchase(p: Purchase): Purchase {
  return {
    ...p,
    pendingSync: p.pendingSync !== false,
    notes: p.notes ?? "",
    lines: Array.isArray(p.lines) ? p.lines : [],
    voidedAt: p.voidedAt ?? null,
    voidReason: p.voidReason ?? undefined,
  };
}

function normalizeSupplierPayment(p: SupplierPayment): SupplierPayment {
  return {
    ...p,
    pendingSync: p.pendingSync !== false,
    createdByUserId: p.createdByUserId ?? undefined,
    createdByName: p.createdByName ?? undefined,
  };
}

function normalizeStockMovement(m: StockMovement): StockMovement {
  return { ...m, supplierId: m.supplierId ?? null };
}

function normalizeCashExpense(e: CashExpense): CashExpense {
  return {
    ...e,
    description: e.description ?? "",
    pendingSync: e.pendingSync !== false,
    lastSyncError: e.lastSyncError ?? null,
    deletedAt: e.deletedAt ?? null,
    approvalStatus: e.approvalStatus ?? "approved",
    deviceId: e.deviceId ?? undefined,
  };
}

export const usePosStore = create<PosState>((set, get) => {
  const pushAudit = (action: AuditAction, payloadSummary: string, payload: Record<string, unknown>) => {
    const actor = get().sessionActor;
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      deviceId: getOrCreateDeviceId(),
      actorUserId: actor?.userId ?? "unknown",
      actorName: actor?.displayName,
      role: actor?.role ?? "cashier",
      action,
      payloadSummary,
      payload,
    };
    set((s) => ({ auditLogs: mergeAuditLogs(s.auditLogs, [entry]) }));
    logPilotEventFromAudit(action, payloadSummary, payload);
    void queueRemote("audit_log", { entry });
  };

  const denyIfBusinessDateLocked = (dateKey: string, actionLabel: string) => {
    const lock = assertBusinessDateNotLocked(get().dayCloses, dateKey);
    if (!lock.ok) {
      pushAudit("day_close_blocked", `Blocked ${actionLabel} — ${dateKey} closed`, {
        dateKey,
        action: actionLabel,
      });
      return lock;
    }
    return null;
  };

  const denyUnlessEffectivePermission = (permission: Permission, actionLabel: string) => {
    const actor = get().sessionActor;
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const check = checkStorePermissionEffective(actor, permission, snapshot, authMode);
    if (check.ok) return null;
    pushAudit("auth_forbidden", `Denied ${actionLabel}`, {
      permission,
      action: actionLabel,
      attemptedRole: actor?.role ?? null,
      errorKey: check.errorKey,
    });
    return check;
  };

  return {
  _hydrated: false,
  products: [],
  customers: [],
  sales: [],
  preferences: createDefaultPreferences(),
  debtPayments: [],
  dayCloses: [],
  auditLogs: [],
  suppliers: [],
  purchases: [],
  supplierPayments: [],
  stockMovements: [],
  archivedStockMovements: [],
  voidRecords: [],
  returnRecords: [],
  cashExpenses: [],
  cashDrawerAdjustments: [],
  dayDrawerOpens: [],
  inventoryCountSessions: [],
  archivedSales: [],
  archivedAuditLogs: [],
  archivedDayCloses: [],
  archivedVoidRecords: [],
  archivedReturnRecords: [],
  sessionActor: null,
  draftLines: [],
  draftInput: null,
  draftCartDiscountUgx: 0,
  activePendingSaleId: null,
  salesHistoryHydration: null,

  hydrate: (data, opts) =>
    set({
      products: data.products.map(normalizeProduct),
      customers: data.customers.map(normalizeCustomer),
      sales: data.sales.map(normalizeSale),
      preferences: data.preferences,
      debtPayments: data.debtPayments ?? [],
      dayCloses: data.dayCloses ?? [],
      auditLogs: opts?.replaceAudit ? (data.auditLogs ?? []) : mergeAuditLogs(data.auditLogs ?? [], get().auditLogs),
      suppliers: (data.suppliers ?? []).map(normalizeSupplier),
      purchases: (data.purchases ?? []).map(normalizePurchase),
      supplierPayments: (data.supplierPayments ?? []).map(normalizeSupplierPayment),
      ...(() => {
        const merged = mergeStockMovements(
          opts?.replaceAudit ? [] : get().stockMovements,
          data.stockMovements ?? [],
          opts?.replaceAudit ? [] : get().archivedStockMovements ?? [],
        );
        return {
          stockMovements: merged.stockMovements,
          archivedStockMovements: merged.archivedStockMovements,
        };
      })(),
      voidRecords: data.voidRecords ?? [],
      returnRecords: data.returnRecords ?? [],
      cashExpenses: (data.cashExpenses ?? []).map(normalizeCashExpense),
      cashDrawerAdjustments: (data.cashDrawerAdjustments ?? []).map(normalizeCashDrawerAdjustment),
      dayDrawerOpens: (data.dayDrawerOpens ?? []).map(normalizeDayDrawerOpen),
      inventoryCountSessions: (data.inventoryCountSessions ?? []).map(normalizeInventoryCountSession),
      archivedSales: (data.archivedSales ?? []).map(normalizeSale),
      archivedAuditLogs: data.archivedAuditLogs ?? [],
      archivedDayCloses: data.archivedDayCloses ?? [],
      archivedVoidRecords: data.archivedVoidRecords ?? [],
      archivedReturnRecords: data.archivedReturnRecords ?? [],
      _hydrated: true,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    }),

  hydrateEssentials: (data) => {
    const products = data.products.map(normalizeProduct);
    const preferences = preferencesWithDefaultShelfLayout(data.preferences, products);
    set({
      products,
      customers: data.customers.map(normalizeCustomer),
      sales: [],
      preferences,
      debtPayments: [],
      dayCloses: [],
      auditLogs: [],
      suppliers: [],
      purchases: [],
      supplierPayments: [],
      stockMovements: [],
      voidRecords: [],
      returnRecords: [],
      cashExpenses: [],
      cashDrawerAdjustments: [],
      inventoryCountSessions: [],
      archivedSales: [],
      archivedAuditLogs: [],
      archivedDayCloses: [],
      archivedVoidRecords: [],
      archivedReturnRecords: [],
      _hydrated: true,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    });
  },

  hydrateRemainder: (data) =>
    set((s) => ({
      sales: data.sales ? data.sales.map(normalizeSale) : s.sales,
      debtPayments: data.debtPayments ?? s.debtPayments,
      dayCloses: data.dayCloses ?? s.dayCloses,
      auditLogs: mergeAuditLogs(data.auditLogs ?? [], s.auditLogs),
      suppliers: (data.suppliers ?? []).map(normalizeSupplier),
      purchases: (data.purchases ?? []).map(normalizePurchase),
      supplierPayments: (data.supplierPayments ?? []).map(normalizeSupplierPayment),
      ...(() => {
        const merged = mergeStockMovements(
          data.stockMovements ?? [],
          s.stockMovements,
          s.archivedStockMovements ?? [],
        );
        return {
          stockMovements: merged.stockMovements,
          archivedStockMovements: merged.archivedStockMovements,
        };
      })(),
      voidRecords: data.voidRecords ?? s.voidRecords,
      returnRecords: data.returnRecords ?? s.returnRecords,
      cashExpenses: data.cashExpenses ? data.cashExpenses.map(normalizeCashExpense) : s.cashExpenses,
      cashDrawerAdjustments: data.cashDrawerAdjustments
        ? data.cashDrawerAdjustments.map(normalizeCashDrawerAdjustment)
        : s.cashDrawerAdjustments,
      dayDrawerOpens: data.dayDrawerOpens
        ? data.dayDrawerOpens.map(normalizeDayDrawerOpen)
        : s.dayDrawerOpens,
      inventoryCountSessions: data.inventoryCountSessions
        ? data.inventoryCountSessions.map(normalizeInventoryCountSession)
        : s.inventoryCountSessions,
      archivedSales: data.archivedSales ? data.archivedSales.map(normalizeSale) : s.archivedSales,
      archivedAuditLogs: data.archivedAuditLogs ?? s.archivedAuditLogs,
      archivedDayCloses: data.archivedDayCloses ?? s.archivedDayCloses,
      archivedVoidRecords: data.archivedVoidRecords ?? s.archivedVoidRecords,
      archivedReturnRecords: data.archivedReturnRecords ?? s.archivedReturnRecords,
    })),

  applyRestoredSnapshot: (snap) => {
    void applyRestoredSnapshotFromBackup(snap);
  },

  resetForSignOut: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (draftPersistTimer) {
      clearTimeout(draftPersistTimer);
      draftPersistTimer = null;
    }
    set({
      _hydrated: false,
      products: [],
      customers: [],
      sales: [],
      preferences: createDefaultPreferences(),
      debtPayments: [],
      dayCloses: [],
      auditLogs: [],
      suppliers: [],
      purchases: [],
      supplierPayments: [],
      stockMovements: [],
      voidRecords: [],
      returnRecords: [],
      cashExpenses: [],
      cashDrawerAdjustments: [],
      inventoryCountSessions: [],
      archivedSales: [],
      archivedAuditLogs: [],
      archivedDayCloses: [],
      archivedVoidRecords: [],
      archivedReturnRecords: [],
      sessionActor: null,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    });
  },

  applyRemoteInventorySync: (msg) => {
    set((s) => {
      const idx = s.products.findIndex((p) => p.id === msg.productId);
      if (idx === -1) return s;
      const merged = mergeRemoteInventoryStock(s.products[idx]!, {
        newStock: msg.newStock,
        version: msg.version,
        timestamp: msg.timestamp,
      });
      if (!merged) return s;
      const products = [...s.products];
      products[idx] = merged;
      return { products };
    });
  },

  setSessionActor: (actor) => set({ sessionActor: actor }),

  setPreferences: (p, opts) => {
    const state = get();
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const denied = authorizePreferencesPatch(state.sessionActor, p, {
      snapshot,
      authMode,
      currentStaffAccounts: state.preferences.staffAccounts ?? [],
    });
    if (!denied.ok) {
      if (!opts?.silent) {
        pushAudit("auth_forbidden", "Denied setPreferences", {
          permission: requiredPermissionsForPreferencesPatch(p).join(","),
          action: "setPreferences",
          attemptedRole: state.sessionActor?.role ?? null,
          errorKey: denied.errorKey,
          keys: Object.keys(p),
        });
      }
      return;
    }
    if (p.biometricAuthEnabled === true) {
      const pin = p.backOfficePin ?? state.preferences.backOfficePin;
      if (!canEnableBiometricAuth({ backOfficePin: pin })) {
        if (!opts?.silent) {
          pushAudit("auth_forbidden", "Denied biometric enable without Owner PIN", {
            action: "setPreferences",
            attemptedRole: state.sessionActor?.role ?? null,
            errorKey: "biometricRequiresOwnerPin",
            keys: Object.keys(p),
          });
        }
        return;
      }
    }
    set((s) => {
      let merged = { ...s.preferences, ...p };
      const role = s.sessionActor?.role ?? "cashier";
      if (!canTogglePosUiMode(role) && merged.posUiMode === "owner_back_office") {
        merged.posUiMode = "cashier";
      }
      merged = ensureHardwarePrefsOnBootstrap(merged);
      return { preferences: merged };
    });
  },

  addStaffAccount: async (input) => {
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const staffDenied = await authorizeStaffAccountMutationWithDevice(get().sessionActor, {
      authMode,
    });
    if (!staffDenied.ok) {
      pushAudit("auth_forbidden", "Denied addStaffAccount", {
        permission: "settings.shop",
        action: "addStaffAccount",
        attemptedRole: get().sessionActor?.role ?? null,
        errorKey: staffDenied.errorKey,
      });
      return { ok: false, errorKey: staffDenied.errorKey };
    }

    const existing = get().preferences.staffAccounts ?? [];
    const tier = resolveStorePlanTier(snapshot, authMode);
    const staffCap = validateCanAddStaffAccount(existing.length, tier);
    if (!staffCap.ok) {
      pushAudit("auth_forbidden", "Denied addStaffAccount (plan staff limit)", {
        permission: "settings.shop",
        action: "addStaffAccount",
        attemptedRole: get().sessionActor?.role ?? null,
        errorKey: staffCap.errorKey,
      });
      return { ok: false, errorKey: staffCap.errorKey };
    }

    const name = input.name.trim();
    if (!name) return { ok: false, errorKey: "staffNameRequired" };
    const role = normalizeUserRole(input.role);
    if (!role || role === "owner") return { ok: false, errorKey: "staffCreateFail" };
    const pin = normalizePin(input.pin ?? "") || null;
    const password = (input.password ?? "").trim() || null;
    if (!password && pin?.length !== 4) return { ok: false, errorKey: "staffPinMust4" };

    let username = (input.username ?? "").trim().toLowerCase() || null;
    if (!username) username = generateStaffUsername(name, existing);
    else if (existing.some((a) => (a.username ?? "").toLowerCase() === username)) {
      return { ok: false, errorKey: "staffUsernameTaken" };
    }

    const pinHash = pin ? await hashStaffSecretAsync(pin) : null;
    const passwordHash = password ? await hashStaffSecretAsync(password) : null;

    const row: StaffAccount = {
      id: crypto.randomUUID(),
      name,
      username,
      role,
      permissions: input.permissions ?? permissionsForRole(role),
      pin: null,
      password: null,
      pinHash,
      passwordHash,
      phone: (input.phone ?? "").trim() || null,
      email: (input.email ?? "").trim().toLowerCase() || null,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingCloudSync: authMode === "supabase",
    };

    if (authMode === "local") {
      set((s) => ({
        preferences: {
          ...s.preferences,
          staffAccounts: [row, ...(s.preferences.staffAccounts ?? [])],
        },
      }));
      return { ok: true, id: row.id };
    }

    const { createStaffInCloudFirst } = await import("../lib/staffSyncQueue");
    const cloudResult = await createStaffInCloudFirst(row, {
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    });
    if (!cloudResult.ok) {
      if (cloudResult.queued) {
        set((s) => ({
          preferences: {
            ...s.preferences,
            staffAccounts: [{ ...row, pendingCloudSync: true }, ...(s.preferences.staffAccounts ?? [])],
          },
        }));
      }
      return { ok: false, errorKey: cloudResult.errorKey, queued: cloudResult.queued };
    }

    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: [{ ...row, pendingCloudSync: false }, ...(s.preferences.staffAccounts ?? [])],
      },
    }));

    const confirmed = (get().preferences.staffAccounts ?? []).find((a) => a.id === row.id);
    void import("../lib/staffSecurityAudit").then(({ logStaffSecurityAudit }) => {
      logStaffSecurityAudit("staff_account_created", { staffId: confirmed?.id ?? row.id, staffName: row.name, role: row.role });
    });
    return { ok: true, id: confirmed?.id ?? row.id };
  },

  updateStaffAccount: (id, patch) => {
    try {
      assertStaffAccountMutationAllowed(get().sessionActor);
    } catch (e) {
      if (e instanceof StaffAccountAuthorizationError) {
        pushAudit("auth_forbidden", "Denied updateStaffAccount", {
          permission: "settings.shop",
          action: "updateStaffAccount",
          attemptedRole: get().sessionActor?.role ?? null,
          errorKey: e.errorKey,
        });
        return;
      }
      throw e;
    }
    const { authMode } = getStoreSubscriptionContext();
    if (authMode === "supabase" && !isPrimaryDeviceCachedSync()) {
      pushAudit("auth_forbidden", "Denied updateStaffAccount (not primary device)", {
        permission: "settings.shop",
        action: "updateStaffAccount",
        attemptedRole: get().sessionActor?.role ?? null,
        errorKey: "notPrimaryDevice",
      });
      return;
    }
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: (s.preferences.staffAccounts ?? []).map((a) => {
          const nextRole = patch.role !== undefined ? normalizeUserRole(patch.role) : a.role;
          return a.id === id
            ? {
                ...a,
                name: patch.name?.trim() ?? a.name,
                role: nextRole ?? a.role,
                username:
                  patch.username === undefined
                    ? (a.username ?? null)
                    : patch.username.trim().toLowerCase() || null,
                permissions: nextRole ? permissionsForRole(nextRole) : permissionsForRole(a.role),
                phone: patch.phone === undefined ? a.phone : patch.phone.trim() || null,
                active: patch.active ?? a.active,
                updatedAt: new Date().toISOString(),
              }
            : a;
        }),
      },
    }));
    const updated = get().preferences.staffAccounts?.find((a) => a.id === id);
    if (updated && patch.active !== undefined) {
      void import("../lib/staffSecurityAudit").then(({ logStaffSecurityAudit }) => {
        logStaffSecurityAudit(patch.active ? "staff_reactivated" : "staff_suspended", {
          staffId: updated.id,
          staffName: updated.name,
        });
      });
    }
    if (updated) {
      void import("../lib/shopStaffCloud").then(({ pushStaffToCloud }) => pushStaffToCloud(updated));
    }
  },

  removeStaffAccount: (id) => {
    try {
      assertStaffAccountMutationAllowed(get().sessionActor);
    } catch (e) {
      if (e instanceof StaffAccountAuthorizationError) {
        pushAudit("auth_forbidden", "Denied removeStaffAccount", {
          permission: "settings.shop",
          action: "removeStaffAccount",
          attemptedRole: get().sessionActor?.role ?? null,
          errorKey: e.errorKey,
        });
        return;
      }
      throw e;
    }
    const { authMode } = getStoreSubscriptionContext();
    if (authMode === "supabase" && !isPrimaryDeviceCachedSync()) {
      pushAudit("auth_forbidden", "Denied removeStaffAccount (not primary device)", {
        permission: "settings.shop",
        action: "removeStaffAccount",
        attemptedRole: get().sessionActor?.role ?? null,
        errorKey: "notPrimaryDevice",
      });
      return;
    }
    const removed = get().preferences.staffAccounts?.find((a) => a.id === id);
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: (s.preferences.staffAccounts ?? []).filter((a) => a.id !== id),
        activeStaffId: s.preferences.activeStaffId === id ? null : s.preferences.activeStaffId,
      },
    }));
    if (removed) {
      void import("../lib/staffSecurityAudit").then(({ logStaffSecurityAudit }) => {
        logStaffSecurityAudit("staff_account_deleted", { staffId: removed.id, staffName: removed.name });
      });
    }
    void import("../offline/cloudSync").then(async ({ resolveShopCtx }) => {
      const { deleteCloudStaff } = await import("../lib/shopStaffCloud");
      const ctx = await resolveShopCtx();
      if (ctx) await deleteCloudStaff(ctx.shopId, id);
    });
  },

  resetStaffSecret: (id, patch) => {
    try {
      assertStaffAccountMutationAllowed(get().sessionActor);
    } catch (e) {
      if (e instanceof StaffAccountAuthorizationError) {
        pushAudit("auth_forbidden", "Denied resetStaffSecret", {
          permission: "settings.shop",
          action: "resetStaffSecret",
          attemptedRole: get().sessionActor?.role ?? null,
          errorKey: e.errorKey,
        });
        return;
      }
      throw e;
    }
    const { authMode } = getStoreSubscriptionContext();
    if (authMode === "supabase" && !isPrimaryDeviceCachedSync()) {
      pushAudit("auth_forbidden", "Denied resetStaffSecret (not primary device)", {
        permission: "settings.shop",
        action: "resetStaffSecret",
        attemptedRole: get().sessionActor?.role ?? null,
        errorKey: "notPrimaryDevice",
      });
      return;
    }
    void (async () => {
      const pinNorm = patch.pin === undefined ? undefined : normalizePin(patch.pin ?? "") || null;
      const pinHash =
        patch.pin === undefined
          ? undefined
          : pinNorm
            ? await hashStaffSecretAsync(pinNorm)
            : null;
      const passwordHash =
        patch.password === undefined
          ? undefined
          : patch.password?.trim()
            ? await hashStaffSecretAsync(patch.password.trim())
            : null;
      const now = new Date().toISOString();
      set((s) => ({
        preferences: {
          ...s.preferences,
          staffAccounts: (s.preferences.staffAccounts ?? []).map((a) =>
            a.id === id
              ? {
                  ...a,
                  pin: patch.pin === undefined ? a.pin : null,
                  password: patch.password === undefined ? a.password : null,
                  pinHash: pinHash === undefined ? (a.pinHash ?? null) : pinHash,
                  passwordHash: passwordHash === undefined ? (a.passwordHash ?? null) : passwordHash,
                  pinChangedAt: pinHash !== undefined && pinHash ? now : a.pinChangedAt,
                  passwordChangedAt: passwordHash !== undefined && passwordHash ? now : a.passwordChangedAt,
                  updatedAt: now,
                }
              : a,
          ),
        },
      }));
      const updated = get().preferences.staffAccounts?.find((a) => a.id === id);
      if (updated) {
        const { pushStaffToCloud } = await import("../lib/shopStaffCloud");
        await pushStaffToCloud(updated);
        void import("../lib/staffSecurityAudit").then(({ logStaffSecurityAudit }) => {
          if (patch.pin !== undefined) {
            logStaffSecurityAudit("staff_pin_reset", { staffId: updated.id, staffName: updated.name });
          }
          if (patch.password !== undefined) {
            logStaffSecurityAudit("staff_password_reset", { staffId: updated.id, staffName: updated.name });
          }
        });
      }
    })();
  },

  unlockStaffAccount: async (id) => {
    try {
      assertStaffAccountMutationAllowed(get().sessionActor);
    } catch (e) {
      if (e instanceof StaffAccountAuthorizationError) {
        return { ok: false, errorKey: e.errorKey };
      }
      throw e;
    }
    const { authMode } = getStoreSubscriptionContext();
    if (authMode === "supabase" && !isPrimaryDeviceCachedSync()) {
      return { ok: false, errorKey: "notPrimaryDevice" };
    }
    const staffRow = get().preferences.staffAccounts?.find((a) => a.id === id);
    if (!staffRow) return { ok: false, errorKey: "staffCreateFail" };

    const patch = {
      failedPinAttempts: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
      firstFailedLoginAt: null,
      failuresInWindow: 0,
      failureWindowStartedAt: null,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({
      preferences: {
        ...s.preferences,
        staffAccounts: (s.preferences.staffAccounts ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
      },
    }));

    const { resolveShopCtx } = await import("../offline/cloudSync");
    const ctx = await resolveShopCtx();
    if (ctx) {
      const { unlockCloudStaffAccount } = await import("../lib/shopStaffCloud");
      await unlockCloudStaffAccount(ctx.shopId, id);
      const { unlockStaffAccountLocal } = await import("../lib/staffLoginSecurity");
      const { getActiveAccountKey } = await import("../offline/accountScope");
      const accountKey = getActiveAccountKey();
      if (accountKey) {
        await unlockStaffAccountLocal({
          accountKey,
          shopId: ctx.shopId,
          staffId: id,
          staffName: staffRow.name,
        });
      }
    } else {
      void import("../lib/staffSecurityAudit").then(({ logStaffSecurityAudit }) => {
        logStaffSecurityAudit("staff_account_unlocked", { staffId: staffRow.id, staffName: staffRow.name });
      });
    }

    const updated = get().preferences.staffAccounts?.find((a) => a.id === id);
    if (updated) {
      void import("../lib/shopStaffCloud").then(({ pushStaffToCloud }) => pushStaffToCloud(updated));
    }
    return { ok: true };
  },

  switchStaffAccount: (id, opts) => {
    const state = get();
    const prev = state.preferences.activeStaffId ?? null;
    const staff = state.preferences.staffAccounts ?? [];
    if (!opts?.force && prev !== id) {
      const actor = state.sessionActor;
      if (actor) {
        const open = getActiveShiftForActor(state.preferences.shifts, actor.userId);
        if (open) return { ok: false, errorKey: "staffSwitchShiftOpen" };
      }
    }
    if (prev && prev !== id) {
      const prevStaff = staff.find((s) => s.id === prev);
      pushAudit("staff_logout", prevStaff?.name ?? prev, { staffId: prev, staffName: prevStaff?.name });
    }
    set((s) => ({ preferences: { ...s.preferences, activeStaffId: id } }));
    if (id && prev !== id) {
      const nextStaff = staff.find((s) => s.id === id);
      pushAudit("staff_login", nextStaff?.name ?? id, { staffId: id, staffName: nextStaff?.name, role: nextStaff?.role });
    }
    return { ok: true };
  },

  setPosLocked: (locked) => {
    set((s) => ({ preferences: { ...s.preferences, posLocked: locked } }));
  },
  setPilotModeEnabled: (enabled) => {
    set((s) => ({ preferences: { ...s.preferences, pilotModeEnabled: enabled } }));
  },
  acknowledgeOwnerAlert: (alertId) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor || actor.role !== "owner") return;
    const trimmed = String(alertId).trim();
    if (!trimmed) return;
    const next = appendAcknowledgement(state.preferences.ownerAlertAcknowledgements, trimmed, actor.userId);
    set((s) => ({ preferences: { ...s.preferences, ownerAlertAcknowledgements: next } }));
  },
  logAuditAction: (action, summary, payload) => {
    pushAudit(action, summary, payload ?? {});
  },

  beginShift: (openingFloatUgx?: number) => {
    if (isFormulaV2(get().preferences)) {
      return { ok: false, errorKey: "dayDrawerUseVerification" };
    }
    const denied = denyUnlessEffectivePermission("shift.start", "beginShift");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const s = get();
    const actor = s.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const open = s.preferences.shifts?.find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    if (open) return { ok: false, errorKey: "invalid" };
    const floatAmt = openingFloatUgx != null ? Math.max(0, Math.floor(openingFloatUgx)) : 0;
    const row: ShiftRecord = {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      actorName: actor.displayName,
      role: actor.role,
      startAt: new Date().toISOString(),
      endAt: null,
      salesTotalUgx: 0,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 0,
      discountsTotalUgx: 0,
      voidsTotalUgx: 0,
      returnsTotalUgx: 0,
      debtPaymentsTotalUgx: 0,
      countedCashUgx: null,
      cashDifferenceUgx: null,
      openingFloatUgx: floatAmt > 0 ? floatAmt : null,
      verificationStatus: "legacy_unverified",
      pendingSync: true,
      updatedAt: new Date().toISOString(),
    };
    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: [row, ...(st.preferences.shifts ?? [])],
      },
    }));
    pushAudit("shift_start", `Shift start ${actor.displayName ?? actor.userId}`, { shiftId: row.id, actorUserId: actor.userId });
    void queueRemote("pending_shifts", { shiftId: row.id });
    return { ok: true };
  },

  endActiveShift: (actorUserId) => {
    const s = get();
    const actor = s.sessionActor;
    const uid = actorUserId ?? actor?.userId;
    if (!uid) return;
    const open = (s.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === uid);
    if (!open) return;
    const endAt = new Date().toISOString();
    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: (st.preferences.shifts ?? []).map((sh) =>
          sh.id === open.id
            ? {
                ...sh,
                endAt,
                pendingSync: true,
                updatedAt: endAt,
              }
            : sh,
        ),
      },
    }));
    pushAudit("shift_end", `Shift end ${actor?.displayName ?? uid}`, { shiftId: open.id, actorUserId: uid });
    void queueRemote("pending_shifts", { shiftId: open.id });
  },

  completeBusinessOnboarding: (businessType) => {
    const prof = getBusinessProfile(businessType);
    const hospitality = isHospitalityBusinessType(businessType);
    const pharmacy = isPharmacyBusinessType(businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType,
        kioskQuickSell: prof.kioskQuickSellDefault,
        onboardingDone: true,
        onboardingWizardDone: true,
        schemaVersion: 2,
        cashDrawerFormulaVersion: "v2",
        hospitalityModeEnabled: hospitality ? true : s.preferences.hospitalityModeEnabled,
        pharmacyModeEnabled: pharmacy ? true : s.preferences.pharmacyModeEnabled,
        hospitalityFloor: hospitality
          ? (s.preferences.hospitalityFloor ?? defaultHospitalityFloor())
          : s.preferences.hospitalityFloor,
        hospitalityKitchenEnabled: hospitality
          ? (s.preferences.hospitalityKitchenEnabled ??
            defaultKitchenEnabledForBusinessType(businessType))
          : s.preferences.hospitalityKitchenEnabled,
        ...applyIndustryReceiptDefaults(s.preferences, businessType),
      },
    }));
  },

  completeShopOnboardingWizard: (input) => {
    const prof = getBusinessProfile(input.businessType);
    const hospitality = isHospitalityBusinessType(input.businessType);
    const pharmacy = isPharmacyBusinessType(input.businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType: input.businessType,
        shopSellingStyle: input.sellingStyle,
        mixedPackSelling: input.sellingStyle === "mixed",
        kioskQuickSell: prof.kioskQuickSellDefault,
        onboardingDone: true,
        onboardingWizardDone: true,
        schemaVersion: 2,
        cashDrawerFormulaVersion: "v2",
        hospitalityModeEnabled: hospitality ? true : s.preferences.hospitalityModeEnabled,
        pharmacyModeEnabled: pharmacy ? true : s.preferences.pharmacyModeEnabled,
        hospitalityFloor: hospitality
          ? (s.preferences.hospitalityFloor ?? defaultHospitalityFloor())
          : s.preferences.hospitalityFloor,
        hospitalityKitchenEnabled: hospitality
          ? (s.preferences.hospitalityKitchenEnabled ??
            defaultKitchenEnabledForBusinessType(input.businessType))
          : s.preferences.hospitalityKitchenEnabled,
        ...applyIndustryReceiptDefaults(s.preferences, input.businessType),
      },
    }));
  },

  updateBusinessType: (businessType) => {
    const prof = getBusinessProfile(businessType);
    const hospitality = isHospitalityBusinessType(businessType);
    const pharmacy = isPharmacyBusinessType(businessType);
    set((s) => ({
      preferences: {
        ...s.preferences,
        businessType,
        kioskQuickSell: prof.kioskQuickSellDefault,
        schemaVersion: 2,
        cashDrawerFormulaVersion: "v2",
        hospitalityModeEnabled: hospitality ? true : s.preferences.hospitalityModeEnabled,
        pharmacyModeEnabled: pharmacy ? true : s.preferences.pharmacyModeEnabled,
        hospitalityFloor: hospitality
          ? (s.preferences.hospitalityFloor ?? defaultHospitalityFloor())
          : s.preferences.hospitalityFloor,
        hospitalityKitchenEnabled: hospitality
          ? (s.preferences.hospitalityKitchenEnabled ??
            defaultKitchenEnabledForBusinessType(businessType))
          : s.preferences.hospitalityKitchenEnabled,
        ...applyIndustryReceiptDefaults(s.preferences, businessType),
      },
    }));
  },

  setDraftInput: (input) => {
    set({ draftInput: input });
    scheduleDraftPersist(get);
  },

  addDraftLineFromInput: () => {
    const d = get().draftInput;
    if (!d) return { ok: false, errorKey: "noSelection" };
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const tier = resolveStorePlanTier(snapshot, authMode);
    const planCheck = validateProductPlanAccess(d.product.id, get().products, tier);
    if (!planCheck.ok) return { ok: false, errorKey: planCheck.errorKey };
    const built =
      d.pharmacySaleUnit && d.inputMode === "quantity"
        ? buildPharmacySaleLine(d.product, d.pharmacySaleUnit, d.value)
        : buildSaleLine(d.product, d.inputMode, d.value, {
            packSlotStart: resolvePackCostUnitsDepleted(d.product),
          });
    if (!built.line || built.error) {
      return { ok: false, errorKey: built.error ?? "invalid" };
    }
    const existing =
      built.line!.inputMode === "quantity"
        ? get().draftLines.find(
            (l) => l.productId === built.line!.productId && shouldMergeDraftSaleLines(l, built.line!),
          )
        : undefined;
    const nextQty = totalDraftQuantityForProduct(
      get().draftLines,
      built.line!.productId,
      existing,
      built.line!,
    );
    if (draftQuantityExceedsStock(d.product, nextQty)) {
      return { ok: false, errorKey: "noStock" };
    }
    set((state) => {
      if (existing && shouldMergeDraftSaleLines(existing, built.line!)) {
        const merged = mergeDraftSaleLine(existing, built.line!, d.product);
        return {
          draftLines: [
            ...state.draftLines.filter((l) => l !== existing),
            merged,
          ],
          draftInput: null,
        };
      }
      const line = { ...ensureSaleLineId(built.line!), stockVersionAtAdd: d.product.version ?? 1 };
      return {
        draftLines: [...state.draftLines, line],
        draftInput: null,
      };
    });
    scheduleDraftPersist(get);
    return { ok: true };
  },

  removeDraftLine: (productId) => {
    set((s) => ({ draftLines: s.draftLines.filter((l) => l.productId !== productId) }));
    scheduleDraftPersist(get);
  },

  setDraftLineQuantity: (productId, quantity) => {
    const state = get();
    const line = state.draftLines.find((l) => l.productId === productId);
    const product = state.products.find((p) => p.id === productId);
    if (!line || !product) return { ok: false, errorKey: "noSelection" };
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const tier = resolveStorePlanTier(snapshot, authMode);
    const planCheck = validateProductPlanAccess(productId, state.products, tier);
    if (!planCheck.ok) return { ok: false, errorKey: planCheck.errorKey };
    if (quantity <= 0) {
      set((s) => ({ draftLines: s.draftLines.filter((l) => l.productId !== productId) }));
      scheduleDraftPersist(get);
      return { ok: true };
    }
    if (draftQuantityExceedsStock(product, quantity)) {
      return { ok: false, errorKey: "noStock" };
    }
    const next = rebuildDraftLineQuantity(product, quantity, line, resolvePackCostUnitsDepleted(product));
    if (!next) return { ok: false, errorKey: "invalidQty" };
    set((s) => ({
      draftLines: s.draftLines.map((l) => (l.productId === productId ? next : l)),
    }));
    scheduleDraftPersist(get);
    return { ok: true };
  },

  adjustDraftLineQuantity: (productId, delta) => {
    const state = get();
    const line = state.draftLines.find((l) => l.productId === productId);
    const product = state.products.find((p) => p.id === productId);
    if (!line || !product) return { ok: false, errorKey: "noSelection" };
    const nextQty = Math.round((line.quantity + delta) * 10000) / 10000;
    return get().setDraftLineQuantity(productId, nextQty);
  },

  applyDraftLineDiscount: (productId, mode, value) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const line = state.draftLines.find((l) => l.productId === productId);
    if (!line) return { ok: false, errorKey: "noSelection" };
    const next = applyDiscountToLine(line, mode, value);
    if (!next) return { ok: false, errorKey: "invalid" };
    const list = listPriceForLine(line);
    const discountUgx = Math.max(0, list - next.lineTotalUgx);
    const listSubtotal = state.draftLines.reduce((a, l) => a + listPriceForLine(l), 0);
    const lineDiscountTotal = state.draftLines.reduce((sum, l) => {
      if (l.productId === productId) return sum + discountUgx;
      return sum + lineDiscountUgx(l);
    }, 0);
    const policy = validateCombinedDraftDiscount({
      prefs: state.preferences,
      role: actor.role,
      listSubtotalUgx: listSubtotal,
      lineDiscountUgx: lineDiscountTotal,
      cartDiscountUgx: state.draftCartDiscountUgx,
    });
    const sale = state.activePendingSaleId
      ? state.sales.find((s) => s.id === state.activePendingSaleId)
      : undefined;
    const discountApproved = Boolean(sale?.billDraft?.discountApproval?.approvedByUserId);
    if (!discountApproved && !policy.ok) return { ok: false, errorKey: policy.errorKey };
    set((s) => ({
      draftLines: s.draftLines.map((l) => (l.productId === productId ? next : l)),
    }));
    scheduleDraftPersist(get);
    return { ok: true };
  },

  setDraftCartDiscount: (amountUgx) => {
    const state = get();
    const actor = state.sessionActor;
    const lineSubtotal = state.draftLines.reduce((a, l) => a + l.lineTotalUgx, 0);
    const listSubtotal = state.draftLines.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
    const lineDiscountTotal = state.draftLines.reduce((a, l) => a + lineDiscountUgx(l), 0);
    const capped = Math.min(Math.max(0, Math.floor(amountUgx)), lineSubtotal);
    if (actor) {
      const policy = validateCombinedDraftDiscount({
        prefs: state.preferences,
        role: actor.role,
        listSubtotalUgx: listSubtotal,
        lineDiscountUgx: lineDiscountTotal,
        cartDiscountUgx: capped,
      });
      const sale = state.activePendingSaleId
        ? state.sales.find((s) => s.id === state.activePendingSaleId)
        : undefined;
      const discountApproved = Boolean(sale?.billDraft?.discountApproval?.approvedByUserId);
      if (!discountApproved && !policy.ok) return { ok: false, errorKey: policy.errorKey };
    }
    set({ draftCartDiscountUgx: capped });
    scheduleDraftPersist(get);
    return { ok: true };
  },

  clearDraft: () => {
    set({ draftLines: [], draftInput: null, draftCartDiscountUgx: 0, activePendingSaleId: null });
    void clearPersistedDraft();
  },

  ensureHospitalityFloor: () => {
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor);
    if (floor === state.preferences.hospitalityFloor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: floor,
        hospitalityModeEnabled: state.preferences.hospitalityModeEnabled ?? true,
      },
    });
    flushPendingPersist();
  },

  openTable: ({ tableId, guestCount, adultCount, childrenCount, customerName, customerPhone, specialNotes, reservationId, waitlistEntryId }) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "openTable");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const table = floor.tables.find((t) => t.id === tableId);
    if (!table || !table.isActive) return { ok: false, errorKey: "invalid" };
    if (!isTableSeatable(table, floor)) return { ok: false, errorKey: "tableOccupied" };
    if (floor.sessions.some((s) => s.tableId === tableId && (s.status === "open" || s.status === "payment_pending"))) {
      return { ok: false, errorKey: "tableOccupied" };
    }
    const area = floor.areas.find((a) => a.id === table.areaId);
    const saleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const actor = state.sessionActor;
    const referenceLabel = `${table.label}${area ? ` · ${area.name}` : ""}`;
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: [],
      cartDiscountUgx: 0,
      tableSessionId: sessionId,
      referenceLabel,
      soldByUserId: actor?.userId ?? null,
      waiterStaffId: actor?.userId ?? null,
      waiterName: actor?.displayName ?? null,
    });
    let nextFloor = openTableSessionOnFloor({
      floor,
      tableId,
      saleId,
      sessionId,
      guestCount: Math.max(1, guestCount),
      adultCount,
      childrenCount,
      customerName,
      customerPhone,
      specialNotes,
      reservationId: reservationId ?? null,
      waitlistEntryId: waitlistEntryId ?? null,
      waiterStaffId: actor?.userId ?? null,
      waiterLabel: actor?.displayName ?? null,
    });
    if (reservationId) {
      nextFloor = seatReservationOnFloor(nextFloor, reservationId, tableId, sessionId, {
        userId: actor?.userId ?? null,
        label: actor?.displayName ?? null,
      });
    }
    if (waitlistEntryId) {
      nextFloor = seatWaitlistOnFloor(nextFloor, waitlistEntryId, sessionId, {
        userId: actor?.userId ?? null,
        label: actor?.displayName ?? null,
      });
    }
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: {
        ...state.preferences,
        hospitalityFloor: nextFloor,
        activeTableSessionId: sessionId,
      },
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: saleId,
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
    return { ok: true, sessionId };
  },

  openNamedTab: ({ tabLabel, guestCount, customerName, customerPhone }) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "openNamedTab");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const label = tabLabel.trim();
    if (!label) return { ok: false, errorKey: "invalid" };
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const normalized = label.toLowerCase();
    if (
      floor.sessions.some(
        (s) =>
          s.sessionKind === "named_tab" &&
          (s.status === "open" || s.status === "payment_pending") &&
          (s.tabLabel ?? "").trim().toLowerCase() === normalized,
      )
    ) {
      return { ok: false, errorKey: "tableOccupied" };
    }
    const saleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const actor = state.sessionActor;
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: [],
      cartDiscountUgx: 0,
      tableSessionId: sessionId,
      referenceLabel: label,
      soldByUserId: actor?.userId ?? null,
      waiterStaffId: actor?.userId ?? null,
      waiterName: actor?.displayName ?? null,
    });
    const nextFloor = openNamedTabSessionOnFloor({
      floor,
      tabLabel: label,
      saleId,
      sessionId,
      guestCount: guestCount ?? 1,
      customerName,
      customerPhone,
      waiterStaffId: actor?.userId ?? null,
      waiterLabel: actor?.displayName ?? null,
    });
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: {
        ...state.preferences,
        hospitalityFloor: nextFloor,
        activeTableSessionId: sessionId,
      },
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: saleId,
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
    return { ok: true, sessionId };
  },

  resumeTableSession: async (sessionId) => {
    const denied = denyUnlessEffectivePermission("hospitality.order", "resumeTableSession");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const session = floor.sessions.find((s) => s.id === sessionId);
    if (!session || (session.status !== "open" && session.status !== "payment_pending")) {
      return { ok: false, errorKey: "invalid" };
    }
    if (getDeviceOnline() && hasSupabaseConfig) {
      const { refreshPendingSaleFromCloud } = await import("../offline/cloudSync");
      await refreshPendingSaleFromCloud(session.saleId);
    }
    const fresh = get();
    const sale = fresh.sales.find((s) => s.id === session.saleId);
    if (!sale) return { ok: false, errorKey: "missingProduct" };
    set({
      draftLines: sale.lines.map((l) => ({ ...ensureSaleLineId(l) })),
      draftCartDiscountUgx: cartDiscountFromPendingSale(sale),
      activePendingSaleId: sale.id,
      preferences: { ...fresh.preferences, activeTableSessionId: sessionId },
      draftInput: null,
    });
    return { ok: true };
  },

  saveTableBill: () => {
    const denied = denyUnlessEffectivePermission("hospitality.order", "saveTableBill");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const saleId = state.activePendingSaleId;
    if (!saleId) return { ok: false, errorKey: "invalid" };
    const sessionId = state.preferences.activeTableSessionId;
    const existing = state.sales.find((s) => s.id === saleId);
    const baseUpdatedAt = existing?.updatedAt ?? null;
    const draftLines = state.draftLines.map((l) => ensureSaleLineId(l));
    const deletedLineIds = existing ? deletedLineIdsFromDraft(existing.lines, draftLines) : [];
    const floorForWaiter = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const tableWaiter = sessionWaiterAttribution(floorForWaiter, sessionId ?? existing?.tableSessionId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      tableSessionId: sessionId ?? existing?.tableSessionId ?? null,
      referenceLabel: existing?.referenceLabel ?? null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      waiterStaffId: existing?.waiterStaffId ?? tableWaiter.waiterStaffId,
      waiterName: existing?.waiterName ?? tableWaiter.waiterName,
      existing: existing ?? null,
    });
    const manualFire = state.preferences.hospitalityManualKitchenFire === true;
    const priorTicketIds = new Set((state.preferences.hospitalityFloor?.kitchenTickets ?? []).map((t) => t.id));
    let nextFloor = state.preferences.hospitalityFloor;
    if (nextFloor && sessionId && !manualFire) {
      const session = nextFloor.sessions.find((s) => s.id === sessionId);
      if (session) {
        const table = session.tableId ? nextFloor.tables.find((t) => t.id === session.tableId) : undefined;
        const area = table ? nextFloor.areas.find((a) => a.id === table.areaId) : undefined;
        const label = sessionDisplayLabel(session, nextFloor);
        nextFloor = fireKitchenTicketsForLines({
          floor: nextFloor,
          session,
          previousLines: existing?.lines ?? [],
          newLines: pendingSale.lines,
          products: state.products,
          tableLabel: label,
          areaName: area?.name ?? null,
        });
      }
    }
    if (nextFloor && sessionId) {
      const now = new Date().toISOString();
      nextFloor = {
        ...nextFloor,
        sessions: nextFloor.sessions.map((s) =>
          s.id === sessionId ? { ...s, updatedAt: now, pendingSync: true } : s,
        ),
      };
    }
    const newTicketIds = (nextFloor?.kitchenTickets ?? [])
      .filter((t) => !priorTicketIds.has(t.id))
      .map((t) => t.id);
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      draftLines: pendingSale.lines.map((l) => ({ ...l })),
      preferences: nextFloor ? { ...state.preferences, hospitalityFloor: nextFloor } : state.preferences,
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert", baseUpdatedAt, deletedLineIds });
    if (sessionId) queueHospitalityChange({ sessionIds: [sessionId], ticketIds: newTicketIds });
    flushPendingPersist();
    return { ok: true };
  },

  fireTableKitchenTickets: () => {
    return get().fireTableStationTickets([...KITCHEN_FIRE_STATION_TYPES, "bar"]);
  },

  fireTableStationTickets: (stationTypes) => {
    const denied = denyUnlessEffectivePermission("hospitality.order", "fireTableKitchenTickets");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const saleId = state.activePendingSaleId;
    const sessionId = state.preferences.activeTableSessionId;
    if (!saleId || !sessionId) return { ok: false, errorKey: "invalid" };
    const existing = state.sales.find((s) => s.id === saleId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: state.draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      tableSessionId: sessionId,
      referenceLabel: existing?.referenceLabel ?? null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      existing: existing ?? null,
    });
    let nextFloor = state.preferences.hospitalityFloor;
    if (!nextFloor) return { ok: false, errorKey: "invalid" };
    const session = nextFloor.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, errorKey: "invalid" };
    const priorTicketIds = new Set((nextFloor.kitchenTickets ?? []).map((t) => t.id));
    const table = session.tableId ? nextFloor.tables.find((t) => t.id === session.tableId) : undefined;
    const area = table ? nextFloor.areas.find((a) => a.id === table.areaId) : undefined;
    nextFloor = fireKitchenTicketsForLines({
      floor: nextFloor,
      session,
      previousLines: existing?.lines ?? [],
      newLines: pendingSale.lines,
      products: state.products,
      tableLabel: sessionDisplayLabel(session, nextFloor),
      areaName: area?.name ?? null,
      stationTypes,
    });
    const newTicketIds = (nextFloor.kitchenTickets ?? []).filter((t) => !priorTicketIds.has(t.id)).map((t) => t.id);
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: { ...state.preferences, hospitalityFloor: nextFloor },
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId], ticketIds: newTicketIds });
    flushPendingPersist();
    get().enqueueKitchenTicketPrints(newTicketIds, "new");
    return { ok: true, ticketsFired: newTicketIds.length };
  },

  fireTableCourseTickets: (courses) => {
    const denied = denyUnlessEffectivePermission("hospitality.order", "fireTableKitchenTickets");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    if (!courses.length) return { ok: false, errorKey: "invalid" };
    const state = get();
    const saleId = state.activePendingSaleId;
    const sessionId = state.preferences.activeTableSessionId;
    if (!saleId || !sessionId) return { ok: false, errorKey: "invalid" };
    const existing = state.sales.find((s) => s.id === saleId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: state.draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      tableSessionId: sessionId,
      referenceLabel: existing?.referenceLabel ?? null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      existing: existing ?? null,
    });
    let nextFloor = state.preferences.hospitalityFloor;
    if (!nextFloor) return { ok: false, errorKey: "invalid" };
    const session = nextFloor.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, errorKey: "invalid" };
    const priorTicketIds = new Set((nextFloor.kitchenTickets ?? []).map((t) => t.id));
    const table = session.tableId ? nextFloor.tables.find((t) => t.id === session.tableId) : undefined;
    const area = table ? nextFloor.areas.find((a) => a.id === table.areaId) : undefined;
    nextFloor = fireKitchenTicketsForLines({
      floor: nextFloor,
      session,
      previousLines: existing?.lines ?? [],
      newLines: pendingSale.lines,
      products: state.products,
      tableLabel: sessionDisplayLabel(session, nextFloor),
      areaName: area?.name ?? null,
      courses,
    });
    const newTicketIds = (nextFloor.kitchenTickets ?? []).filter((t) => !priorTicketIds.has(t.id)).map((t) => t.id);
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: { ...state.preferences, hospitalityFloor: nextFloor },
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    queueHospitalityChange({ sessionIds: [sessionId], ticketIds: newTicketIds });
    flushPendingPersist();
    get().enqueueKitchenTicketPrints(newTicketIds, "course");
    return { ok: true, ticketsFired: newTicketIds.length };
  },

  requestTableBill: (sessionId) => {
    const denied = denyUnlessEffectivePermission("hospitality.order", "requestTableBill");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const sessions = floor.sessions.map((s) =>
      s.id === sessionId && s.status === "open" ? { ...s, status: "payment_pending" as const } : s,
    );
    const nextFloor = syncTableDisplayStatuses({ ...floor, sessions });
    set({ preferences: { ...state.preferences, hospitalityFloor: nextFloor } });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
  },

  clearActiveTableOrder: () => {
    set({
      activePendingSaleId: null,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      preferences: { ...get().preferences, activeTableSessionId: null },
    });
    void clearPersistedDraft();
  },

  transferTableSession: (sessionId, toTableId) => {
    const denied = denyUnlessEffectivePermission("hospitality.transfer", "transferTableSession");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const session = floor.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, errorKey: "invalid" };
    const { floor: nextFloor, saleReference } = transferSessionToTable(floor, sessionId, toTableId);
    if (!saleReference) return { ok: false, errorKey: "tableOccupied" };
    const existingSale = state.sales.find((s) => s.id === session.saleId);
    const baseUpdatedAt = existingSale?.updatedAt ?? null;
    const sales = state.sales.map((s) =>
      s.id === session.saleId ? { ...s, referenceLabel: saleReference, updatedAt: new Date().toISOString(), pendingSync: true } : s,
    );
    set({ preferences: { ...state.preferences, hospitalityFloor: nextFloor }, sales });
    void queueRemote("pending_sales", {
      saleId: session.saleId,
      kind: "pending_upsert",
      baseUpdatedAt,
    });
    queueHospitalityChange({ sessionIds: [sessionId] });
    flushPendingPersist();
    return { ok: true };
  },

  mergeTableSessions: (sourceSessionId, targetSessionId) => {
    const denied = denyUnlessEffectivePermission("hospitality.transfer", "mergeTableSessions");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const source = floor.sessions.find((s) => s.id === sourceSessionId);
    const target = floor.sessions.find((s) => s.id === targetSessionId);
    if (!source || !target) return { ok: false, errorKey: "invalid" };
    const sourceSale = state.sales.find((s) => s.id === source.saleId);
    const targetSale = state.sales.find((s) => s.id === target.saleId);
    if (!sourceSale || !targetSale) return { ok: false, errorKey: "missingProduct" };
    const mergedLines = mergeSaleLines(targetSale.lines, sourceSale.lines);
    const mergedLineSubtotal = mergedLines.reduce((a, l) => a + l.lineTotalUgx, 0);
    const combinedCartDiscount = Math.min(
      mergedLineSubtotal,
      cartDiscountFromPendingSale(targetSale) + cartDiscountFromPendingSale(sourceSale),
    );
    const updatedTarget = buildPendingSaleFromDraft({
      saleId: targetSale.id,
      lines: mergedLines,
      cartDiscountUgx: combinedCartDiscount,
      tableSessionId: target.id,
      referenceLabel: targetSale.referenceLabel,
      soldByUserId: targetSale.soldByUserId ?? null,
      existing: targetSale,
    });
    const cancelledSource: Sale = { ...sourceSale, status: "cancelled", updatedAt: new Date().toISOString(), pendingSync: true };
    const nextFloor = mergeSessionsOnFloor(floor, sourceSessionId, targetSessionId);
    set({
      sales: [updatedTarget, cancelledSource, ...state.sales.filter((s) => s.id !== targetSale.id && s.id !== sourceSale.id)],
      preferences: { ...state.preferences, hospitalityFloor: nextFloor, activeTableSessionId: targetSessionId },
      draftLines: mergedLines.map((l) => ({ ...ensureSaleLineId(l) })),
      draftCartDiscountUgx: combinedCartDiscount,
      activePendingSaleId: targetSale.id,
    });
    void queueRemote("pending_sales", {
      saleId: targetSale.id,
      kind: "pending_upsert",
      baseUpdatedAt: targetSale.updatedAt ?? null,
    });
    void queueRemote("pending_sales", { saleId: sourceSale.id, kind: "pending_cancel" });
    queueHospitalityChange({ sessionIds: [sourceSessionId, targetSessionId] });
    flushPendingPersist();
    return { ok: true };
  },

  updateKitchenTicketStatus: (ticketId, status) => {
    const denied = denyUnlessEffectivePermission("hospitality.kitchen", "updateKitchenTicketStatus");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: updateKitchenTicketStatus(floor, ticketId, status),
      },
    });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
  },

  advanceKitchenTicket: (ticketId) => {
    const denied = denyUnlessEffectivePermission("hospitality.kitchen", "advanceKitchenTicket");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: advanceKitchenTicketOnFloor(floor, ticketId, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? actor?.userId ?? null,
        }),
      },
    });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
  },

  recallKitchenTicket: (ticketId, reason) => {
    const denied = denyUnlessEffectivePermission("hospitality.kitchen", "recallKitchenTicket");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const role = state.sessionActor?.role;
    const isManager = role === "owner" || role === "manager" || role === "supervisor";
    if (!isManager) return { ok: false, errorKey: "kitchenRecallNeedsManager" };
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const actor = state.sessionActor;
    const next = recallKitchenTicketOnFloor(floor, ticketId, reason, {
      userId: actor?.userId ?? null,
      label: actor?.displayName ?? actor?.userId ?? null,
    });
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
    return { ok: true };
  },

  cancelKitchenTicket: (ticketId) => {
    const denied = denyUnlessEffectivePermission("hospitality.kitchen", "cancelKitchenTicket");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: cancelKitchenTicket(floor, ticketId),
      },
    });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
  },

  cancelKitchenTicketItem: (ticketId, itemId, reason) => {
    const denied = denyUnlessEffectivePermission("hospitality.kitchen", "cancelKitchenTicketItem");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const role = state.sessionActor?.role;
    const isManager = role === "owner" || role === "manager" || role === "supervisor";
    const actor = state.sessionActor;
    const result = cancelKitchenTicketItemOnFloor(floor, ticketId, itemId, reason, {
      userId: actor?.userId ?? null,
      label: actor?.displayName ?? actor?.userId ?? null,
    }, isManager);
    if (!result.ok) return result;
    set({ preferences: { ...state.preferences, hospitalityFloor: result.floor } });
    queueHospitalityChange({ ticketIds: [ticketId] });
    flushPendingPersist();
    return { ok: true };
  },

  cleanupKitchenTickets: () => {
    const denied = denyUnlessEffectivePermission("hospitality.kitchen", "cleanupKitchenTickets");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: pruneServedKitchenTickets(floor),
      },
    });
    flushPendingPersist();
  },

  setHospitalityManualKitchenFire: (enabled) => {
    set((s) => ({
      preferences: { ...s.preferences, hospitalityManualKitchenFire: enabled },
    }));
    flushPendingPersist();
  },

  addDiningArea: (name) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "addDiningArea");
    if (denied) return;
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const next = addDiningArea(floor, name);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  renameDiningArea: (areaId, name) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "renameDiningArea");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const next = renameDiningArea(floor, areaId, name);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  removeDiningArea: (areaId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "removeDiningArea");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const next = removeDiningArea(floor, areaId);
    if (next.tables.length === floor.tables.length && next.areas.length === floor.areas.length) {
      return { ok: false, errorKey: "tableOccupied" };
    }
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  addDiningTable: (input) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "addDiningTable");
    if (denied) return;
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const next = addDiningTable(floor, input);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  updateDiningTable: (tableId, patch) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "updateDiningTable");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const next = updateDiningTable(floor, tableId, patch);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  removeDiningTable: (tableId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "removeDiningTable");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const next = removeDiningTable(floor, tableId);
    if (next.tables.length === floor.tables.length) return { ok: false, errorKey: "tableOccupied" };
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  addKitchenStation: (input) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "addKitchenStation");
    if (denied) return;
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const next = addKitchenStation(floor, input);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  updateKitchenStation: (stationId, patch) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "updateKitchenStation");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const next = updateKitchenStation(floor, stationId, patch);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  removeKitchenStation: (stationId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "removeKitchenStation");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const next = removeKitchenStation(floor, stationId);
    if (next.stations.length === floor.stations.length) return { ok: false, errorKey: "kitchenStationBusy" };
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  createTableReservation: (input) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "createTableReservation");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const actor = state.sessionActor;
    const next = createReservation(floor, input, { userId: actor?.userId ?? null, label: actor?.displayName ?? null });
    const created = (next.reservations ?? []).at(-1);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true, reservationId: created?.id };
  },

  updateTableReservation: (reservationId, patch) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "updateTableReservation");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: updateReservation(floor, reservationId, patch, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  cancelTableReservation: (reservationId, reason) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "cancelTableReservation");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: cancelReservation(floor, reservationId, reason, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  confirmTableReservation: (reservationId) => {
    get().updateTableReservation(reservationId, { status: "confirmed" });
  },

  markReservationNoShow: (reservationId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "markReservationNoShow");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: markReservationNoShowOp(floor, reservationId, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  addWaitlistEntry: (input) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "addWaitlistEntry");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const actor = state.sessionActor;
    const next = addWaitlistEntryOp(floor, input, { userId: actor?.userId ?? null, label: actor?.displayName ?? null });
    const created = (next.waitlist ?? []).at(-1);
    set({ preferences: { ...state.preferences, hospitalityFloor: next } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true, entryId: created?.id };
  },

  cancelWaitlistEntry: (entryId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "cancelWaitlistEntry");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: cancelWaitlistEntryOp(floor, entryId, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  suggestTablesForGuests: (input) => {
    const floor = get().preferences.hospitalityFloor;
    if (!floor) return [];
    return suggestTables({ floor, ...input });
  },

  combineTables: (tableIds) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "combineTables");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const actor = state.sessionActor;
    const result = combineTablesOp(floor, tableIds, { userId: actor?.userId ?? null, label: actor?.displayName ?? null });
    if (!result.ok) return result;
    set({ preferences: { ...state.preferences, hospitalityFloor: result.floor } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  splitCombinedTables: (groupId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "splitCombinedTables");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return { ok: false, errorKey: "invalid" };
    const actor = state.sessionActor;
    const result = splitTablesOp(floor, groupId, { userId: actor?.userId ?? null, label: actor?.displayName ?? null });
    if (!result.ok) return result;
    set({ preferences: { ...state.preferences, hospitalityFloor: result.floor } });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
    return { ok: true };
  },

  lockTable: (tableId, reason, note) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "lockTable");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: lockTableOp(floor, tableId, reason, note, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  unlockTable: (tableId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "unlockTable");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: unlockTableOp(floor, tableId, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  startTableCleaning: (tableId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "startTableCleaning");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: startTableCleaningOp(floor, tableId, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  finishTableCleaning: (tableId) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "finishTableCleaning");
    if (denied) return;
    const state = get();
    const floor = state.preferences.hospitalityFloor;
    if (!floor) return;
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: finishTableCleaningOp(floor, tableId, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  upsertWaiterSection: (section) => {
    const denied = denyUnlessEffectivePermission("hospitality.floor", "upsertWaiterSection");
    if (denied) return;
    const state = get();
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const actor = state.sessionActor;
    set({
      preferences: {
        ...state.preferences,
        hospitalityFloor: upsertWaiterSectionOp(floor, section, {
          userId: actor?.userId ?? null,
          label: actor?.displayName ?? null,
        }),
      },
    });
    queueHospitalityChange({ layout: true });
    flushPendingPersist();
  },

  savePendingSale: (referenceLabel) => {
    const denied = denyUnlessEffectivePermission("pending_sales.manage", "savePendingSale");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const shiftGuard = requireActiveShift(state);
    if (!shiftGuard.ok) return { ok: false, errorKey: shiftGuard.errorKey };
    if (!state.draftLines.length) return { ok: false, errorKey: "emptySale" };
    const saleId = state.activePendingSaleId ?? crypto.randomUUID();
    const existing = state.sales.find((s) => s.id === saleId);
    const pendingSale = buildPendingSaleFromDraft({
      saleId,
      lines: state.draftLines,
      cartDiscountUgx: state.draftCartDiscountUgx,
      referenceLabel: referenceLabel?.trim() || existing?.referenceLabel || null,
      soldByUserId: state.sessionActor?.userId ?? existing?.soldByUserId ?? null,
      existing: existing ?? null,
    });
    set({
      sales: [pendingSale, ...state.sales.filter((s) => s.id !== saleId)],
      activePendingSaleId: saleId,
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
    });
    void clearPersistedDraft();
    void queueRemote("pending_sales", { saleId, kind: "pending_upsert" });
    flushPendingPersist();
    return { ok: true, saleId };
  },

  resumePendingSale: (saleId) => {
    const denied = denyUnlessEffectivePermission("pending_sales.manage", "resumePendingSale");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    if (state.draftLines.length && !state.activePendingSaleId) {
      return { ok: false, errorKey: "invalid" };
    }
    const sale = state.sales.find((s) => s.id === saleId && s.status === "pending");
    if (!sale) return { ok: false, errorKey: "invalid" };
    set({
      draftLines: sale.lines.map((l) => ({ ...l })),
      draftCartDiscountUgx: cartDiscountFromPendingSale(sale),
      activePendingSaleId: sale.id,
      draftInput: null,
      preferences: {
        ...state.preferences,
        activeTableSessionId: sale.tableSessionId ?? null,
      },
    });
    return { ok: true };
  },

  cancelPendingSale: (saleId) => {
    const denied = denyUnlessEffectivePermission("pending_sales.manage", "cancelPendingSale");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    const state = get();
    const sale = state.sales.find((s) => s.id === saleId && s.status === "pending");
    if (!sale) return { ok: false, errorKey: "invalid" };
    const cancelled: Sale = { ...sale, status: "cancelled", updatedAt: new Date().toISOString(), pendingSync: true };
    let nextPrefs = state.preferences;
    if (sale.tableSessionId && nextPrefs.hospitalityFloor) {
      nextPrefs = {
        ...nextPrefs,
        hospitalityFloor: closeTableSession(nextPrefs.hospitalityFloor, sale.tableSessionId, "cancelled"),
        activeTableSessionId:
          nextPrefs.activeTableSessionId === sale.tableSessionId ? null : nextPrefs.activeTableSessionId,
      };
    }
    set({
      sales: [cancelled, ...state.sales.filter((s) => s.id !== saleId)],
      preferences: nextPrefs,
      ...(state.activePendingSaleId === saleId
        ? { activePendingSaleId: null, draftLines: [], draftInput: null, draftCartDiscountUgx: 0 }
        : {}),
    });
    void queueRemote("pending_sales", { saleId, kind: "pending_cancel" });
    flushPendingPersist();
    return { ok: true };
  },

  finalizeDraftSale: ({
    debtUgx,
    customerId: inputCustomerId,
    customerName,
    customerPhone,
    paymentMethod,
    amountPaidUgx,
    changeGivenUgx,
    splitBreakdown,
    serviceChargeUgx: inputServiceChargeUgx,
    tipUgx: inputTipUgx,
    taxUgx: inputTaxUgx,
    billPayments,
  }) => {
    const denied = denyUnlessEffectivePermission("pos.sell", "finalizeDraftSale");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const dateLock = denyIfBusinessDateLocked(dateKeyKampala(new Date()), "finalizeDraftSale");
    if (dateLock) return dateLock;

    const state = get();
    const shiftGuard = requireActiveShift(state);
    if (!shiftGuard.ok) return { ok: false, errorKey: shiftGuard.errorKey };
    if (!state.draftLines.length) return { ok: false, errorKey: "emptySale" };

    const { snapshot, authMode } = getStoreSubscriptionContext();
    const tier = resolveStorePlanTier(snapshot, authMode);
    const lockedCheck = validateDraftLinesPlanAccess(state.draftLines, state.products, tier);
    if (!lockedCheck.ok) return { ok: false, errorKey: lockedCheck.errorKey };

    if (
      isPharmacyMode(state.preferences.businessType, state.preferences.pharmacyModeEnabled) &&
      shouldBlockExpiredSale(state.preferences.pharmacyExpiredSaleBehavior)
    ) {
      for (const line of state.draftLines) {
        const p = state.products.find((x) => x.id === line.productId);
        if (p && isProductExpired(p)) return { ok: false, errorKey: "pharmacyExpiredSaleBlocked" };
      }
    }

    const isFirstSale = state.sales.length === 0;

    const saleLinesPreview = state.draftLines.map((line) => normalizeSaleLine(line));
    const listSubtotal = saleLinesPreview.reduce((a, l) => a + (l.originalLineTotalUgx ?? l.lineTotalUgx), 0);
    const lineSubtotal = saleLinesPreview.reduce((a, l) => a + l.lineTotalUgx, 0);
    const cartDiscount = Math.min(Math.max(0, Math.floor(state.draftCartDiscountUgx)), lineSubtotal);
    const actorRole = state.sessionActor?.role ?? "cashier";
    const lineDiscountTotal = saleLinesPreview.reduce((a, l) => a + lineDiscountUgx(l), 0);
    const discountPolicy = validateCombinedDraftDiscount({
      prefs: state.preferences,
      role: actorRole,
      listSubtotalUgx: listSubtotal,
      lineDiscountUgx: lineDiscountTotal,
      cartDiscountUgx: cartDiscount,
    });
    if (!discountPolicy.ok) return { ok: false, errorKey: discountPolicy.errorKey };

    const regGate = assertCanFinalizeStockSale({
      preferences: state.preferences,
      isOnline: getDeviceOnline(),
      stockFresh: isLocalStockFresh(),
    });
    if (!regGate.ok) return { ok: false, errorKey: regGate.errorKey };

    const baseTotal = Math.max(0, lineSubtotal - cartDiscount);
    const serviceChargeUgx = Math.max(0, Math.floor(inputServiceChargeUgx ?? 0));
    const taxUgx = Math.max(0, Math.floor(inputTaxUgx ?? 0));
    const tipUgx = Math.max(0, Math.floor(inputTipUgx ?? 0));
    const total = baseTotal + serviceChargeUgx + taxUgx + tipUgx;
    const discountTotal = Math.max(0, listSubtotal - baseTotal);
    const debt = Math.min(Math.max(0, Math.floor(debtUgx)), total);
    if (debt > 0) {
      const debtDenied = denyUnlessEffectivePermission("customers.debt", "finalizeDraftSale");
      if (debtDenied) return { ok: false, errorKey: debtDenied.errorKey };
    }
    const cashPaidUgx = total - debt;

    let customers = state.customers;
    let customerId: string | null = inputCustomerId?.trim() || null;
    let createdDebtor: Customer | undefined;
    if (debt > 0) {
      const debtor = resolveDebtorForSale(customers, {
        customerId,
        customerName,
        customerPhone,
      });
      if (!debtor.ok) return { ok: false, errorKey: debtor.errorKey };
      customers = debtor.customers;
      customerId = debtor.customerId;
      createdDebtor = debtor.createdCustomer;
    }

    const stockCheck = validateDraftSaleStockBeforeFinalize(state.draftLines, state.products);
    if (!stockCheck.ok) return { ok: false, errorKey: stockCheck.errorKey };

    const ingredientReq = requirementsFromSaleLines(state.draftLines, state.products);
    const ingredientShortages = checkIngredientAvailability(ingredientReq, state.products);
    if (ingredientShortages.length > 0) return { ok: false, errorKey: "ingredientShortage" };

    const products = [...state.products];
    const preCartLines: SaleLine[] = [];
    const finalizeAt = new Date().toISOString();
    for (const line of state.draftLines) {
      const idx = products.findIndex((p) => p.id === line.productId);
      if (idx === -1) return { ok: false, errorKey: "missingProduct" };
      const p = products[idx]!;
      const moneyLine = ensureMoneySaleQuantity(line, p);
      const conflict = detectSaleStockConflict({
        productId: p.id,
        productName: p.name,
        stockOnHand: p.stockOnHand,
        quantity: moneyLine.quantity,
        minimumStockAlert: p.minimumStockAlert,
      });
      if (conflict) logInventoryConflict(conflict);
      const deductFinished = shouldDeductFinishedProductStock(p);
      const next = deductFinished ? p.stockOnHand - moneyLine.quantity : p.stockOnHand;
      if (deductFinished && next < -0.0001) return { ok: false, errorKey: "noStock" };
      const slotStart = resolvePackCostUnitsDepleted(p);
      const slotCosts = applyPackSlotCostsToSaleLine(p, moneyLine, slotStart);
      const cogsUgx = lineCostUgx(slotCosts.unitCostUgx, moneyLine.quantity);
      preCartLines.push(
        normalizeSaleLine({
          ...moneyLine,
          unitCostUgx: slotCosts.unitCostUgx,
          cogsUgx,
          baseUnit: p.baseUnit?.trim() || undefined,
          estimatedProfitUgx: lineProfitUgx(moneyLine.lineTotalUgx, cogsUgx),
        }),
      );
      products[idx] = {
        ...p,
        stockOnHand: deductFinished ? Math.max(0, next) : p.stockOnHand,
        packCostUnitsDepleted: deductFinished
          ? advancePackCostUnitsDepleted(p.packCostUnitsDepleted, moneyLine.quantity)
          : p.packCostUnitsDepleted,
        updatedAt: finalizeAt,
        version: deductFinished ? p.version + 1 : p.version,
      };
    }

    const recipeDeduction = applyRecipeStockDeduction(products, ingredientReq);
    for (let i = 0; i < recipeDeduction.products.length; i++) {
      const updated = recipeDeduction.products[i]!;
      const idx = products.findIndex((x) => x.id === updated.id);
      if (idx >= 0) products[idx] = updated;
    }

    const saleLines = applyCartDiscountSnapshot(preCartLines, cartDiscount);
    const estimatedProfitUgx = saleEstimatedProfitUgx(saleLines);

    const actorId = state.sessionActor?.userId ?? null;
    const actor = state.sessionActor;
    const todayKey = dateKeyKampala(new Date());
    const receiptSeq = scanTodaySalesHead(state.sales, todayKey).nextReceiptSeq;
    const pendingId = state.activePendingSaleId;
    const existingPending = pendingId ? state.sales.find((s) => s.id === pendingId && s.status === "pending") : null;
    const floor = ensureHospitalityFloor(state.preferences.hospitalityFloor ?? undefined);
    const sessionWaiter = sessionWaiterAttribution(floor, existingPending?.tableSessionId);
    const receiptSnap = buildReceiptBrandingSnapshot(state.preferences, receiptSnapshotPlanTier(state.preferences));
    const debtorCustomer =
      customerId && debt > 0 ? customers.find((c) => c.id === customerId) : null;
    const sale: Sale = {
      id: existingPending?.id ?? crypto.randomUUID(),
      status: "completed",
      referenceLabel: existingPending?.referenceLabel ?? null,
      tableSessionId: existingPending?.tableSessionId ?? null,
      updatedAt: new Date().toISOString(),
      receiptSeq,
      receiptHeaderSnapshot: receiptSnap.header,
      receiptFooterSnapshot: receiptSnap.footer,
      receiptCustomerName: debtorCustomer?.name?.trim() || (customerName?.trim() || null),
      receiptCustomerPhone: debtorCustomer?.phone?.trim() || (customerPhone?.trim() || null),
      lines: saleLines,
      subtotalUgx: listSubtotal,
      totalUgx: total,
      cashPaidUgx,
      debtUgx: debt,
      discountTotalUgx: discountTotal,
      voidedTotalUgx: 0,
      estimatedProfitUgx,
      createdAt: existingPending?.createdAt ?? new Date().toISOString(),
      pendingSync: true,
      lastSyncError: null,
      customerId: customerId ?? null,
      soldByUserId: actorId,
      waiterStaffId:
        existingPending?.waiterStaffId ?? sessionWaiter.waiterStaffId ?? null,
      waiterName: existingPending?.waiterName ?? sessionWaiter.waiterName ?? null,
      splitBreakdown: splitBreakdown ?? null,
      serviceChargeUgx: serviceChargeUgx > 0 ? serviceChargeUgx : null,
      tipUgx: tipUgx > 0 ? tipUgx : null,
      taxUgx: taxUgx > 0 ? taxUgx : null,
      billPayments: billPayments?.length ? billPayments : null,
      paymentMethod: paymentMethod ?? (debt > 0 ? (cashPaidUgx > 0 ? "mixed" : "credit") : "cash"),
      amountPaidUgx: Number.isFinite(amountPaidUgx) ? Math.max(0, Math.floor(amountPaidUgx ?? 0)) : cashPaidUgx,
      changeGivenUgx: Number.isFinite(changeGivenUgx) ? Math.max(0, Math.floor(changeGivenUgx ?? 0)) : 0,
    };

    if (customerId && debt > 0) {
      customers = customers.map((c) =>
        c.id === customerId
          ? { ...c, debtBalanceUgx: c.debtBalanceUgx + debt, version: c.version + 1 }
          : c,
      );
    }

    const shopKey = inventoryMovementNamespace();
    const saleMovements: StockMovement[] = saleStockMovementsFromSale(shopKey, {
      id: sale.id,
      createdAt: sale.createdAt,
      lines: saleLines,
    });

    const auditEntries: AuditLogEntry[] = [];
    const buildAudit = (action: AuditAction, payloadSummary: string, payload: Record<string, unknown>): AuditLogEntry => ({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      deviceId: getOrCreateDeviceId(),
      actorUserId: actor?.userId ?? "unknown",
      actorName: actor?.displayName,
      role: actor?.role ?? "cashier",
      action,
      payloadSummary,
      payload,
    });
    auditEntries.push(
      buildAudit("sale_completed", `Sale UGX ${total.toLocaleString()}`, {
        saleId: sale.id,
        totalUgx: total,
        debtUgx: debt,
        customerId: customerId ?? null,
        soldByUserId: actorId,
        lineCount: sale.lines.length,
        firstLineName: sale.lines[0]?.name ?? null,
      }),
    );
    if (createdDebtor) {
      auditEntries.push(
        buildAudit("customer_add", createdDebtor.name, {
          customerId: createdDebtor.id,
          name: createdDebtor.name,
          source: "debt_sale",
        }),
      );
    }
    if (discountTotal > 0) {
      auditEntries.push(
        buildAudit("discount_given", `Discount UGX ${discountTotal.toLocaleString()}`, {
          saleId: sale.id,
          discountUgx: discountTotal,
          soldByUserId: actorId,
        }),
      );
    }

    let nextPreferences = state.preferences;
    const closedSessionId = existingPending?.tableSessionId ?? null;
    if (closedSessionId && nextPreferences.hospitalityFloor) {
      nextPreferences = {
        ...nextPreferences,
        hospitalityFloor: closeTableSession(nextPreferences.hospitalityFloor, closedSessionId, "closed", {
          needsCleaning: true,
        }),
        activeTableSessionId: null,
      };
    }
    if (actor) {
      nextPreferences = {
        ...nextPreferences,
        shifts: (nextPreferences.shifts ?? []).map((sh) =>
          !sh.endAt && sh.actorUserId === actor.userId
            ? {
                ...sh,
                salesTotalUgx: sh.salesTotalUgx + total,
                debtTotalUgx: sh.debtTotalUgx + debt,
                estimatedCashUgx: sh.estimatedCashUgx + cashPaidUgx,
                discountsTotalUgx: (sh.discountsTotalUgx ?? 0) + discountTotal,
              }
            : sh,
        ),
      };
    }

    set({
      products,
      sales: [sale, ...state.sales.filter((s) => s.id !== sale.id)],
      draftLines: [],
      draftInput: null,
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      customers,
      ...movementMergePatch(state, saleMovements),
      preferences: nextPreferences,
      auditLogs: mergeAuditLogs(state.auditLogs, auditEntries),
    });

    void queueRemote("pending_sales", { saleId: sale.id });
    void import("../lib/posPushScheduler").then(({ schedulePushPendingUploads }) => schedulePushPendingUploads());
    if (closedSessionId) queueHospitalityChange({ sessionIds: [closedSessionId] });
    for (const entry of auditEntries) {
      void queueRemote("audit_log", { entry });
    }
    void clearPersistedDraft();
    const stockChangedForBroadcast = products.filter((p) => {
      const old = state.products.find((x) => x.id === p.id);
      return old != null && old.stockOnHand !== p.stockOnHand;
    });
    if (stockChangedForBroadcast.length > 0) {
      broadcastInventoryStock(stockChangedForBroadcast, "sale_completed");
    }
    void import("../offline/entityStore").then(({ putEntity, putEntitiesBatch }) => {
      void putEntity("sale", sale.id, sale, sale.createdAt);
      const stockChanged = products.filter((p) => {
        const old = state.products.find((x) => x.id === p.id);
        return old != null && old.stockOnHand !== p.stockOnHand;
      });
      if (stockChanged.length > 0) {
        void putEntitiesBatch(
          "product",
          stockChanged.map((p) => ({ id: p.id, data: p, sortKey: p.updatedAt })),
        );
      }
      if (createdDebtor) {
        void putEntity("customer", createdDebtor.id, customers.find((x) => x.id === createdDebtor!.id) ?? createdDebtor, createdDebtor.createdAt);
        void queueRemote("customer", { id: createdDebtor.id });
      }
      if (customerId && debt > 0 && !createdDebtor) {
        const c = customers.find((x) => x.id === customerId);
        if (c) void putEntity("customer", c.id, c, c.createdAt);
        void queueRemote("customer", { id: customerId });
      }
    });
    flushPendingPersist();
    return { ok: true, firstSale: isFirstSale, saleId: sale.id };
  },

  voidSaleLine: ({ saleId, lineIndex, reason, note }) => {
    const denied = denyUnlessEffectivePermission("sale_void", "voidSaleLine");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const saleIdx = state.sales.findIndex((s) => s.id === saleId);
    if (saleIdx === -1) return { ok: false, errorKey: "missingProduct" };
    const saleForLock = state.sales[saleIdx]!;
    const saleDayKey = dateKeyKampala(saleForLock.createdAt);
    const dateLock = denyIfBusinessDateLocked(saleDayKey, "voidSaleLine");
    if (dateLock) return dateLock;

    const shiftGuard = requireActiveShift(state);
    if (!shiftGuard.ok) return { ok: false, errorKey: shiftGuard.errorKey };
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const sale = saleForLock;
    const line = sale.lines[lineIndex];
    if (!line || line.voided) return { ok: false, errorKey: "invalid" };

    const amount = line.lineTotalUgx;
    const cashReduce = Math.min(amount, sale.cashPaidUgx);
    const debtReduce = creditDebtReductionFromSaleAdjustment(sale, amount);
    const openShift = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    const at = new Date().toISOString();

    const voidRec: VoidRecord = {
      id: crypto.randomUUID(),
      saleId,
      lineIndex,
      productId: line.productId,
      productName: line.name,
      quantity: line.quantity,
      amountUgx: amount,
      reason,
      note: note?.trim() || undefined,
      actorUserId: actor.userId,
      actorName: actor.displayName,
      shiftId: openShift?.id ?? null,
      createdAt: at,
    };

    const totals = reduceSaleTotalsByAmount(sale, amount);
    const updatedLines = sale.lines.map((l, i) => (i === lineIndex ? { ...l, voided: true, voidedAt: at } : l));
    const updatedSale: Sale = {
      ...sale,
      ...totals,
      lines: updatedLines,
      estimatedProfitUgx: Math.max(0, sale.estimatedProfitUgx - line.estimatedProfitUgx),
      pendingSync: true,
    };

    const products = [...state.products];
    const pIdx = products.findIndex((p) => p.id === line.productId);
    const preVoidProduct = pIdx >= 0 ? products[pIdx]! : null;
    if (pIdx >= 0) {
      const p = products[pIdx]!;
      products[pIdx] = {
        ...p,
        stockOnHand: p.stockOnHand + line.quantity,
        packCostUnitsDepleted: hasPackCostAllocation(p)
          ? retractPackCostUnitsDepleted(p.packCostUnitsDepleted, line.quantity)
          : p.packCostUnitsDepleted,
        updatedAt: at,
        version: p.version + 1,
      };
    }

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId: line.productId,
      productName: line.name,
      deltaBaseUnits: line.quantity,
      kind: "adjust_other",
      summary: `Void +${line.quantity}`,
      refId: voidRec.id,
      supplierId: null,
    };

    const sales = [...state.sales];
    sales[saleIdx] = updatedSale;
    const customers = applyCustomerDebtDelta(state.customers, sale.customerId, -debtReduce);

    set({
      sales,
      products,
      customers,
      voidRecords: [voidRec, ...state.voidRecords],
      ...movementMergePatch(state, [movement]),
    });

    if (openShift) {
      set((st) => ({
        preferences: {
          ...st.preferences,
          shifts: (st.preferences.shifts ?? []).map((sh) =>
            sh.id === openShift.id
              ? {
                  ...sh,
                  estimatedCashUgx: Math.max(0, sh.estimatedCashUgx - cashReduce),
                  voidsTotalUgx: (sh.voidsTotalUgx ?? 0) + amount,
                  refundsUgx: sh.refundsUgx + amount,
                }
              : sh,
          ),
        },
      }));
    }

    pushAudit("sale_void", `Void ${line.name} UGX ${amount.toLocaleString()}`, {
      voidId: voidRec.id,
      saleId,
      productName: line.name,
      amountUgx: amount,
      reason,
      note: note ?? null,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_stock_updates", {
      productId: line.productId,
      delta: line.quantity,
      note: "void",
      baseUpdatedAt: preVoidProduct?.updatedAt ?? at,
      baseStockOnHand: preVoidProduct?.stockOnHand,
    });
    void queueRemote("sale", { saleId });
    if (sale.customerId && debtReduce > 0) {
      void queueRemote("customer", { id: sale.customerId });
    }
    if (pIdx >= 0) {
      broadcastInventoryStock([products[pIdx]!], "sale_void");
    }
    return { ok: true };
  },

  returnProduct: ({ saleId, productId, quantity, refundAmountUgx, reason, note }) => {
    const denied = denyUnlessEffectivePermission("sale_void", "returnProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const dateLock = denyIfBusinessDateLocked(dateKeyKampala(new Date()), "returnProduct");
    if (dateLock) return dateLock;

    const state = get();
    const shiftGuard = requireActiveShift(state);
    if (!shiftGuard.ok) return { ok: false, errorKey: shiftGuard.errorKey };
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const qty = Math.max(0, Number(quantity) || 0);
    const refund = Math.max(0, Math.floor(refundAmountUgx));
    if (qty <= 0 || refund <= 0) return { ok: false, errorKey: "invalid" };

    const saleIdxPrecheck = saleId ? state.sales.findIndex((s) => s.id === saleId) : -1;
    const auth = validateReturnAuthorization({
      role: actor.role,
      saleId: saleId ?? null,
      saleFound: saleIdxPrecheck >= 0,
      note: note ?? "",
    });
    if (!auth.ok) return { ok: false, errorKey: auth.errorKey };

    const product = state.products.find((p) => p.id === productId);
    if (!product) return { ok: false, errorKey: "missingProduct" };

    const openShift = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    const at = new Date().toISOString();

    const linkedSale = saleId ? state.sales.find((s) => s.id === saleId) : undefined;
    const saleLine = findSaleLineForReturn(linkedSale, productId);
    const returnCogsUgx = saleLine
      ? resolveReturnCogsFromSaleLine(saleLine, qty)
      : Math.round(qty * normalizeUnitCostUgx(product.costPricePerUnitUgx));
    const returnUnitCostUgx = saleLine
      ? normalizeUnitCostUgx(saleLine.unitCostUgx)
      : normalizeUnitCostUgx(product.costPricePerUnitUgx);

    const returnRec: ReturnRecord = {
      id: crypto.randomUUID(),
      saleId: saleId ?? null,
      productId,
      productName: product.name,
      quantity: qty,
      refundAmountUgx: refund,
      cogsUgx: returnCogsUgx,
      unitCostUgx: returnUnitCostUgx,
      reason,
      note: note?.trim() || undefined,
      actorUserId: actor.userId,
      actorName: actor.displayName,
      shiftId: openShift?.id ?? null,
      createdAt: at,
    };

    const restock = returnRestocksInventory(reason);

    const products = state.products.map((p) =>
      p.id === productId && restock
        ? {
            ...p,
            stockOnHand: p.stockOnHand + qty,
            packCostUnitsDepleted: hasPackCostAllocation(p)
              ? retractPackCostUnitsDepleted(p.packCostUnitsDepleted, qty)
              : p.packCostUnitsDepleted,
            updatedAt: at,
            version: p.version + 1,
          }
        : p,
    );

    const movement: StockMovement | null = restock
      ? {
          id: crypto.randomUUID(),
          at,
          productId,
          productName: product.name,
          deltaBaseUnits: qty,
          kind: "adjust_other",
          summary: `Return +${qty}`,
          refId: returnRec.id,
          supplierId: null,
        }
      : null;

    let sales = state.sales;
    let customers = state.customers;
    let debtReduce = 0;
    let linkedCustomerId: string | null = null;
    let cashReduce = refund;
    if (saleId) {
      const saleIdx = sales.findIndex((s) => s.id === saleId);
      if (saleIdx >= 0) {
        const sale = sales[saleIdx]!;
        cashReduce = cashReduceFromRefund(sale, refund);
        const limit = validateReturnAgainstSale({
          sale,
          productId,
          quantity: qty,
          refundAmountUgx: refund,
          returnRecords: state.returnRecords,
        });
        if (!limit.ok) return { ok: false, errorKey: limit.errorKey };
        linkedCustomerId = sale.customerId ?? null;
        debtReduce = creditDebtReductionFromSaleAdjustment(sale, refund);
        const totals = reduceSaleTotalsByAmount(sale, refund);
        const updated: Sale = { ...sale, ...totals, pendingSync: true };
        customers = applyCustomerDebtDelta(customers, sale.customerId, -debtReduce);
        sales = [...sales];
        sales[saleIdx] = updated;
      }
    }

    set({
      products,
      sales,
      customers,
      returnRecords: [returnRec, ...state.returnRecords],
      ...(movement ? movementMergePatch(state, [movement]) : {}),
    });

    if (openShift) {
      set((st) => ({
        preferences: {
          ...st.preferences,
          shifts: (st.preferences.shifts ?? []).map((sh) =>
            sh.id === openShift.id
              ? {
                  ...sh,
                  estimatedCashUgx: Math.max(0, sh.estimatedCashUgx - cashReduce),
                  returnsTotalUgx: (sh.returnsTotalUgx ?? 0) + refund,
                  refundsUgx: sh.refundsUgx + refund,
                }
              : sh,
          ),
        },
      }));
    }

    pushAudit("sale_return", `Return ${product.name} UGX ${refund.toLocaleString()}`, {
      returnId: returnRec.id,
      saleId: saleId ?? null,
      productName: product.name,
      quantity: qty,
      refundUgx: refund,
      reason,
      note: note ?? null,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_returns", {
      returnId: returnRec.id,
      saleId: saleId ?? null,
      productId,
      quantity: qty,
      refundAmountUgx: refund,
    });
    if (linkedCustomerId && debtReduce > 0) {
      void queueRemote("customer", { id: linkedCustomerId });
    }
    if (restock) {
      const updated = get().products.find((p) => p.id === productId);
      if (updated) broadcastInventoryStock([updated], "sale_return");
    }
    return { ok: true, returnRecord: returnRec };
  },

  closeShiftWithCashCount: (countedCashUgx, handoffFloatUgx) => {
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const closeGuard = assertCanCloseShift(state);
    if (!closeGuard.ok) return { ok: false, errorKey: closeGuard.errorKey };

    if (isFormulaV2(state.preferences)) {
      const { closeShiftWithHandoff } = createDayDrawerOpenStoreActions({
        get,
        set,
        pushAudit,
        queueRemote,
        denyUnlessEffectivePermission,
      });
      return closeShiftWithHandoff({
        countedCashUgx,
        handoffFloatUgx: handoffFloatUgx ?? countedCashUgx,
      });
    }

    const denied = denyUnlessEffectivePermission("shift.close", "closeShiftWithCashCount");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const open = (state.preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId);
    if (!open) return { ok: false, errorKey: "invalid" };
    const expected = shiftExpectedCash(open, { formulaVersion: "v1" });
    const counted = Math.max(0, Math.floor(countedCashUgx));
    const differenceUgx = counted - expected;
    const endAt = new Date().toISOString();

    set((st) => ({
      preferences: {
        ...st.preferences,
        shifts: (st.preferences.shifts ?? []).map((sh) =>
          sh.id === open.id
            ? {
                ...sh,
                endAt,
                countedCashUgx: counted,
                cashDifferenceUgx: differenceUgx,
                pendingSync: true,
                updatedAt: endAt,
              }
            : sh,
        ),
      },
    }));

    pushAudit("shift_close_count", `Shift close · expected UGX ${expected.toLocaleString()} · counted UGX ${counted.toLocaleString()}`, {
      shiftId: open.id,
      expectedCashUgx: expected,
      countedCashUgx: counted,
      differenceUgx,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_shifts", { shiftId: open.id });
    return { ok: true, differenceUgx };
  },

  quickAddProduct: (input) => {
    const denied = denyUnlessEffectivePermission("products.add", "quickAddProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, errorKey: "invalid" };
    const hint = (input.inferName ?? trimmed).trim();
    const prefs = get().preferences;
    const guess = inferProductGuess(hint, prefs.businessType, prefs.pharmacyModeEnabled);
    const sellingMode = input.sellingMode ?? guess.sellingMode;
    const baseUnit = (input.baseUnit ?? guess.baseUnit).trim() || "ea";
    const buyingUnit = input.buyingUnit !== undefined ? input.buyingUnit : guess.buyingUnit;
    const conversionRate = input.conversionRate !== undefined ? input.conversionRate : guess.conversionRate;
    const price = Math.max(0, Math.floor(input.priceUgx));
    if (price <= 0) return { ok: false, errorKey: "invalid" };
    const stock = Math.max(0, Number(input.stockQty) || 0);
    const pharmacyRequiresBuy = pharmacyQuickAddRequiresBuyPrice(prefs.businessType, prefs.pharmacyModeEnabled);
    if (pharmacyRequiresBuy && stock <= 0) return { ok: false, errorKey: "pharmacyOpeningStockRequired" };
    const costExplicit =
      input.costPricePerUnitUgx !== undefined && input.costPricePerUnitUgx !== null
        ? normalizeUnitCostUgx(input.costPricePerUnitUgx)
        : null;
    if (pharmacyRequiresBuy) {
      if (costExplicit === null || costExplicit <= 0) return { ok: false, errorKey: "pharmacyBuyPriceRequired" };
    }
    const cost =
      costExplicit !== null ? costExplicit : Math.min(price, Math.max(0, Math.floor(price * 0.72)));
    const minAlert =
      input.minimumStockAlert !== undefined
        ? Math.max(0, Math.floor(input.minimumStockAlert))
        : sellingMode === "portion"
          ? 1
          : sellingMode === "weighted"
            ? 3
            : 5;
    const presetMoney = input.quickPresetsMoneyUgx?.filter((x) => x > 0);
    const presetQty = input.quickPresetsQty?.filter((x) => x > 0);
    const sameShape =
      sellingMode === guess.sellingMode &&
      baseUnit === guess.baseUnit &&
      !presetMoney?.length &&
      !presetQty?.length;
    get().addProduct({
      name: trimmed,
      sellingMode,
      baseUnit,
      buyingUnit,
      conversionRate,
      sellingPricePerUnitUgx: price,
      costPricePerUnitUgx: cost,
      buyingPackCostUgx:
        input.buyingPackCostUgx != null && input.buyingPackCostUgx > 0
          ? Math.floor(input.buyingPackCostUgx)
          : null,
      stockOnHand: stock,
      minimumStockAlert: minAlert,
      category: input.category,
      sku: `SKU-${Date.now()}`,
      medicineStrength: normalizeMedicineStrength(input.medicineStrength ?? null),
      medicineForm: normalizeMedicineForm(input.medicineForm ?? null),
      expiryDate: normalizeExpiryDate(input.expiryDate ?? null),
      pharmacyPackaging: input.pharmacyPackaging ?? null,
      quickPresetsMoneyUgx: presetMoney?.length ? presetMoney : sameShape ? guess.quickPresetsMoneyUgx : undefined,
      quickPresetsQty: presetQty?.length ? presetQty : sameShape ? guess.quickPresetsQty : undefined,
    });
    return { ok: true };
  },

  bulkQuickAddProducts: (rows) => {
    let added = 0;
    let skipped = 0;
    const cat = rows[0]?.category ?? "General";
    for (const row of rows) {
      const r = get().quickAddProduct({
        name: row.name,
        priceUgx: row.priceUgx,
        stockQty: row.stockQty,
        category: row.category || cat,
        inferName: row.inferName,
        sellingMode: row.sellingMode,
        baseUnit: row.baseUnit,
        medicineStrength: row.medicineStrength ?? null,
        medicineForm: row.medicineForm ?? null,
      });
      if (r.ok) added += 1;
      else skipped += 1;
    }
    if (added > 0) {
      pushAudit("product_add", `Bulk added ${added} products`, {
        bulk: true,
        added,
        skipped,
        category: cat,
      });
    }
    return { added, skipped };
  },

  duplicateProduct: (productId, nameSuffix) => {
    const denied = denyUnlessEffectivePermission("products.add", "duplicateProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const tier = resolveStorePlanTier(snapshot, authMode);
    const cap = validateCanAddProduct(state.products.length, tier);
    if (!cap.ok) return { ok: false, errorKey: cap.errorKey };

    const p = state.products.find((x) => x.id === productId);
    if (!p) return { ok: false, errorKey: "missingProduct" };
    get().addProduct({
      name: `${p.name}${nameSuffix}`,
      sellingMode: p.sellingMode,
      baseUnit: p.baseUnit,
      buyingUnit: p.buyingUnit,
      conversionRate: p.conversionRate,
      sellingPricePerUnitUgx: p.sellingPricePerUnitUgx,
      costPricePerUnitUgx: p.costPricePerUnitUgx,
      stockOnHand: p.stockOnHand,
      minimumStockAlert: p.minimumStockAlert,
      category: p.category,
      sku: `SKU-${Date.now()}`,
      quickPresetsMoneyUgx: p.quickPresetsMoneyUgx,
      quickPresetsQty: p.quickPresetsQty,
      expiryDate: p.expiryDate ?? null,
      medicineStrength: p.medicineStrength ?? null,
      medicineForm: p.medicineForm ?? null,
    });
    return { ok: true };
  },

  removeProduct: (productId, reason) => {
    const denied = denyUnlessEffectivePermission("products.remove", "removeProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    if (!validateAuditReason(reason)) return { ok: false, errorKey: auditReasonErrorKey() };

    const auditReason = normalizeAuditReason(reason);
    const p = get().products.find((x) => x.id === productId);
    set((s) => ({ products: s.products.filter((x) => x.id !== productId) }));
    void import("../offline/incrementalPersist").then((m) => m.markProductDeleted(productId));
    void queueRemote("product", { id: productId, deleted: true });
    pushAudit("product_remove", p?.name ?? productId, {
      productId,
      name: p?.name,
      stock: p?.stockOnHand ?? null,
      priceUgx: p?.sellingPricePerUnitUgx ?? null,
      costUgx: p?.costPricePerUnitUgx ?? null,
      category: p?.category ?? null,
      reason: auditReason,
    });
    return { ok: true };
  },

  addProduct: (p) => {
    const denied = denyUnlessEffectivePermission("products.add", "addProduct");
    if (denied) return;

    const state = get();
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const tier = resolveStorePlanTier(snapshot, authMode);
    const cap = validateCanAddProduct(state.products.length, tier);
    if (!cap.ok) {
      pushAudit("auth_forbidden", "Denied addProduct (plan product limit)", {
        permission: "products.add",
        action: "addProduct",
        attemptedRole: state.sessionActor?.role ?? null,
        errorKey: cap.errorKey,
      });
      return;
    }

    const now = new Date().toISOString();
    const qp = defaultQuickPresetsForProduct(p);
    const row: Product = {
      ...p,
      id: crypto.randomUUID(),
      updatedAt: now,
      version: 1,
      quickPresetsMoneyUgx: p.quickPresetsMoneyUgx ?? qp.quickPresetsMoneyUgx,
      quickPresetsQty: p.quickPresetsQty ?? qp.quickPresetsQty,
    };
    const normalized = normalizeProduct(row);
    const shopKey = inventoryMovementNamespace();
    const openingMovement = openingStockMovementFromProduct(shopKey, normalized, now);
    set((s) => {
      const products = [normalized, ...s.products];
      const preferences = preferencesWithDefaultShelfLayout(s.preferences, products);
      return {
        products,
        preferences,
        ...(openingMovement ? movementMergePatch(s, [openingMovement]) : {}),
      };
    });
    void queueRemote("product", { id: row.id, isNew: true });
    pushAudit("product_add", row.name, {
      productId: row.id,
      name: row.name,
      category: row.category,
      stock: row.stockOnHand,
      priceUgx: row.sellingPricePerUnitUgx,
      costUgx: row.costPricePerUnitUgx,
    });
  },

  updateProductQuickPresets: (productId, presets) => {
    const denied = denyUnlessEffectivePermission("products.edit_presets", "updateProductQuickPresets");
    if (denied) return;

    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId
          ? {
              ...p,
              quickPresetsMoneyUgx: presets.quickPresetsMoneyUgx ?? p.quickPresetsMoneyUgx,
              quickPresetsQty: presets.quickPresetsQty ?? p.quickPresetsQty,
              updatedAt: new Date().toISOString(),
              version: p.version + 1,
            }
          : p,
      ),
    }));
    void queueRemote("product", { id: productId, presets: true, catalogOnly: true });
    const pn = get().products.find((x) => x.id === productId)?.name ?? productId;
    pushAudit("product_presets", `Presets ${pn}`, { productId });
  },

  updateProduct: (productId, patch, opts) => {
    const denied = denyUnlessEffectivePermission("stock.adjust", "updateProduct");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const prev = get().products.find((p) => p.id === productId);
    if (!prev) return { ok: false, errorKey: "missingProduct" };

    const priceChanging =
      patch.sellingPricePerUnitUgx !== undefined &&
      Math.floor(Number(patch.sellingPricePerUnitUgx)) !== prev.sellingPricePerUnitUgx;
    const stockChanging =
      patch.stockOnHand !== undefined && Math.abs(Number(patch.stockOnHand) - prev.stockOnHand) > 1e-6;
    if ((priceChanging || stockChanging) && !validateAuditReason(opts?.auditReason)) {
      return { ok: false, errorKey: auditReasonErrorKey() };
    }
    const auditReason = opts?.auditReason ? normalizeAuditReason(opts.auditReason) : undefined;

    const merged: Product = { ...prev };

    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) return { ok: false, errorKey: "invalid" };
      merged.name = n;
    }
    if (patch.sellingMode !== undefined) merged.sellingMode = patch.sellingMode;
    if (patch.baseUnit !== undefined) {
      const u = patch.baseUnit.trim();
      if (!u) return { ok: false, errorKey: "invalid" };
      merged.baseUnit = u;
    }
    if (patch.buyingUnit !== undefined) {
      const b = patch.buyingUnit;
      merged.buyingUnit = b === null || b === "" ? null : String(b).trim() || null;
    }
    if (patch.conversionRate !== undefined) {
      if (patch.conversionRate === null || patch.conversionRate <= 0 || Number.isNaN(patch.conversionRate)) {
        merged.conversionRate = null;
      } else {
        merged.conversionRate = patch.conversionRate;
      }
    }
    if (patch.sellingPricePerUnitUgx !== undefined) {
      const v = Math.max(0, Math.floor(Number(patch.sellingPricePerUnitUgx)));
      if (v <= 0) return { ok: false, errorKey: "invalid" };
      merged.sellingPricePerUnitUgx = v;
    }
    if (patch.costPricePerUnitUgx !== undefined) {
      merged.costPricePerUnitUgx = normalizeUnitCostUgx(patch.costPricePerUnitUgx);
    }
    if (patch.buyingPackCostUgx !== undefined) {
      merged.buyingPackCostUgx =
        patch.buyingPackCostUgx != null && patch.buyingPackCostUgx > 0
          ? Math.floor(patch.buyingPackCostUgx)
          : null;
    }
    if (patch.stockOnHand !== undefined) {
      merged.stockOnHand = Math.max(0, Number(patch.stockOnHand) || 0);
    }
    if (patch.minimumStockAlert !== undefined) {
      merged.minimumStockAlert = Math.max(0, Math.floor(Number(patch.minimumStockAlert)));
    }
    if (patch.category !== undefined) {
      merged.category = String(patch.category ?? "").trim();
    }
    if (patch.sku !== undefined) {
      const sk = String(patch.sku ?? "").trim();
      merged.sku = sk.length > 0 ? sk : prev.sku;
    }
    if (patch.expiryDate !== undefined) {
      merged.expiryDate = normalizeExpiryDate(patch.expiryDate ?? null);
    }
    if (patch.medicineStrength !== undefined) {
      merged.medicineStrength = normalizeMedicineStrength(patch.medicineStrength ?? null);
    }
    if (patch.medicineForm !== undefined) {
      merged.medicineForm = normalizeMedicineForm(patch.medicineForm ?? null);
    }
    if (patch.quickPresetsMoneyUgx !== undefined) {
      merged.quickPresetsMoneyUgx = patch.quickPresetsMoneyUgx;
    }
    if (patch.quickPresetsQty !== undefined) {
      merged.quickPresetsQty = patch.quickPresetsQty;
    }
    if (patch.hospitality !== undefined) {
      merged.hospitality = patch.hospitality
        ? normalizeProductHospitalityRouting(patch.hospitality, merged)
        : null;
    }
    if (patch.menu !== undefined) {
      merged.menu = patch.menu ? normalizeProductMenu(patch.menu) : null;
    }
    if (patch.pharmacyPackaging !== undefined) {
      merged.pharmacyPackaging = patch.pharmacyPackaging;
      if (patch.pharmacyPackaging?.enabled) {
        const bu = buyingUnitFromPackaging(patch.pharmacyPackaging);
        merged.baseUnit = patch.pharmacyPackaging.baseUnit || merged.baseUnit;
        merged.buyingUnit = bu.buyingUnit;
        merged.conversionRate = bu.conversionRate;
      }
    }

    const prevStock = prev.stockOnHand;
    const nextStock = merged.stockOnHand;
    const stockDelta = nextStock - prevStock;

    const at = new Date().toISOString();
    const movement: StockMovement | null =
      Math.abs(stockDelta) > 1e-6
        ? {
            id: crypto.randomUUID(),
            at,
            productId,
            productName: merged.name,
            deltaBaseUnits: stockDelta,
            kind: "adjust_count",
            summary: `Count → ${nextStock}`,
            supplierId: null,
          }
        : null;

    const normalized = normalizeProduct({
      ...merged,
      version: prev.version + 1,
      updatedAt: at,
    });

    set((s) => {
      const products = s.products.map((p) => (p.id === productId ? normalized : p));
      const categoryChanged =
        patch.category !== undefined &&
        String(patch.category ?? "").trim() !== String(prev.category ?? "").trim();
      const preferences = categoryChanged
        ? preferencesWithDefaultShelfLayout(s.preferences, products)
        : s.preferences;
      return {
        products,
        preferences,
        ...(movement ? movementMergePatch(s, [movement]) : {}),
      };
    });

    if (Math.abs(stockDelta) > 1e-6) {
      void queueRemote("pending_stock_updates", {
        productId,
        delta: stockDelta,
        note: "count",
        baseUpdatedAt: prev.updatedAt,
        baseStockOnHand: prevStock,
      });
    }
    void queueRemote("product", { id: productId, catalogOnly: true });
    const changes = diffProductCatalog(prev, normalized);
    const catalogPayload = {
      productId,
      name: merged.name,
      changes,
      stockBefore: prev.stockOnHand,
      stockAfter: normalized.stockOnHand,
      priceBefore: prev.sellingPricePerUnitUgx,
      priceAfter: normalized.sellingPricePerUnitUgx,
      reason: auditReason,
    };
    const summary = changes.length > 0 ? formatCatalogAuditSummary(merged.name, changes) : merged.name;
    pushAudit("product_update", summary, catalogPayload);
    if (changes.some((c) => c.field === "price")) {
      pushAudit("price_change", summary, catalogPayload);
    }
    if (Math.abs(stockDelta) > 1e-6) {
      broadcastInventoryStock([normalized], "stock_changed");
    }
    return { ok: true };
  },

  adjustStock: (productId, delta, reason) => {
    const denied = denyUnlessEffectivePermission("stock.adjust", "adjustStock");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    if (!validateAuditReason(reason)) return { ok: false, errorKey: auditReasonErrorKey() };

    const auditReason = normalizeAuditReason(reason ?? "");

    const prev = get().products.find((p) => p.id === productId);
    const at = new Date().toISOString();
    const kind = stockKindFromAdjustReason(reason);
    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId,
      productName: prev?.name ?? productId,
      deltaBaseUnits: delta,
      kind,
      summary: `${reason ?? "adjust"} ${delta >= 0 ? "+" : ""}${delta}`,
      supplierId: null,
    };
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId
          ? {
              ...p,
              stockOnHand: Math.max(0, p.stockOnHand + delta),
              packCostUnitsDepleted:
                delta < 0 && hasPackCostAllocation(p)
                  ? advancePackCostUnitsDepleted(p.packCostUnitsDepleted, -delta)
                  : p.packCostUnitsDepleted,
              updatedAt: new Date().toISOString(),
              version: p.version + 1,
            }
          : p,
      ),
      ...movementMergePatch(s, [movement]),
    }));
    void queueRemote("pending_stock_updates", {
      productId,
      delta,
      note: reason ?? "",
      baseUpdatedAt: prev?.updatedAt ?? null,
      baseStockOnHand: prev?.stockOnHand,
    });
    pushAudit("stock_adjust", `${auditReason} ${delta >= 0 ? "+" : ""}${delta} · ${prev?.name ?? productId}`, {
      productId,
      delta,
      reason: auditReason,
      productName: prev?.name,
      stockBefore: prev?.stockOnHand ?? null,
      stockAfter: prev != null ? Math.max(0, prev.stockOnHand + delta) : null,
    });
    const updated = get().products.find((p) => p.id === productId);
    if (updated) broadcastInventoryStock([updated], "stock_adjusted");
    return { ok: true };
  },

  writeOffExpiredStock: ({ productId, quantity, note }) => {
    const denied = denyUnlessEffectivePermission("pharmacy.expired_writeoff", "writeOffExpiredStock");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    if (!isPharmacyMode(state.preferences.businessType, state.preferences.pharmacyModeEnabled)) {
      return { ok: false, errorKey: "invalid" };
    }

    const p = state.products.find((x) => x.id === productId);
    if (!p) return { ok: false, errorKey: "missingProduct" };
    if (!isProductExpired(p)) return { ok: false, errorKey: "pharmacyWriteOffNotExpired" };

    const onHand = Math.max(0, Number(p.stockOnHand) || 0);
    if (onHand <= 0) return { ok: false, errorKey: "noStock" };

    const qty = quantity != null ? Math.min(onHand, Math.max(0, Number(quantity) || 0)) : onHand;
    if (qty <= 0) return { ok: false, errorKey: "invalidQty" };

    const lossValueUgx = lineCostForProductQuantity(p, qty);
    const at = new Date().toISOString();
    const writeOffId = crypto.randomUUID();
    const delta = -qty;

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      at,
      productId: p.id,
      productName: p.name,
      deltaBaseUnits: delta,
      kind: "adjust_expired_writeoff",
      summary: `Expired write-off −${qty} ${p.baseUnit}`,
      refId: writeOffId,
      supplierId: null,
    };

    set((s) => ({
      products: s.products.map((row) =>
        row.id === productId
          ? {
              ...row,
              stockOnHand: Math.max(0, row.stockOnHand + delta),
              packCostUnitsDepleted: hasPackCostAllocation(row)
                ? advancePackCostUnitsDepleted(row.packCostUnitsDepleted, qty)
                : row.packCostUnitsDepleted,
              updatedAt: at,
              version: row.version + 1,
            }
          : row,
      ),
      ...movementMergePatch(s, [movement]),
    }));

    void queueRemote("pending_stock_updates", {
      productId,
      delta,
      note: "expired_writeoff",
      baseUpdatedAt: p.updatedAt,
      baseStockOnHand: p.stockOnHand,
    });

    pushAudit("expired_stock_writeoff", `Expired write-off ${p.name} −${qty} · loss UGX ${lossValueUgx.toLocaleString()}`, {
      writeOffId,
      productId,
      productName: p.name,
      quantity: qty,
      lossValueUgx,
      costPerUnitUgx: normalizeUnitCostUgx(p.costPricePerUnitUgx),
      expiryDate: p.expiryDate ?? null,
      note: note?.trim() || null,
    });

    return { ok: true, lossValueUgx };
  },

  addCustomer: (c) => {
    const denied = denyUnlessEffectivePermission("customers.view", "addCustomer");
    if (denied) {
      return {
        ...c,
        id: "denied",
        createdAt: new Date().toISOString(),
        version: 1,
        debtBalanceUgx: 0,
      };
    }

    const row: Customer = {
      ...c,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      version: 1,
      debtBalanceUgx: 0,
    };
    set((s) => ({ customers: [row, ...s.customers] }));
    void queueRemote("customer", { id: row.id });
    pushAudit("customer_add", row.name, { customerId: row.id, name: row.name });
    return row;
  },

  assignOrphanDebtSale: (saleId, customerId) => {
    const denied = denyUnlessEffectivePermission("customers.debt", "assignOrphanDebtSale");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const sale = state.sales.find((s) => s.id === saleId);
    if (!sale || !isCompletedSale(sale)) return { ok: false, errorKey: "saleNotFound" };
    if (sale.customerId) return { ok: false, errorKey: "saleAlreadyLinked" };
    if (sale.debtUgx <= 0) return { ok: false, errorKey: "saleNoDebt" };

    const customer = state.customers.find((c) => c.id === customerId);
    if (!customer) return { ok: false, errorKey: "customerNotFound" };

    const debtUgx = sale.debtUgx;
    set({
      sales: state.sales.map((s) =>
        s.id === saleId ? { ...s, customerId, updatedAt: new Date().toISOString() } : s,
      ),
      customers: state.customers.map((c) =>
        c.id === customerId
          ? { ...c, debtBalanceUgx: c.debtBalanceUgx + debtUgx, version: c.version + 1 }
          : c,
      ),
    });

    void queueRemote("sale", { saleId });
    void queueRemote("customer", { id: customerId });
    pushAudit("debt_reconcile", `Linked credit sale to ${customer.name}`, {
      saleId,
      customerId,
      debtUgx,
      receiptSeq: sale.receiptSeq ?? null,
    });
    return { ok: true };
  },

  addDebtPayment: (customerId, amountUgx) => {
    const denied = denyUnlessEffectivePermission("customers.debt", "addDebtPayment");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const shiftGuard = requireActiveShift(state);
    if (!shiftGuard.ok) return { ok: false, errorKey: shiftGuard.errorKey };
    const amount = Math.floor(Math.max(0, amountUgx));
    if (amount <= 0) return { ok: false, errorKey: "invalidMoney" };
    const c = state.customers.find((x) => x.id === customerId);
    if (!c) return { ok: false, errorKey: "missingProduct" };
    const pay = Math.min(amount, c.debtBalanceUgx);
    if (pay <= 0) return { ok: false, errorKey: "invalid" };

    const receiptSnap = buildReceiptBrandingSnapshot(state.preferences, receiptSnapshotPlanTier(state.preferences));
    const payment: DebtPayment = {
      id: crypto.randomUUID(),
      customerId,
      amountUgx: pay,
      createdAt: new Date().toISOString(),
      receiptHeaderSnapshot: receiptSnap.header,
      receiptFooterSnapshot: receiptSnap.footer,
    };

    set({
      customers: state.customers.map((x) =>
        x.id === customerId
          ? { ...x, debtBalanceUgx: x.debtBalanceUgx - pay, version: x.version + 1 }
          : x,
      ),
      debtPayments: [payment, ...state.debtPayments],
    });

    const actor = state.sessionActor;
    if (actor) {
      set((st) => ({
        preferences: {
          ...st.preferences,
          shifts: (st.preferences.shifts ?? []).map((sh) =>
            !sh.endAt && sh.actorUserId === actor.userId
              ? {
                  ...sh,
                  debtPaymentsTotalUgx: (sh.debtPaymentsTotalUgx ?? 0) + pay,
                }
              : sh,
          ),
        },
      }));
    }
    void queueRemote("customer", { kind: "debt_payment", paymentId: payment.id });
    pushAudit("debt_payment", `Payment UGX ${pay.toLocaleString()}`, {
      customerId,
      paymentId: payment.id,
      amountUgx: pay,
    });
    return { ok: true, payment };
  },

  addSupplier: (input) => {
    const denied = denyUnlessEffectivePermission("suppliers.manage", "addSupplier");
    if (denied) return;

    const name = input.name.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const row: Supplier = {
      id: crypto.randomUUID(),
      name,
      phone: (input.phone ?? "").trim(),
      location: (input.location ?? "").trim(),
      notes: (input.notes ?? "").trim(),
      balanceOwedUgx: 0,
      lastSupplyAt: null,
      totalPurchasesUgx: 0,
      createdAt: now,
      version: 1,
    };
    set((s) => ({ suppliers: [normalizeSupplier(row), ...s.suppliers] }));
    void queueRemote("supplier", { id: row.id });
    pushAudit("supplier_add", row.name, { supplierId: row.id, name: row.name });
  },

  updateSupplier: (supplierId, patch) => {
    const denied = denyUnlessEffectivePermission("suppliers.manage", "updateSupplier");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const sup = state.suppliers.find((s) => s.id === supplierId);
    if (!sup || isWalkInSupplierId(supplierId)) return { ok: false, errorKey: "missingSupplier" };

    const changes = diffSupplierEdit(sup, patch);
    if (changes.length === 0) return { ok: true };

    const nextName = patch.name !== undefined ? patch.name.trim() : sup.name;
    if (!nextName) return { ok: false, errorKey: "invalid" };

    const updated: Supplier = {
      ...sup,
      name: nextName,
      phone: patch.phone !== undefined ? patch.phone.trim() : sup.phone,
      location: patch.location !== undefined ? patch.location.trim() : sup.location,
      notes: patch.notes !== undefined ? patch.notes.trim() : sup.notes,
      version: sup.version + 1,
    };

    set({
      suppliers: state.suppliers.map((s) => (s.id === supplierId ? normalizeSupplier(updated) : s)),
    });
    void queueRemote("supplier", { id: supplierId });
    pushAudit("supplier_edit", `Updated supplier ${updated.name}`, {
      supplierId,
      changes: changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
    });
    return { ok: true };
  },

  addSupplierPayment: (supplierId, amountUgx) => {
    const denied = denyUnlessEffectivePermission("suppliers.manage", "addSupplierPayment");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const sup = state.suppliers.find((x) => x.id === supplierId);
    if (!sup) return { ok: false, errorKey: "missingSupplier" };
    const pay = Math.min(Math.floor(Math.max(0, amountUgx)), Math.max(0, sup.balanceOwedUgx));
    if (pay <= 0) return { ok: false, errorKey: "invalidMoney" };
    const actor = state.sessionActor;
    const payment: SupplierPayment = {
      id: crypto.randomUUID(),
      supplierId,
      amountUgx: pay,
      createdByUserId: actor?.userId,
      createdByName: actor?.displayName,
      createdAt: new Date().toISOString(),
      pendingSync: true,
    };
    set({
      suppliers: state.suppliers.map((s) =>
        s.id === supplierId
          ? { ...s, balanceOwedUgx: Math.max(0, s.balanceOwedUgx - pay), version: s.version + 1 }
          : s,
      ),
      supplierPayments: [payment, ...state.supplierPayments],
    });
    void queueRemote("pending_expenses", { kind: "supplier_payment", paymentId: payment.id, supplierId, amountUgx: pay });
    pushAudit("supplier_payment", `Paid supplier UGX ${pay.toLocaleString()}`, {
      supplierId,
      supplierName: sup.name,
      paymentId: payment.id,
      amountUgx: pay,
    });
    return { ok: true };
  },

  voidPurchase: (purchaseId, reason) => {
    const denied = denyUnlessEffectivePermission("purchases.void", "voidPurchase");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    if (!validateAuditReason(reason)) return { ok: false, errorKey: auditReasonErrorKey() };
    const trimmedReason = normalizeAuditReason(reason);

    const state = get();
    const purchaseIdx = state.purchases.findIndex((p) => p.id === purchaseId);
    if (purchaseIdx === -1) return { ok: false, errorKey: "missingProduct" };
    const purchase = state.purchases[purchaseIdx]!;
    if (isPurchaseVoided(purchase)) return { ok: false, errorKey: "invalid" };

    const stockCheck = validatePurchaseVoidStock(purchaseId, state.products, state.stockMovements);
    if (!stockCheck.ok) return { ok: false, errorKey: "insufficientStock" };

    const at = new Date().toISOString();
    const walkIn = isWalkInSupplierId(purchase.supplierId);
    const products = [...state.products];
    const reversalMovements: StockMovement[] = [];

    for (const [productId, remove] of stockCheck.deltas) {
      const idx = products.findIndex((p) => p.id === productId);
      if (idx === -1) return { ok: false, errorKey: "missingProduct" };
      const p = products[idx]!;
      products[idx] = {
        ...p,
        stockOnHand: Math.max(0, p.stockOnHand - remove),
        updatedAt: at,
        version: p.version + 1,
      };
      reversalMovements.push({
        id: crypto.randomUUID(),
        at,
        productId: p.id,
        productName: p.name,
        deltaBaseUnits: -remove,
        kind: "adjust_other",
        summary: `Void purchase −${remove} ${p.baseUnit}`,
        refId: purchaseId,
        supplierId: walkIn ? null : purchase.supplierId,
      });
    }

    const voidedPurchase: Purchase = {
      ...purchase,
      voidedAt: at,
      voidReason: trimmedReason,
      pendingSync: true,
      preVoidCloudSynced: !purchase.pendingSync,
    };

    const purchases = [...state.purchases];
    purchases[purchaseIdx] = voidedPurchase;

    let suppliers = state.suppliers;
    if (!walkIn) {
      suppliers = state.suppliers.map((s) => {
        if (s.id !== purchase.supplierId) return s;
        const totals = supplierTotalsAfterPurchaseVoid(s, purchase);
        return normalizeSupplier({
          ...s,
          balanceOwedUgx: totals.balanceOwedUgx,
          totalPurchasesUgx: totals.totalPurchasesUgx,
          lastSupplyAt: lastSupplyAtForSupplier(s.id, purchases),
          version: s.version + 1,
        });
      });
    }

    set({
      products,
      purchases,
      suppliers,
      ...movementMergePatch(state, reversalMovements),
    });

    void queueRemote("pending_purchases", { purchaseId, void: true });
    void queueRemote("pending_stock_updates", { kind: "purchase_void", purchaseId });
    if (!walkIn) void queueRemote("supplier", { id: purchase.supplierId });
    pushAudit("purchase_void", `Voided purchase UGX ${purchase.totalCostUgx.toLocaleString()} · ${purchase.supplierName}`, {
      purchaseId,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      totalCostUgx: purchase.totalCostUgx,
      balanceDeltaUgx: purchase.balanceDeltaUgx,
      amountPaidUgx: purchase.amountPaidUgx,
      reason: trimmedReason,
    });
    const voidedProducts = products.filter((p) => {
      const old = state.products.find((x) => x.id === p.id);
      return old != null && old.stockOnHand !== p.stockOnHand;
    });
    if (voidedProducts.length > 0) {
      broadcastInventoryStock(voidedProducts, "purchase_void");
    }
    return { ok: true };
  },

  recordPurchase: (input) => {
    const denied = denyUnlessEffectivePermission("purchases.record", "recordPurchase");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    if (!input.lines.length) return { ok: false, errorKey: "emptySale" };

    const walkIn = isWalkInSupplierId(input.supplierId);
    let supplierId: string;
    let supplierName: string;

    if (walkIn) {
      supplierId = WALK_IN_SUPPLIER_ID;
      supplierName = (input.supplierName ?? "").trim() || "Town / market";
    } else {
      const supplierRow = state.suppliers.find((s) => s.id === input.supplierId);
      if (!supplierRow) return { ok: false, errorKey: "missingSupplier" };
      supplierId = supplierRow.id;
      supplierName = supplierRow.name;
    }

    let totalCostUgx = 0;
    const builtLines: PurchaseLine[] = [];
    for (const ln of input.lines) {
      const p = state.products.find((x) => x.id === ln.productId);
      if (!p) return { ok: false, errorKey: "missingProduct" };
      const baseInDirect = ln.baseUnitsIn != null ? Math.max(0, Math.floor(ln.baseUnitsIn)) : 0;
      const qtyBuy = ln.qtyBuyingUnits != null ? ln.qtyBuyingUnits : 0;
      const costBuy = ln.costPerBuyingUnitUgx != null ? ln.costPerBuyingUnitUgx : 0;
      const costBase = ln.costPerBaseUnitUgx != null ? ln.costPerBaseUnitUgx : 0;
      if (baseInDirect <= 0 && (qtyBuy <= 0 || costBuy < 0)) return { ok: false, errorKey: "invalid" };
      if (baseInDirect > 0) {
        if (costBase < 0) return { ok: false, errorKey: "invalid" };
        totalCostUgx += baseInDirect * Math.round(costBase);
        builtLines.push({
          productId: p.id,
          name: p.name,
          qtyBuyingUnits: baseInDirect,
          costPerBuyingUnitUgx: Math.round(costBase),
          unitMode: "base_units",
        });
      } else {
        totalCostUgx += purchaseLineCostTotalUgx({
          qtyBuyingUnits: qtyBuy,
          costPerBuyingUnitUgx: costBuy,
        });
        builtLines.push({
          productId: p.id,
          name: p.name,
          qtyBuyingUnits: qtyBuy,
          costPerBuyingUnitUgx: Math.round(costBuy),
        });
      }
    }

    const amountPaidUgx = Math.max(0, Math.floor(input.amountPaidUgx));
    const balanceDeltaUgx = totalCostUgx - amountPaidUgx;
    const createdAt = new Date().toISOString();
    const purchaseId = crypto.randomUUID();

    const products = [...state.products];
    const movements: StockMovement[] = [];

    for (const ln of builtLines) {
      const idx = products.findIndex((x) => x.id === ln.productId);
      if (idx === -1) return { ok: false, errorKey: "missingProduct" };
      const p = products[idx];
      const directBase = input.lines.find((x) => x.productId === ln.productId)?.baseUnitsIn;
      const baseIn =
        directBase != null && directBase > 0
          ? Math.floor(directBase)
          : buyingUnitsToBaseUnits(p, ln.qtyBuyingUnits);
      if (baseIn <= 0) return { ok: false, errorKey: "invalidQty" };
      const lineInput = input.lines.find((x) => x.productId === ln.productId);
      const incomingCostPerBase =
        lineInput?.costPerBaseUnitUgx != null && lineInput.costPerBaseUnitUgx >= 0
          ? normalizeUnitCostUgx(lineInput.costPerBaseUnitUgx)
          : costPerBaseFromBuyingUnitCost(p, ln.costPerBuyingUnitUgx);
      const newCost = weightedCostAfterStockIn(p.stockOnHand, p.costPricePerUnitUgx, baseIn, incomingCostPerBase);
      const newStock = p.stockOnHand + baseIn;
      products[idx] = {
        ...p,
        stockOnHand: newStock,
        costPricePerUnitUgx: newCost,
        updatedAt: createdAt,
        version: p.version + 1,
      };
      movements.push({
        id: crypto.randomUUID(),
        at: createdAt,
        productId: p.id,
        productName: p.name,
        deltaBaseUnits: baseIn,
        kind: "purchase_in",
        summary: `Restock +${baseIn} ${p.baseUnit}`,
        refId: purchaseId,
        supplierId: walkIn ? null : supplierId,
      });
    }

    const purchase: Purchase = {
      id: purchaseId,
      supplierId,
      supplierName,
      lines: builtLines,
      totalCostUgx,
      amountPaidUgx,
      balanceDeltaUgx,
      notes: (input.notes ?? "").trim(),
      createdAt,
      pendingSync: true,
    };

    const suppliers = walkIn
      ? state.suppliers
      : state.suppliers.map((s) =>
          s.id === supplierId
            ? {
                ...s,
                balanceOwedUgx: s.balanceOwedUgx + balanceDeltaUgx,
                totalPurchasesUgx: s.totalPurchasesUgx + totalCostUgx,
                lastSupplyAt: createdAt,
                version: s.version + 1,
              }
            : s,
        );

    set({
      products,
      purchases: [purchase, ...state.purchases],
      suppliers: suppliers.map(normalizeSupplier),
      ...movementMergePatch(state, movements),
    });

    void queueRemote("pending_purchases", { purchaseId: purchase.id });
    void queueRemote("pending_stock_updates", { kind: "purchase", purchaseId: purchase.id });
    if (!walkIn) void queueRemote("supplier", { id: supplierId });
    pushAudit("purchase_saved", `Restock UGX ${totalCostUgx.toLocaleString()} · ${supplierName}`, {
      purchaseId: purchase.id,
      supplierId,
      supplierName,
      totalCostUgx,
      amountPaidUgx,
      lineCount: builtLines.length,
    });
    const changedProducts = products.filter((p) => {
      const old = state.products.find((x) => x.id === p.id);
      return old != null && old.stockOnHand !== p.stockOnHand;
    });
    if (changedProducts.length > 0) {
      broadcastInventoryStock(changedProducts, "purchase_saved");
    }
    return { ok: true };
  },

  runDataArchive: () => {
    const actor = get().sessionActor;
    const { snapshot, authMode } = getStoreSubscriptionContext();
    if (!checkStorePermissionEffective(actor, "settings.shop", snapshot, authMode).ok) {
      return {
        moved: { sales: 0, auditLogs: 0, dayCloses: 0, voidRecords: 0, returnRecords: 0, shifts: 0 },
      };
    }

    const s = get();
    const windowed = archiveSalesBeyondActiveWindow(s.sales, s.archivedSales);
    const policy = normalizeDataRetentionPolicy(s.preferences.dataRetentionPolicy);
    const shifts = s.preferences.shifts ?? [];
    const archivedShifts = s.preferences.archivedShifts ?? [];
    const result = partitionForArchive(policy, {
      sales: windowed.sales,
      archivedSales: windowed.archivedSales,
      auditLogs: s.auditLogs,
      archivedAuditLogs: s.archivedAuditLogs,
      dayCloses: s.dayCloses,
      archivedDayCloses: s.archivedDayCloses,
      voidRecords: s.voidRecords,
      archivedVoidRecords: s.archivedVoidRecords,
      returnRecords: s.returnRecords,
      archivedReturnRecords: s.archivedReturnRecords,
      shifts,
      archivedShifts,
    });
    const movedTotal =
      windowed.moved +
      result.moved.sales +
      result.moved.auditLogs +
      result.moved.dayCloses +
      result.moved.voidRecords +
      result.moved.returnRecords +
      result.moved.shifts;
    if (movedTotal === 0) {
      return { moved: result.moved };
    }
    set({
      sales: result.sales,
      archivedSales: result.archivedSales,
      auditLogs: result.auditLogs,
      archivedAuditLogs: result.archivedAuditLogs,
      dayCloses: result.dayCloses,
      archivedDayCloses: result.archivedDayCloses,
      voidRecords: result.voidRecords,
      archivedVoidRecords: result.archivedVoidRecords,
      returnRecords: result.returnRecords,
      archivedReturnRecords: result.archivedReturnRecords,
      preferences: {
        ...s.preferences,
        shifts: result.shifts,
        archivedShifts: result.archivedShifts,
        lastArchiveRunAt: new Date().toISOString(),
      },
    });
    appendPilotEvent("archive", `Archived ${movedTotal} records`, { movedTotal });
    return { moved: result.moved };
  },

  permanentlyDeleteArchived: async () => {
    const denied = denyUnlessEffectivePermission("settings.shop", "permanentlyDeleteArchived");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const { canPermanentlyDeleteArchived } = await import("../lib/auditPreservation");
    const gate = await canPermanentlyDeleteArchived();
    if (!gate.ok) {
      pushAudit("archive_purge_blocked", gate.reason, {
        errorKey: gate.errorKey,
        pendingAuditOps: gate.pendingAuditOps,
      });
      return { ok: false, errorKey: gate.errorKey };
    }

    const state = get();
    const forensic = buildArchiveForensicSummary({
      archivedSales: state.archivedSales,
      archivedReturnRecords: state.archivedReturnRecords,
      archivedVoidRecords: state.archivedVoidRecords,
      archivedAuditLogs: state.archivedAuditLogs,
      lastArchiveRunAt: state.preferences.lastArchiveRunAt,
    });
    const counts = {
      archivedSales: forensic.salesCount,
      archivedAuditLogs: forensic.auditCount,
      archivedDayCloses: state.archivedDayCloses.length,
      archivedVoidRecords: forensic.voidCount,
      archivedReturnRecords: forensic.returnsCount,
      archivedShifts: (state.preferences.archivedShifts ?? []).length,
    };

    const totalRecordsRemoved =
      counts.archivedSales +
      counts.archivedAuditLogs +
      counts.archivedDayCloses +
      counts.archivedVoidRecords +
      counts.archivedReturnRecords +
      counts.archivedShifts;

    pushAudit("archive_purge", "Permanent archive purge", {
      forensic,
      ...counts,
      totalRecordsRemoved,
    });

    set({
      archivedSales: [],
      archivedAuditLogs: [],
      archivedDayCloses: [],
      archivedVoidRecords: [],
      archivedReturnRecords: [],
      preferences: {
        ...get().preferences,
        archivedShifts: [],
      },
    });
    return { ok: true };
  },

  addCashExpense: (input) => {
    const dateLock = denyIfBusinessDateLocked(dateKeyKampala(new Date()), "addCashExpense");
    if (dateLock) return dateLock;

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    if (!canRecordCashExpenses(actor.role, state.preferences)) {
      pushAudit("auth_forbidden", "Denied addCashExpense", {
        permission: "expenses.record",
        action: "addCashExpense",
        attemptedRole: actor.role,
      });
      return { ok: false, errorKey: "forbidden" };
    }

    const amountUgx = Math.floor(input.amountUgx);
    if (amountUgx <= 0) return { ok: false, errorKey: "cashExpenseAmountRequired" };
    const category = input.category.trim().slice(0, 64);
    if (!category) return { ok: false, errorKey: "cashExpenseCategoryRequired" };
    const now = new Date().toISOString();
    const paidOn = dateKeyKampala(new Date());
    const approvalStatus = resolveNewExpenseApprovalStatus(actor.role, state.preferences);
    const row: CashExpense = {
      id: crypto.randomUUID(),
      category,
      amountUgx,
      description: (input.description ?? "").trim(),
      paidOn,
      createdAt: now,
      createdByUserId: actor.userId,
      createdByLabel: actor.displayName,
      deviceId: getOrCreateDeviceId(),
      approvalStatus,
      approvedByUserId: approvalStatus === "approved" ? actor.userId : null,
      approvedByLabel: approvalStatus === "approved" ? actor.displayName ?? null : null,
      approvedAt: approvalStatus === "approved" ? now : null,
      pendingSync: true,
      lastSyncError: null,
      deletedAt: null,
    };
    set((s) => ({ cashExpenses: [row, ...s.cashExpenses] }));
    pushAudit("cash_expense_created", `${category} UGX ${amountUgx.toLocaleString()}`, {
      expenseId: row.id,
      amountUgx,
      category,
      description: row.description,
      approvalStatus,
      deviceId: row.deviceId,
      createdByUserId: actor.userId,
      createdByLabel: actor.displayName,
    });
    void queueRemote("pending_cash_expenses", { expenseId: row.id });
    if (hasSupabaseConfig) {
      void import("../offline/cloudSync").then((m) => m.syncCashExpenseImmediately(row.id));
    }
    return { ok: true, expenseId: row.id };
  },

  addCashDrawerAdjustment: (input) => {
    const denied = denyUnlessEffectivePermission("day.close", "addCashDrawerAdjustment");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const dateLock = denyIfBusinessDateLocked(dateKeyKampala(new Date()), "addCashDrawerAdjustment");
    if (dateLock) return dateLock;

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    if (input.type === "opening_float" && isFormulaV2(state.preferences)) {
      return { ok: false, errorKey: "dayDrawerUseDayOpen" };
    }
    const amountUgx = Math.floor(input.amountUgx);
    if (amountUgx <= 0) return { ok: false, errorKey: "invalidMoney" };
    const now = new Date().toISOString();
    const occurredAt = input.occurredAt?.trim() || now;
    const row: CashDrawerAdjustment = normalizeCashDrawerAdjustment({
      id: crypto.randomUUID(),
      type: input.type,
      amountUgx,
      note: (input.note ?? "").trim(),
      actorUserId: actor.userId,
      actorName: actor.displayName,
      occurredAt,
      createdAt: now,
      updatedAt: now,
      pendingSync: true,
      lastSyncError: null,
      deletedAt: null,
    });
    set((s) => ({ cashDrawerAdjustments: [row, ...s.cashDrawerAdjustments] }));
    pushAudit("cash_drawer_adjustment", `${input.type} UGX ${amountUgx.toLocaleString()}`, {
      adjustmentId: row.id,
      type: input.type,
      amountUgx,
      note: row.note,
      actorUserId: actor.userId,
    });
    void queueRemote("pending_cash_drawer_adjustments", { adjustmentId: row.id });
    if (hasSupabaseConfig) {
      void import("../offline/cloudSync").then((m) => m.syncCashDrawerAdjustmentImmediately(row.id));
    }
    return { ok: true, adjustmentId: row.id };
  },

  approveCashExpense: (id) => {
    const denied = denyUnlessEffectivePermission("expenses.approve", "approveCashExpense");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const row = state.cashExpenses.find((e) => e.id === id && !e.deletedAt);
    if (!row) return { ok: false, errorKey: "invalid" };
    if ((row.approvalStatus ?? "approved") !== "pending") return { ok: false, errorKey: "invalid" };
    const now = new Date().toISOString();
    set((s) => ({
      cashExpenses: s.cashExpenses.map((e) =>
        e.id === id
          ? {
              ...e,
              approvalStatus: "approved" as const,
              approvedByUserId: actor.userId,
              approvedByLabel: actor.displayName ?? null,
              approvedAt: now,
              pendingSync: true,
            }
          : e,
      ),
    }));
    pushAudit("cash_expense_approved", `Approved ${row.category} UGX ${row.amountUgx.toLocaleString()}`, {
      expenseId: id,
      amountUgx: row.amountUgx,
      category: row.category,
      approvedByUserId: actor.userId,
      approvedByLabel: actor.displayName,
    });
    void queueRemote("pending_cash_expenses", { expenseId: id });
    return { ok: true };
  },

  rejectCashExpense: (id) => {
    const denied = denyUnlessEffectivePermission("expenses.approve", "rejectCashExpense");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const row = state.cashExpenses.find((e) => e.id === id && !e.deletedAt);
    if (!row) return { ok: false, errorKey: "invalid" };
    if ((row.approvalStatus ?? "approved") !== "pending") return { ok: false, errorKey: "invalid" };
    const now = new Date().toISOString();
    set((s) => ({
      cashExpenses: s.cashExpenses.map((e) =>
        e.id === id
          ? {
              ...e,
              approvalStatus: "rejected" as const,
              rejectedByUserId: actor.userId,
              rejectedByLabel: actor.displayName ?? null,
              rejectedAt: now,
              pendingSync: true,
            }
          : e,
      ),
    }));
    pushAudit("cash_expense_rejected", `Rejected ${row.category} UGX ${row.amountUgx.toLocaleString()}`, {
      expenseId: id,
      amountUgx: row.amountUgx,
      category: row.category,
      rejectedByUserId: actor.userId,
      rejectedByLabel: actor.displayName,
    });
    void queueRemote("pending_cash_expenses", { expenseId: id });
    return { ok: true };
  },

  voidCashExpense: (id, reason) => {
    const denied = denyUnlessEffectivePermission("expenses.delete", "voidCashExpense");
    if (denied) return { ok: false, errorKey: denied.errorKey };
    if (!validateAuditReason(reason)) return { ok: false, errorKey: auditReasonErrorKey() };

    const auditReason = normalizeAuditReason(reason);
    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };
    const row = state.cashExpenses.find((e) => e.id === id && !e.deletedAt);
    if (!row) return { ok: false, errorKey: "invalid" };
    const now = new Date().toISOString();
    set((s) => ({
      cashExpenses: s.cashExpenses.map((e) =>
        e.id === id ? { ...e, deletedAt: now, pendingSync: true } : e,
      ),
    }));
    pushAudit("cash_expense_voided", `Removed ${row.category} UGX ${row.amountUgx.toLocaleString()}`, {
      expenseId: id,
      amountUgx: row.amountUgx,
      category: row.category,
      description: row.description,
      reason: auditReason,
    });
    void queueRemote("pending_cash_expenses", { expenseId: id, void: true });
    return { ok: true };
  },

  recordDayClose: async ({
    dateKey,
    countedCashUgx,
    override,
    overrideReason,
    emergency,
    emergencyReason,
    managerPin,
    syncOverride,
    sequentialOverride,
    varianceOverride,
  }) => {
    const denied = denyUnlessEffectivePermission("day.close", "recordDayClose");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    await ensureAllActiveSalesLoaded();
    if (!(await isActiveSalesFullyLoaded())) {
      return { ok: false, errorKey: "closeDaySalesNotLoaded" };
    }

    const state = get();
    const counted = Math.max(0, Math.floor(countedCashUgx));
    const drawer = getDrawerCashForDayInput({
      sales: state.sales,
      returns: state.returnRecords,
      products: state.products,
      debtPayments: state.debtPayments,
      cashExpenses: state.cashExpenses,
      supplierPayments: state.supplierPayments,
      cashDrawerAdjustments: state.cashDrawerAdjustments,
      shifts: state.preferences.shifts ?? [],
      dayDrawerOpens: state.dayDrawerOpens,
      formulaVersion: resolveCashDrawerFormulaVersion(state.preferences),
      day: dateKey,
    });
    const expectedCashUgx = drawer.expectedDrawerCashUgx;
    const diff = counted - expectedCashUgx;

    const preflight = await runDayCloseEnforcementPreflight({
      state: {
        draftLines: state.draftLines,
        activePendingSaleId: state.activePendingSaleId,
        sales: state.sales,
        preferences: state.preferences,
        dayCloses: state.dayCloses,
        dayDrawerOpens: state.dayDrawerOpens,
        products: state.products,
        returnRecords: state.returnRecords,
        cashDrawerAdjustments: state.cashDrawerAdjustments,
        cashExpenses: state.cashExpenses,
        inventoryCountSessions: state.inventoryCountSessions,
      },
      dateKey,
      expectedCashUgx,
      countedCashUgx: counted,
      variancePreferences: state.preferences,
    });
    const preflightWarnings = preflight.warnings;

    const preflightGate = assertDayClosePreflightPassed(preflight, {
      emergency,
      syncOverride,
      sequentialOverride,
    });
    if (!preflightGate.ok) {
      pushAudit("day_close_preflight_failed", `Day close blocked ${dateKey}`, {
        dateKey,
        errorKey: preflightGate.errorKey,
        blockReasons: preflight.blockReasons,
        openShifts: preflight.snapshot.openShifts,
        hospitalitySessions: preflight.snapshot.hospitalitySessions,
      });
      if (preflightGate.errorKey === "dayCloseBlockedOpenShifts") {
        pushAudit("shift_block", "Day close blocked — open shifts", { dateKey });
      }
      if (preflightGate.errorKey === "dayCloseBlockedHospitality") {
        pushAudit("hospitality_block", "Day close blocked — open hospitality", { dateKey });
      }
      return { ok: false, errorKey: preflightGate.errorKey };
    }

    const seqGate = assertSequentialBusinessDay({
      targetDateKey: dateKey,
      dayCloses: state.dayCloses,
      sales: state.sales,
      shifts: state.preferences.shifts ?? [],
      dayDrawerOpens: state.dayDrawerOpens,
    });
    if (!seqGate.ok && !sequentialOverride && !emergency) {
      pushAudit("day_close_blocked", `Sequential day block ${dateKey}`, {
        dateKey,
        unclosedDays: seqGate.unclosedDays,
      });
      return { ok: false, errorKey: seqGate.errorKey };
    }

    const actor = state.sessionActor;
    const actorLabel = actor?.displayName?.trim() || actor?.role || "Owner";
    const actorRole = actor?.role ?? "cashier";
    const actorUserId = actor?.userId ?? "unknown";

    const varianceFlagged = dayCloseVarianceIsFlagged(expectedCashUgx, diff, state.preferences);
    if (varianceFlagged && !varianceOverride && !emergency) {
      return { ok: false, errorKey: "dayCloseVarianceApprovalRequired" };
    }
    if (varianceFlagged && (varianceOverride || emergency)) {
      const pin = managerPin?.trim() ?? "";
      const approval = resolveDayCloseApproval("variance", pin, state.preferences, actorRole, actorUserId, actorLabel);
      if (!approval.ok) return { ok: false, errorKey: approval.errorKey };
      pushAudit("variance_override", `Variance override ${dateKey} UGX ${diff.toLocaleString()}`, {
        dateKey,
        expectedCashUgx,
        countedCashUgx: counted,
        differenceUgx: diff,
        managerUserId: approval.auth.actorUserId,
        managerLabel: approval.auth.actorLabel,
        reason: overrideReason ?? emergencyReason ?? "",
      });
      pushAudit("manager_override", `Manager approved variance on ${dateKey}`, {
        kind: "variance",
        dateKey,
        differenceUgx: diff,
        approverUserId: approval.auth.actorUserId,
        approverLabel: approval.auth.actorLabel,
      });
    }

    const needsSyncOverride = preflight.snapshot.requiresSyncOverride;
    if (needsSyncOverride && (syncOverride || emergency)) {
      const pin = managerPin?.trim() ?? "";
      const approval = resolveDayCloseApproval(
        emergency ? "emergency_close" : "sync_override",
        pin,
        state.preferences,
        actorRole,
        actorUserId,
        actorLabel,
      );
      if (!approval.ok) return { ok: false, errorKey: approval.errorKey };
      pushAudit("sync_override", `Sync override for day close ${dateKey}`, {
        dateKey,
        pendingSyncTotal: preflight.snapshot.pendingSync.total,
        managerUserId: approval.auth.actorUserId,
        reason: overrideReason ?? emergencyReason ?? "",
      });
      pushAudit("manager_override", `Manager approved sync override on ${dateKey}`, {
        kind: "sync_override",
        dateKey,
        approverUserId: approval.auth.actorUserId,
      });
    } else if (needsSyncOverride && !emergency) {
      return { ok: false, errorKey: "dayCloseBlockedSync" };
    }

    if (emergency) {
      const reason = (emergencyReason ?? "").trim();
      if (reason.length < 3) return { ok: false, errorKey: "dayCloseEmergencyReasonRequired" };
      const approval = resolveDayCloseApproval(
        "emergency_close",
        managerPin?.trim() ?? "",
        state.preferences,
        actorRole,
        actorUserId,
        actorLabel,
      );
      if (!approval.ok) return { ok: false, errorKey: approval.errorKey };
    }

    const gate = canRecordDayClose(state.dayCloses, dateKey, override);
    if (!gate.ok) return { ok: false, errorKey: gate.errorKey };

    const existing = activeDayCloseForDate(state.dayCloses, dateKey);
    if (existing && override) {
      const reason = (overrideReason ?? "").trim();
      if (reason.length < 3) return { ok: false, errorKey: "dayCloseOverrideReasonRequired" };
      const approval = resolveDayCloseApproval(
        "reclose_override",
        managerPin?.trim() ?? "",
        state.preferences,
        actorRole,
        actorUserId,
        actorLabel,
      );
      if (!approval.ok) return { ok: false, errorKey: approval.errorKey };
      pushAudit("manager_override", `Manager approved re-close ${dateKey}`, {
        kind: "reclose_override",
        dateKey,
        previousCloseId: existing.id,
        approverUserId: approval.auth.actorUserId,
        reason,
      });
    }

    const fin = getCompletedFinancials(state.sales, state.returnRecords, state.products, { day: dateKey });
    const totalSalesUgx = fin.revenueUgx;
    const totalDebtUgx = fin.debtIssuedUgx;
    const profitEstimateUgx = fin.profitUgx;
    const now = new Date().toISOString();
    const closedByLabel = actorLabel;
    const closeId = crypto.randomUUID();
    const documentSnapshot = buildDayCloseSnapshot({
      closedByUserId: actor?.userId ?? null,
      closedByLabel,
      row: {
        id: closeId,
        dateKey,
        expectedCashUgx,
        countedCashUgx: counted,
        differenceUgx: diff,
        totalSalesUgx,
        totalDebtUgx,
        profitEstimateUgx,
        createdAt: now,
        replacesCloseId: existing?.id ?? null,
        overrideReason: existing && override ? (overrideReason ?? "").trim() : emergency ? (emergencyReason ?? "").trim() : null,
        isEmergency: emergency ?? false,
        closedByUserId: actor?.userId ?? null,
        closedByLabel,
        emergencyReason: emergency ? (emergencyReason ?? "").trim() : null,
      },
      drawer: {
        cashFromSalesUgx: drawer.cashFromSalesUgx,
        debtCollectedUgx: drawer.debtCollectedUgx,
        refundsUgx: drawer.refundsUgx,
        expenseUgx: drawer.expenseUgx,
        openingFloatUgx: drawer.openingFloatUgx,
        cashSalesUgx: drawer.cashSalesUgx,
        supplierPaymentsUgx: drawer.supplierPaymentsUgx,
        adjustmentInflowsUgx: drawer.adjustmentInflowsUgx,
        adjustmentOutflowsUgx: drawer.adjustmentOutflowsUgx,
        cashRefundsUgx: drawer.cashRefundsUgx,
      },
      transactionCount: fin.transactionCount,
    });
    const row: DayCloseSummary = {
      id: closeId,
      dateKey,
      expectedCashUgx,
      countedCashUgx: counted,
      differenceUgx: diff,
      totalSalesUgx,
      totalDebtUgx,
      profitEstimateUgx,
      createdAt: now,
      replacesCloseId: existing?.id ?? null,
      overrideReason: existing && override ? (overrideReason ?? "").trim() : emergency ? (emergencyReason ?? "").trim() : null,
      openingFloatUgx: drawer.openingFloatUgx,
      documentSnapshot,
      pendingSync: true,
      updatedAt: now,
      isEmergency: emergency ?? false,
      closedByUserId: actor?.userId ?? null,
      closedByLabel,
      emergencyReason: emergency ? (emergencyReason ?? "").trim() : null,
    };
    set((s) => ({
      dayCloses: [
        row,
        ...s.dayCloses.map((d) =>
          existing && d.id === existing.id ? { ...d, supersededAt: now, pendingSync: true, updatedAt: now } : d,
        ),
      ],
    }));
    void queueRemote("pending_day_closes", { closeId: row.id });
    if (existing && override) {
      void queueRemote("pending_day_closes", { closeId: existing.id });
      pushAudit("day_close_override", `Re-close ${dateKey}`, {
        previousCloseId: existing.id,
        newCloseId: row.id,
        overrideReason: row.overrideReason,
        dateKey,
      });
    }
    if (emergency) {
      pushAudit("day_close_emergency", `Emergency close ${dateKey}`, {
        dayCloseId: row.id,
        dateKey,
        emergencyReason: row.emergencyReason,
        expectedCashUgx,
        countedCashUgx: counted,
        differenceUgx: diff,
        preflightWarnings,
      });
    } else {
      pushAudit("day_close", `Close ${dateKey} counted UGX ${counted.toLocaleString()}`, {
        dayCloseId: row.id,
        dateKey,
        expectedCashUgx,
        countedCashUgx: counted,
        differenceUgx: diff,
        totalSalesUgx,
        totalDebtUgx,
        profitEstimateUgx,
        cashFromSalesUgx: drawer.cashFromSalesUgx,
        debtCollectedUgx: drawer.debtCollectedUgx,
        refundsUgx: drawer.refundsUgx,
        expenseUgx: drawer.expenseUgx,
        preflightWarnings,
      });
    }
    return { ok: true, warnings: preflightWarnings.length > 0 ? preflightWarnings : undefined };
  },

  reopenBusinessDay: ({ dateKey, reason, ownerPin }) => {
    const denied = denyUnlessEffectivePermission("day.close", "reopenBusinessDay");
    if (denied) return { ok: false, errorKey: denied.errorKey };

    const state = get();
    const actor = state.sessionActor;
    if (!actor) return { ok: false, errorKey: "noSelection" };

    const activeClose = activeDayCloseForDate(state.dayCloses, dateKey);
    if (!activeClose) return { ok: false, errorKey: "dayCloseNotFound" };

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) return { ok: false, errorKey: "dayCloseOverrideReasonRequired" };

    const approval = resolveDayCloseApproval(
      "reopen_day",
      ownerPin,
      state.preferences,
      actor.role,
      actor.userId,
      actor.displayName ?? actor.userId,
    );
    if (!approval.ok) return { ok: false, errorKey: approval.errorKey };

    const now = new Date().toISOString();
    const reopenId = crypto.randomUUID();
    const reopenRecord: import("../types").DayReopenRecord = {
      id: reopenId,
      dateKey,
      closeId: activeClose.id,
      reason: trimmedReason,
      reopenedByUserId: approval.auth.actorUserId,
      reopenedByLabel: approval.auth.actorLabel,
      reopenedAt: now,
      deviceId: getOrCreateDeviceId(),
      pendingSync: true,
    };

    set((s) => ({
      dayCloses: s.dayCloses.map((d) =>
        d.id === activeClose.id ? { ...d, supersededAt: now, pendingSync: true, updatedAt: now } : d,
      ),
      preferences: {
        ...s.preferences,
        dayReopenHistory: [reopenRecord, ...(s.preferences.dayReopenHistory ?? [])],
      },
    }));

    void queueRemote("pending_day_closes", { closeId: activeClose.id });
    pushAudit("day_close_reopened", `Reopened business day ${dateKey}`, {
      dateKey,
      closeId: activeClose.id,
      reopenId,
      reason: trimmedReason,
      reopenedByUserId: approval.auth.actorUserId,
      reopenedByLabel: approval.auth.actorLabel,
      deviceId: reopenRecord.deviceId,
    });
    pushAudit("manager_override", `Owner reopened ${dateKey}`, {
      kind: "reopen_day",
      dateKey,
      approverUserId: approval.auth.actorUserId,
      reason: trimmedReason,
    });
    return { ok: true };
  },

  repairCustomerDebtIntegrity: () => {
    const denied = denyUnlessEffectivePermission("owner.dashboard", "repairCustomerDebtIntegrity");
    if (denied) return { ok: false, healedCount: 0, mismatchCount: 0, errorKey: denied.errorKey };

    const healSafety = canSafelyHealCustomerDebt();
    if (!healSafety.ok) {
      return { ok: false, healedCount: 0, mismatchCount: 0, errorKey: healSafety.reasonKey };
    }

    const state = get();
    const before = verifyCustomerDebtIntegrity(state.customers, state.sales, state.debtPayments, { heal: false });
    const result = verifyCustomerDebtIntegrity(state.customers, state.sales, state.debtPayments, { heal: true });
    if (result.healedCount > 0) {
      set({ customers: result.customers });
    }
    pushAudit("debt_manual_adjust", `Debt reconciliation healed ${result.healedCount}`, {
      healedCount: result.healedCount,
      mismatchCountBefore: before.mismatches.length,
      mismatchCountAfter: result.mismatches.length,
      mismatches: before.mismatches.map((m) => ({
        customerId: m.customerId,
        stored: m.stored,
        expected: m.expected,
      })),
      reason: "debt_integrity_repair",
    });
    return {
      ok: result.ok,
      healedCount: result.healedCount,
      mismatchCount: result.mismatches.length,
    };
  },

  ...createInventoryCountStoreActions({
    get,
    set,
    pushAudit,
    queueRemote,
    movementMergePatch,
  }),

  ...createRestaurantBillingStoreActions({
    get,
    set,
    denyUnlessEffectivePermission,
    denyIfBusinessDateLocked,
    finalizeDraftSale: (opts) => get().finalizeDraftSale(opts),
    queueRemote,
    queueHospitalityChange,
    flushPendingPersist,
    onTableBillFinalized: ({ saleId, tableLabel, waiterLabel, guestCount }) => {
      const state = get();
      if (resolveHospitalityHardware(state.preferences).autoPrintReceipt) {
        void get().printRestaurantReceiptForSale(saleId, {
          tableLabel,
          waiterLabel,
          guestCount,
          receiptKind: "master",
        });
      }
      void get().openCashDrawerOnPayment(saleId);
      if (resolveHospitalityHardware(state.preferences).customerDisplayEnabled) {
        publishCustomerDisplay({
          shopName: state.preferences.shopDisplayName?.trim() || "Waka POS",
          tableLabel,
          lines: [],
          subtotalUgx: 0,
          totalUgx: 0,
          state: "thanks",
          updatedAt: new Date().toISOString(),
        });
      }
    },
    onBillVoided: ({ saleId, tableLabel, waiterLabel, guestCount }) => {
      void get().printRestaurantReceiptForSale(saleId, {
        tableLabel,
        waiterLabel,
        guestCount,
        voidReceipt: true,
        receiptKind: "void",
      });
    },
  }),

  ...createHospitalityMenuStoreActions({
    get,
    set,
    denyUnlessEffectivePermission,
    scheduleDraftPersist,
  }),

  ...createHardwarePrintStoreActions({
    get,
    set,
    pushAudit: (action, detail, meta) => pushAudit(action, detail, meta ?? {}),
    flushPendingPersist,
  }),

  ...(() => {
    const { closeShiftWithHandoff: _omit, ...dayDrawerActions } = createDayDrawerOpenStoreActions({
      get,
      set,
      pushAudit,
      queueRemote,
      denyUnlessEffectivePermission,
    });
    void _omit;
    return dayDrawerActions;
  })(),
};
});

function persistRelevantUnchanged(a: PosState, b: PosState): boolean {
  return (
    a.products === b.products &&
    a.customers === b.customers &&
    a.sales === b.sales &&
    a.preferences === b.preferences &&
    a.debtPayments === b.debtPayments &&
    a.dayCloses === b.dayCloses &&
    a.auditLogs === b.auditLogs &&
    a.suppliers === b.suppliers &&
    a.purchases === b.purchases &&
    a.supplierPayments === b.supplierPayments &&
    a.stockMovements === b.stockMovements &&
    a.archivedStockMovements === b.archivedStockMovements &&
    a.voidRecords === b.voidRecords &&
    a.returnRecords === b.returnRecords &&
    a.cashExpenses === b.cashExpenses &&
    a.cashDrawerAdjustments === b.cashDrawerAdjustments &&
    a.dayDrawerOpens === b.dayDrawerOpens &&
    a.inventoryCountSessions === b.inventoryCountSessions &&
    a.archivedSales === b.archivedSales &&
    a.archivedAuditLogs === b.archivedAuditLogs &&
    a.archivedDayCloses === b.archivedDayCloses &&
    a.archivedVoidRecords === b.archivedVoidRecords &&
    a.archivedReturnRecords === b.archivedReturnRecords
  );
}

usePosStore.subscribe((state, prev) => {
  if (!state._hydrated || persistSuspended > 0) return;
  if (prev && persistRelevantUnchanged(prev, state)) return;
  schedulePersist(prev ?? state, state);
});

function mergePreferencesFromPartial(raw: Partial<{ preferences?: ShopPreferences }>): ShopPreferences {
  const base = createDefaultPreferences();
  const p = raw.preferences;
  if (!p) {
    return { ...base, onboardingDone: true, schemaVersion: 2 };
  }
  const legacy = (p.schemaVersion ?? 0) < 2;
  const bt = p.businessType ?? base.businessType;
  const prof = getBusinessProfile(bt);
  return {
    businessType: bt,
    kioskQuickSell: typeof p.kioskQuickSell === "boolean" ? p.kioskQuickSell : prof.kioskQuickSellDefault,
    onboardingDone: legacy ? true : typeof p.onboardingDone === "boolean" ? p.onboardingDone : false,
    schemaVersion: 2,
    celebratedFirstSale: typeof p.celebratedFirstSale === "boolean" ? p.celebratedFirstSale : base.celebratedFirstSale,
    saleSoundOn: typeof p.saleSoundOn === "boolean" ? p.saleSoundOn : base.saleSoundOn ?? true,
    hapticsOn: typeof p.hapticsOn === "boolean" ? p.hapticsOn : base.hapticsOn ?? true,
    posUiMode: p.posUiMode === "owner_back_office" || p.posUiMode === "cashier" ? p.posUiMode : base.posUiMode ?? "cashier",
    devRoleOverride:
      p.devRoleOverride === undefined
        ? (base.devRoleOverride ?? null)
        : p.devRoleOverride === null
          ? null
          : parseStoredUserRole(p.devRoleOverride),
    cashVarianceThresholdPct:
      typeof p.cashVarianceThresholdPct === "number" && p.cashVarianceThresholdPct >= 0
        ? p.cashVarianceThresholdPct
        : base.cashVarianceThresholdPct ?? 5,
    cashVarianceThresholdUgxFixed:
      typeof p.cashVarianceThresholdUgxFixed === "number" && p.cashVarianceThresholdUgxFixed >= 0
        ? p.cashVarianceThresholdUgxFixed
        : base.cashVarianceThresholdUgxFixed ?? 10_000,
    lastAutoBackupDateKey: p.lastAutoBackupDateKey ?? base.lastAutoBackupDateKey,
    ownerRisksReviewedAt:
      p.ownerRisksReviewedAt === undefined
        ? (base.ownerRisksReviewedAt ?? null)
        : p.ownerRisksReviewedAt === null
          ? null
          : String(p.ownerRisksReviewedAt),
    ownerAlertAcknowledgements: Array.isArray(p.ownerAlertAcknowledgements)
      ? p.ownerAlertAcknowledgements
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const alertId = String((row as { alertId?: unknown }).alertId ?? "").trim();
            const acknowledgedAt = String((row as { acknowledgedAt?: unknown }).acknowledgedAt ?? "").trim();
            const acknowledgedBy = String((row as { acknowledgedBy?: unknown }).acknowledgedBy ?? "").trim();
            if (!alertId || !acknowledgedAt || !acknowledgedBy) return null;
            return { alertId, acknowledgedAt, acknowledgedBy };
          })
          .filter((row): row is { alertId: string; acknowledgedAt: string; acknowledgedBy: string } => row != null)
          .slice(-200)
      : (base.ownerAlertAcknowledgements ?? []),
    activeBranchId:
      p.activeBranchId === undefined
        ? (base.activeBranchId ?? null)
        : p.activeBranchId === null
          ? null
          : String(p.activeBranchId),
    branchDisplayName:
      p.branchDisplayName === undefined
        ? (base.branchDisplayName ?? null)
        : p.branchDisplayName === null
          ? null
          : String(p.branchDisplayName),
    backOfficePin:
      p.backOfficePin === undefined
        ? (base.backOfficePin ?? null)
        : p.backOfficePin === null || p.backOfficePin === ""
          ? null
          : String(p.backOfficePin).replace(/\D/g, "").slice(0, 6) || null,
    shopDisplayName:
      p.shopDisplayName === undefined
        ? (base.shopDisplayName ?? null)
        : p.shopDisplayName === null
          ? null
          : String(p.shopDisplayName),
    shopPhoneE164:
      p.shopPhoneE164 === undefined
        ? (base.shopPhoneE164 ?? null)
        : p.shopPhoneE164 === null
          ? null
          : String(p.shopPhoneE164),
    shopAddressLine:
      p.shopAddressLine === undefined
        ? (base.shopAddressLine ?? null)
        : p.shopAddressLine === null
          ? null
          : String(p.shopAddressLine),
    shopCurrency: normalizeShopCurrency(p.shopCurrency ?? base.shopCurrency),
    staffAccounts: normalizeStaffAccounts(p.staffAccounts),
    activeStaffId:
      p.activeStaffId === undefined
        ? (base.activeStaffId ?? null)
        : p.activeStaffId === null
          ? null
          : String(p.activeStaffId),
    posLocked: typeof p.posLocked === "boolean" ? p.posLocked : base.posLocked ?? false,
    biometricAuthEnabled:
      typeof p.biometricAuthEnabled === "boolean" ? p.biometricAuthEnabled : base.biometricAuthEnabled ?? false,
    shifts: normalizeShifts(p.shifts),
    favoriteProductIds: Array.isArray(p.favoriteProductIds)
      ? (p.favoriteProductIds as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 40)
      : base.favoriteProductIds,
    recentProductIds: Array.isArray(p.recentProductIds)
      ? (p.recentProductIds as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 60)
      : base.recentProductIds,
    posSellCategoryFilter:
      p.posSellCategoryFilter === undefined || p.posSellCategoryFilter === null || String(p.posSellCategoryFilter).trim() === ""
        ? undefined
        : String(p.posSellCategoryFilter).trim().slice(0, 120),
    posPinnedShelfKeys: Array.isArray(p.posPinnedShelfKeys)
      ? (p.posPinnedShelfKeys as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 40)
      : base.posPinnedShelfKeys ?? [],
    posShelfLayout:
      p.posShelfLayout === undefined ? (base.posShelfLayout ?? {}) : normalizePosShelfLayoutFromStore(p.posShelfLayout),
    posQuickSellProductIds: Array.isArray(p.posQuickSellProductIds)
      ? (p.posQuickSellProductIds as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 24)
      : base.posQuickSellProductIds ?? [],
    posShelfPresetId:
      p.posShelfPresetId === undefined
        ? (base.posShelfPresetId ?? null)
        : p.posShelfPresetId === null
          ? null
          : isPosShelfPresetId(p.posShelfPresetId)
            ? p.posShelfPresetId
            : (base.posShelfPresetId ?? null),
    posShelfDefaultScale:
      p.posShelfDefaultScale === undefined
        ? (base.posShelfDefaultScale ?? 35)
        : clampShelfScale(Number(p.posShelfDefaultScale) || 35),
    launcherTileOrder: Array.isArray(p.launcherTileOrder)
      ? (p.launcherTileOrder as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
      : base.launcherTileOrder ?? [],
    launcherTileLayout:
      p.launcherTileLayout === undefined
        ? (base.launcherTileLayout ?? {})
        : normalizeLauncherTileLayout(p.launcherTileLayout),
    homeHeroPreviewBgColor:
      p.homeHeroPreviewBgColor === undefined
        ? (base.homeHeroPreviewBgColor ?? null)
        : p.homeHeroPreviewBgColor === null
          ? null
          : normalizeShelfHex(p.homeHeroPreviewBgColor),
    officeHubTileOrder: Array.isArray(p.officeHubTileOrder)
      ? (p.officeHubTileOrder as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 10)
      : base.officeHubTileOrder ?? [],
    officeHubTileLayout:
      p.officeHubTileLayout === undefined
        ? (base.officeHubTileLayout ?? {})
        : normalizeOfficeHubTileLayout(p.officeHubTileLayout),
    receiptPaperSize:
      p.receiptPaperSize === "58mm" || p.receiptPaperSize === "80mm" || p.receiptPaperSize === "a4"
        ? p.receiptPaperSize
        : base.receiptPaperSize ?? "80mm",
    dataRetentionPolicy: normalizeDataRetentionPolicy(p.dataRetentionPolicy ?? base.dataRetentionPolicy),
    archivedShifts: normalizeShifts(p.archivedShifts ?? base.archivedShifts),
    lastMonthlyReportPromptMonth:
      p.lastMonthlyReportPromptMonth === undefined
        ? (base.lastMonthlyReportPromptMonth ?? null)
        : p.lastMonthlyReportPromptMonth === null
          ? null
          : String(p.lastMonthlyReportPromptMonth).slice(0, 7) || null,
    lastArchiveRunAt:
      p.lastArchiveRunAt === undefined ? (base.lastArchiveRunAt ?? null) : p.lastArchiveRunAt === null ? null : String(p.lastArchiveRunAt),
    discountControlMode:
      p.discountControlMode === "manager_approval" || p.discountControlMode === "max_percent"
        ? p.discountControlMode
        : (base.discountControlMode ?? "unrestricted"),
    discountMaxPercentThreshold:
      typeof p.discountMaxPercentThreshold === "number" && p.discountMaxPercentThreshold >= 0 && p.discountMaxPercentThreshold <= 100
        ? p.discountMaxPercentThreshold
        : (base.discountMaxPercentThreshold ?? 10),
    cashDrawerFormulaVersion:
      p.cashDrawerFormulaVersion === "v2" ? "v2" : p.cashDrawerFormulaVersion === "v1" ? "v1" : (base.cashDrawerFormulaVersion ?? undefined),
    ownerDayOpenCorrectionAfterSales:
      p.ownerDayOpenCorrectionAfterSales === true
        ? true
        : p.ownerDayOpenCorrectionAfterSales === false
          ? false
          : (base.ownerDayOpenCorrectionAfterSales ?? false),
  };
}

async function restoreDraftSaleFromDisk(): Promise<void> {
  const draft = await readPersistedDraft();
  if (!draft) return;
  const products = usePosStore.getState().products;
  const { draftLines, draftInput } = resolveDraftFromPersisted(draft, products);
  if (draftLines.length > 0 || draftInput || (draft.draftCartDiscountUgx ?? 0) > 0) {
    usePosStore.setState({
      draftLines,
      draftInput,
      draftCartDiscountUgx: Math.max(0, Math.floor(draft.draftCartDiscountUgx ?? 0)),
    });
  }
}

const SALES_HYDRATE_BATCH = isNativeApp() ? 50 : 120;
const SALES_RESTORE_BATCH = isNativeApp() ? 12 : 60;
const ARCHIVED_RESTORE_BATCH = isNativeApp() ? 12 : 60;

/** Stop an in-progress backup restore (import / local copy). */
export function cancelBackupRestoreInProgress(): void {
  cancelBackupRestoreSession();
}

async function hydrateSalesBatched(
  raw: Sale[],
  opts?: { batchSize?: number; sessionId?: number; onProgress?: (percent: number) => void },
): Promise<void> {
  if (raw.length === 0) {
    usePosStore.setState({ sales: [] });
    opts?.onProgress?.(100);
    return;
  }
  const batch = opts?.batchSize ?? SALES_HYDRATE_BATCH;
  const normalized: Sale[] = [];
  for (let i = 0; i < raw.length; i += batch) {
    assertBackupRestoreNotAborted(opts?.sessionId);
    const chunk = raw.slice(i, i + batch);
    normalized.push(...chunk.map((s) => normalizeSale(s as Sale)));
    opts?.onProgress?.(Math.min(100, Math.round(((i + chunk.length) / raw.length) * 100)));
    if (i + batch < raw.length) {
      await yieldUiTick();
    }
  }
  usePosStore.setState({ sales: normalized });
}

async function hydrateArchivedSalesBatched(
  raw: Sale[],
  opts?: { batchSize?: number; sessionId?: number; onProgress?: (percent: number) => void },
): Promise<void> {
  if (raw.length === 0) {
    usePosStore.setState({ archivedSales: [] });
    opts?.onProgress?.(100);
    return;
  }
  const batch = opts?.batchSize ?? ARCHIVED_RESTORE_BATCH;
  const normalized: Sale[] = [];
  for (let i = 0; i < raw.length; i += batch) {
    assertBackupRestoreNotAborted(opts?.sessionId);
    const chunk = raw.slice(i, i + batch);
    normalized.push(...chunk.map((s) => normalizeSale(s as Sale)));
    opts?.onProgress?.(Math.min(100, Math.round(((i + chunk.length) / raw.length) * 100)));
    if (i + batch < raw.length) {
      await yieldUiTick();
    }
  }
  usePosStore.setState({ archivedSales: normalized });
}

function reportRestoreProgress(
  onProgress: ((percent: number) => void) | undefined,
  sliceStart: number,
  sliceEnd: number,
  innerPct: number,
): void {
  if (!onProgress) return;
  const span = sliceEnd - sliceStart;
  onProgress(sliceStart + Math.round((innerPct / 100) * span));
}

/** Write current in-memory store to IndexedDB after a restore (can run after UI unblocks). */
export async function persistRestoredSnapshotToDisk(
  sessionId?: number,
  opts?: { cloudRecovery?: boolean },
): Promise<void> {
  const { assertOrganizationOperationsAllowed, ORGANIZATION_DELETED_ERROR } = await import(
    "../lib/organizationDeletionState",
  );
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    usePosStore.getState().logAuditAction("auth_forbidden", "Denied backup persist — organization deleted", {
      permission: "settings.shop",
      action: "backup_persist",
      errorKey: ORGANIZATION_DELETED_ERROR,
    });
    throw new Error(ORGANIZATION_DELETED_ERROR);
  }

  const { snapshot, authMode } = getStoreSubscriptionContext();
  const restoreAuth = authorizeBackupRestore({
    actor: usePosStore.getState().sessionActor,
    snapshot,
    authMode,
    purpose: opts?.cloudRecovery ? "cloud_recovery" : "user_import",
  });
  if (!restoreAuth.ok) {
    usePosStore.getState().logAuditAction("auth_forbidden", "Denied backup persist", {
      permission: "settings.shop",
      action: "backup_persist",
      errorKey: restoreAuth.errorKey,
    });
    throw new Error(restoreAuth.errorKey);
  }

  assertBackupRestoreNotAborted(sessionId);
  await yieldUiTick();
  assertBackupRestoreNotAborted(sessionId);
  const s = usePosStore.getState();
  const { flushFullSnapshotPersist } = await import("../offline/incrementalPersist");
  await flushFullSnapshotPersist(s, { skipLastGood: true });
}

/**
 * Restore a full backup into memory without blocking the UI (batched sales).
 * Call persistRestoredSnapshotToDisk() afterward to save to the phone.
 */
export async function applyRestoredSnapshotFromBackup(
  snap: PersistedSnapshot,
  opts?: { sessionId?: number; onProgress?: (percent: number) => void; cloudRecovery?: boolean },
): Promise<void> {
  const { assertOrganizationOperationsAllowed, ORGANIZATION_DELETED_ERROR } = await import(
    "../lib/organizationDeletionState",
  );
  try {
    await assertOrganizationOperationsAllowed();
  } catch {
    usePosStore.getState().logAuditAction("auth_forbidden", "Denied backup restore — organization deleted", {
      permission: "settings.shop",
      action: "backup_restore",
      errorKey: ORGANIZATION_DELETED_ERROR,
    });
    throw new Error(ORGANIZATION_DELETED_ERROR);
  }

  const { attachTombstonesToSnapshot, tombstonesFromSnapshot } = await import("../lib/tombstoneDurability");
  const restoredSnap = attachTombstonesToSnapshot(snap, tombstonesFromSnapshot(snap));

  const { snapshot, authMode } = getStoreSubscriptionContext();
  const restoreAuth = authorizeBackupRestore({
    actor: usePosStore.getState().sessionActor,
    snapshot,
    authMode,
    purpose: opts?.cloudRecovery ? "cloud_recovery" : "user_import",
  });
  if (!restoreAuth.ok) {
    usePosStore.getState().logAuditAction("auth_forbidden", "Denied backup restore", {
      permission: "settings.shop",
      action: "backup_restore",
      errorKey: restoreAuth.errorKey,
    });
    throw new Error(restoreAuth.errorKey);
  }

  const sessionId = opts?.sessionId;
  const release = suspendStorePersist();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (draftPersistTimer) {
    clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
  }

  try {
    assertBackupRestoreNotAborted(sessionId);
    const preferences = mergePreferencesFromPartial({ preferences: restoredSnap.preferences });

    usePosStore.getState().hydrateEssentials({
      products: restoredSnap.products.map(normalizeProduct),
      customers: (restoredSnap.customers ?? []).map(normalizeCustomer),
      preferences,
    });
    reportRestoreProgress(opts?.onProgress, 0, 8, 100);
    await yieldUiTick();

    assertBackupRestoreNotAborted(sessionId);
    usePosStore.getState().hydrateRemainder({
      debtPayments: restoredSnap.debtPayments ?? [],
      dayCloses: restoredSnap.dayCloses ?? [],
      auditLogs: restoredSnap.auditLogs ?? [],
      suppliers: (restoredSnap.suppliers ?? []).map(normalizeSupplier),
      purchases: (restoredSnap.purchases ?? []).map(normalizePurchase),
      supplierPayments: (restoredSnap.supplierPayments ?? []).map(normalizeSupplierPayment),
      stockMovements: (restoredSnap.stockMovements ?? []).map(normalizeStockMovement),
      voidRecords: restoredSnap.voidRecords ?? [],
      returnRecords: restoredSnap.returnRecords ?? [],
      cashExpenses: (restoredSnap.cashExpenses ?? []).map(normalizeCashExpense),
      cashDrawerAdjustments: (restoredSnap.cashDrawerAdjustments ?? []).map(normalizeCashDrawerAdjustment),
      dayDrawerOpens: (restoredSnap.dayDrawerOpens ?? []).map(normalizeDayDrawerOpen),
      inventoryCountSessions: (restoredSnap.inventoryCountSessions ?? []).map(normalizeInventoryCountSession),
      archivedSales: [],
      archivedAuditLogs: restoredSnap.archivedAuditLogs ?? [],
      archivedDayCloses: restoredSnap.archivedDayCloses ?? [],
      archivedVoidRecords: restoredSnap.archivedVoidRecords ?? [],
      archivedReturnRecords: restoredSnap.archivedReturnRecords ?? [],
    });
    reportRestoreProgress(opts?.onProgress, 8, 12, 100);
    await yieldUiTick();

    await hydrateSalesBatched(restoredSnap.sales, {
      sessionId,
      batchSize: SALES_RESTORE_BATCH,
      onProgress: (p) => reportRestoreProgress(opts?.onProgress, 12, 82, p),
    });

    assertBackupRestoreNotAborted(sessionId);
    await hydrateArchivedSalesBatched(restoredSnap.archivedSales ?? [], {
      sessionId,
      batchSize: ARCHIVED_RESTORE_BATCH,
      onProgress: (p) => reportRestoreProgress(opts?.onProgress, 82, 100, p),
    });

    void clearPersistedDraft();
    await yieldUiTick();

    const { clearSyncQueueForRestore } = await import("../lib/restoreSyncSafety");
    await clearSyncQueueForRestore();

    const { migrateSnapshotToEntities } = await import("../offline/entityStore");
    await migrateSnapshotToEntities(restoredSnap);

    const restored = usePosStore.getState();
    const { runPostRestoreValidationSnapshot } = await import("../lib/postRestoreValidation");
    runPostRestoreValidationSnapshot({
      products: restored.products,
      stockMovements: restored.stockMovements,
      customers: restored.customers,
      sales: restored.sales,
      debtPayments: restored.debtPayments,
      suppliers: restored.suppliers,
      purchases: restored.purchases,
      supplierPayments: restored.supplierPayments,
    });
  } finally {
    release();
  }
}

function scheduleHydrateRemainderFromSnap(snap: Partial<PersistedSnapshot>): void {
  const run = () => {
    void (async () => {
      if (!usePosStore.getState()._hydrated) return;
      const allSales = (snap.sales ?? []) as Sale[];
      const head = allSales.slice(0, INITIAL_SALES_LOAD_COUNT);
      const tail = allSales.slice(INITIAL_SALES_LOAD_COUNT);
      await hydrateSalesBatched(head);
      usePosStore.getState().hydrateRemainder({
        debtPayments: snap.debtPayments ?? [],
        dayCloses: snap.dayCloses ?? [],
        auditLogs: (snap as { auditLogs?: AuditLogEntry[] }).auditLogs ?? [],
        suppliers: (snap as { suppliers?: Supplier[] }).suppliers ?? [],
        purchases: (snap as { purchases?: Purchase[] }).purchases ?? [],
        supplierPayments: (snap as { supplierPayments?: SupplierPayment[] }).supplierPayments ?? [],
        stockMovements: (snap as { stockMovements?: StockMovement[] }).stockMovements ?? [],
        voidRecords: (snap as { voidRecords?: VoidRecord[] }).voidRecords ?? [],
        returnRecords: (snap as { returnRecords?: ReturnRecord[] }).returnRecords ?? [],
        cashExpenses: ((snap as { cashExpenses?: CashExpense[] }).cashExpenses ?? []).map(normalizeCashExpense),
        cashDrawerAdjustments: ((snap as { cashDrawerAdjustments?: CashDrawerAdjustment[] }).cashDrawerAdjustments ?? []).map(
          normalizeCashDrawerAdjustment,
        ),
        dayDrawerOpens: ((snap as { dayDrawerOpens?: DayDrawerOpen[] }).dayDrawerOpens ?? []).map(normalizeDayDrawerOpen),
        inventoryCountSessions: ((snap as { inventoryCountSessions?: InventoryCountSession[] }).inventoryCountSessions ?? []).map(
          normalizeInventoryCountSession,
        ),
        archivedSales: (snap.archivedSales ?? []).map(normalizeSale),
        archivedAuditLogs: snap.archivedAuditLogs ?? [],
        archivedDayCloses: snap.archivedDayCloses ?? [],
        archivedVoidRecords: snap.archivedVoidRecords ?? [],
        archivedReturnRecords: snap.archivedReturnRecords ?? [],
      });
      if (tail.length > 0) {
        scheduleBackgroundSalesHydrate(tail);
      }
    })();
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 800 });
  } else {
    setTimeout(run, 0);
  }
}

/** Load remaining sales from entity store in background pages. */
function scheduleBackgroundSalesHydrateByIds(ids: string[]): void {
  void (async () => {
    const { getEntitiesByIds } = await import("../offline/entityStore");
    usePosStore.setState({ salesHistoryHydration: { active: true, loaded: 0, total: ids.length } });
    let loaded = 0;
    for (let i = 0; i < ids.length; i += SALES_PAGE_LOAD_SIZE) {
      await yieldUiTick();
      const batch = (await getEntitiesByIds<Sale>("sale", ids.slice(i, i + SALES_PAGE_LOAD_SIZE))).map(normalizeSale);
      loaded += batch.length;
      usePosStore.setState((s) => {
        const have = new Set(s.sales.map((x) => x.id));
        const merged = [...s.sales];
        for (const row of batch) {
          if (!have.has(row.id)) merged.push(row);
        }
        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        return {
          sales: merged,
          salesHistoryHydration: { active: true, loaded, total: ids.length },
        };
      });
    }
    usePosStore.setState({ salesHistoryHydration: null });
  })();
}

/** Load remaining sales in background without blocking checkout. */
function scheduleBackgroundSalesHydrate(sales: Sale[]): void {
  void (async () => {
    usePosStore.setState({ salesHistoryHydration: { active: true, loaded: 0, total: sales.length } });
    let loaded = 0;
    for (let i = 0; i < sales.length; i += SALES_PAGE_LOAD_SIZE) {
      await yieldUiTick();
      const chunk = sales.slice(i, i + SALES_PAGE_LOAD_SIZE);
      loaded += chunk.length;
      usePosStore.setState((s) => {
        const have = new Set(s.sales.map((x) => x.id));
        const merged = [...s.sales];
        for (const row of chunk) {
          if (!have.has(row.id)) merged.push(normalizeSale(row));
        }
        merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        return {
          sales: merged,
          salesHistoryHydration: { active: true, loaded, total: sales.length },
        };
      });
    }
    usePosStore.setState({ salesHistoryHydration: null });
  })();
}

/** True when every active sale id from the entity manifest is present in RAM. */
export async function isActiveSalesFullyLoaded(): Promise<boolean> {
  const { readEntityManifest } = await import("../offline/entityStore");
  const manifest = await readEntityManifest();
  if (!manifest) return true;
  const have = new Set(usePosStore.getState().sales.map((s) => s.id));
  return manifest.salesOrder.every((id) => have.has(id));
}

/** Load any sales not yet in RAM (reports/search). */
export async function ensureAllActiveSalesLoaded(): Promise<void> {
  const { readEntityManifest, getEntitiesByIds } = await import("../offline/entityStore");
  const manifest = await readEntityManifest();
  if (!manifest) return;
  const state = usePosStore.getState();
  const have = new Set(state.sales.map((s) => s.id));
  const missingIds = manifest.salesOrder.filter((id) => !have.has(id));
  if (missingIds.length === 0) return;
  for (let i = 0; i < missingIds.length; i += SALES_PAGE_LOAD_SIZE) {
    await yieldUiTick();
    const batch = await getEntitiesByIds<Sale>("sale", missingIds.slice(i, i + SALES_PAGE_LOAD_SIZE));
    usePosStore.setState((s) => {
      const ids = new Set(s.sales.map((x) => x.id));
      const merged = [...s.sales];
      for (const row of batch) {
        if (!ids.has(row.id)) merged.push(normalizeSale(row));
      }
      merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { sales: merged };
    });
  }
}

function snapshotHasInventoryOrSales(snap: Partial<PersistedSnapshot> | null | undefined): boolean {
  return Boolean(snap && ((snap.products?.length ?? 0) > 0 || (snap.sales?.length ?? 0) > 0));
}

async function resolveLegacySnapshotIfEmpty(
  snap: Partial<PersistedSnapshot> | null,
): Promise<Partial<PersistedSnapshot> | null> {
  if (snapshotHasInventoryOrSales(snap)) return snap;
  const legacyIdb = await claimLegacySnapshotForCurrentAccount();
  if (legacyIdb) return legacyIdb;
  const legacy = tryMigrateLegacyLocalStorage();
  if (!legacy) return snap;
  const migrated = {
    products: legacy.products.map(normalizeProduct),
    customers: legacy.customers.map(normalizeCustomer),
    sales: legacy.sales.map(normalizeSale),
    preferences: { ...createDefaultPreferences(), onboardingDone: true, schemaVersion: 2 },
    debtPayments: [] as DebtPayment[],
    dayCloses: [] as DayCloseSummary[],
    auditLogs: [] as AuditLogEntry[],
    suppliers: [] as Supplier[],
    purchases: [] as Purchase[],
    supplierPayments: [] as SupplierPayment[],
    stockMovements: [] as StockMovement[],
    voidRecords: [] as VoidRecord[],
    returnRecords: [] as ReturnRecord[],
  };
  void writeSnapshot(migrated);
  clearLegacyLocalStorage();
  return migrated;
}

function applyBootstrapPreferences(snap: Partial<PersistedSnapshot>): ShopPreferences {
  const preferences = mergePreferencesFromPartial(snap);
  const pendingStaff = readPendingStaffSelection();
  const activeKey = getActiveAccountKey();
  if (pendingStaff && activeKey && pendingStaff.accountKey === activeKey) {
    const exists = (preferences.staffAccounts ?? []).some((s) => s.id === pendingStaff.staffId && s.active);
    preferences.activeStaffId = exists ? pendingStaff.staffId : null;
    clearPendingStaffSelection();
  }
  return preferences;
}

/** Non-blocking follow-up after the shell can render (draft, prune, cloud pull). */
function schedulePostBootstrapTasks(): void {
  const run = () => {
    void runPostBootstrapTasks();
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 0);
  }
}

async function runPostBootstrapTasks(): Promise<void> {
  if (!usePosStore.getState()._hydrated) return;
  usePosStore.getState().bootstrapResumePrintQueue();
  void restoreDraftSaleFromDisk();
  runWhenIdle(() => {
    const state = usePosStore.getState();
    const actor = state.sessionActor;
    const { snapshot, authMode } = getStoreSubscriptionContext();
    if (!checkStorePermissionEffective(actor, "settings.shop", snapshot, authMode).ok) return;
    state.runDataArchive();
  }, 4000);

  if (!readStaffSession() && usePosStore.getState().preferences.activeStaffId) {
    usePosStore.getState().switchStaffAccount(null, { force: true });
  }

  const key = getActiveAccountKey();
  if (!hasSupabaseConfig || !key?.startsWith("sb:")) return;
  const { shouldPausePosBackgroundPull } = await import("../lib/backgroundWorkPolicy");

  const { supabase: sb } = await import("../lib/supabase");
  if (!sb) return;
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user) return;

  const { hydrateLocalShopProfileFromCloud } = await import("../lib/businessProfile");
  const { applyShopRecoverySignalsForCurrentShop } = await import("../lib/shopRecoverySignals");
  void hydrateLocalShopProfileFromCloud().catch(() => undefined);
  void applyShopRecoverySignalsForCurrentShop().catch(() => undefined);
  const { isCloudRecoveryLockActive } = await import("../lib/cloudRecoverySession");
  if (isCloudRecoveryLockActive()) return;
  const { shouldRequireRecoveryLock } = await import("../lib/postAuthCloudHydrate");
  if (await shouldRequireRecoveryLock().catch(() => true)) return;
  const { isLocalShopDataEmpty } = await import("../lib/cloudSnapshotSync");
  const localEmpty = isLocalShopDataEmpty();
  if (shouldPausePosBackgroundPull()) {
    const { schedulePushPendingUploads } = await import("../lib/posPushScheduler");
    schedulePushPendingUploads();
    return;
  }
  const { scheduleBackgroundCloudSync } = await import("../offline/cloudSync");
  scheduleBackgroundCloudSync({
    pull: localEmpty,
    delayMs: isNativeApp() ? 2_500 : 800,
  });
}

function hydrateEssentialsFromSnap(snap: Partial<PersistedSnapshot>): void {
  const preferences = applyBootstrapPreferences(snap);
  usePosStore.getState().hydrateEssentials({
    products: (snap.products ?? []) as Product[],
    customers: (snap.customers ?? []) as Customer[],
    preferences,
  });
}

function scheduleLegacySnapshotMigration(initialSnap: Partial<PersistedSnapshot> | null): void {
  void (async () => {
    const legacySnap = await resolveLegacySnapshotIfEmpty(initialSnap);
    if (!legacySnap || !snapshotHasInventoryOrSales(legacySnap)) return;
    if (!usePosStore.getState()._hydrated) return;
    hydrateEssentialsFromSnap(legacySnap);
    scheduleHydrateRemainderFromSnap(legacySnap);
    const next = usePosStore.getState();
    void writeSnapshot({
      products: next.products,
      customers: next.customers,
      sales: next.sales,
      preferences: next.preferences,
      debtPayments: next.debtPayments,
      dayCloses: next.dayCloses,
      auditLogs: next.auditLogs,
      suppliers: next.suppliers,
      purchases: next.purchases,
      supplierPayments: next.supplierPayments,
      stockMovements: next.stockMovements,
      voidRecords: next.voidRecords,
      returnRecords: next.returnRecords,
    });
  })();
}

const BOOTSTRAP_DISK_TIMEOUT_MS = 12_000;

/** Returning Supabase owners should not be sent through new-shop onboarding after a slow/empty disk read. */
function preferencesForAccountBootstrap(key: string): ShopPreferences {
  const preferences = createDefaultPreferences();
  const userId = key.startsWith("sb:") ? key.slice(3) : null;
  const pending = userId ? readPendingRegistrationProfileForUser(userId) : null;
  const existing = usePosStore.getState().preferences;

  const shopDisplayName =
    pending?.shopDisplayName?.trim() || existing.shopDisplayName?.trim() || null;
  if (shopDisplayName) preferences.shopDisplayName = shopDisplayName;

  const shopPhone = pending?.phoneE164 ?? existing.shopPhoneE164 ?? null;
  if (shopPhone) preferences.shopPhoneE164 = shopPhone;

  if (existing.shopCurrency) preferences.shopCurrency = existing.shopCurrency;

  if (userId && (isWorkspaceBootstrapped(userId) || readCachedOwnerOnboardingComplete(userId) === true)) {
    preferences.onboardingDone = true;
    preferences.onboardingWizardDone = true;
    preferences.schemaVersion = 2;
  }
  return preferences;
}

/** Load local POS data; never hang the UI longer than BOOTSTRAP_DISK_TIMEOUT_MS. */
export async function bootstrapPosFromDisk(): Promise<void> {
  const { markBootstrapStart, markBootstrapEnd } = await import("../lib/performanceMetrics");
  markBootstrapStart();
  const key = getActiveAccountKey();
  if (!key) {
    usePosStore.getState().resetForSignOut();
    markBootstrapEnd();
    return;
  }
  if (key.startsWith("demo:")) {
    usePosStore.getState().resetForSignOut();
    const prefs = createDefaultPreferences();
    prefs.onboardingDone = true;
    prefs.shopDisplayName = "Demo shop";
    prefs.kioskQuickSell = true;
    const products = createDefaultProducts();
    usePosStore.getState().hydrateEssentials({
      products,
      customers: [],
      preferences: prefs,
    });
    markBootstrapEnd();
    schedulePostBootstrapTasks();
    return;
  }

  const load = async () => {
    const { readEntityManifest, getEntitiesByBucket, getEntitiesByIds, migrateSnapshotToEntities } = await import(
      "../offline/entityStore",
    );
    const manifest = await readEntityManifest();
    if (manifest) {
      const products = (await getEntitiesByBucket<Product>("product")).map(normalizeProduct);
      const customers = (await getEntitiesByBucket<Customer>("customer")).map(normalizeCustomer);
      const tombstones = manifest.tombstones ?? {};
      const voidedSales = manifest.voidedSaleIds ?? {};
      const filteredProducts = products.filter((p) => !tombstones[p.id]);
      usePosStore.getState().hydrateEssentials({
        products: filteredProducts,
        customers,
        preferences: manifest.preferences,
      });
      const headIds = manifest.salesOrder
        .slice(0, INITIAL_SALES_LOAD_COUNT)
        .filter((id) => !voidedSales[id]);
      const headSales = (await getEntitiesByIds<Sale>("sale", headIds)).map(normalizeSale);
      await hydrateSalesBatched(headSales);
      if (manifest.salesOrder.length > INITIAL_SALES_LOAD_COUNT) {
        scheduleBackgroundSalesHydrateByIds(
          manifest.salesOrder.slice(INITIAL_SALES_LOAD_COUNT).filter((id) => !voidedSales[id]),
        );
      }
      const [
        debtPaymentsRaw,
        dayClosesRaw,
        auditLogsRaw,
        suppliersRaw,
        purchasesRaw,
        supplierPaymentsRaw,
        stockMovementsRaw,
        voidRecordsRaw,
        returnRecordsRaw,
        cashExpensesRaw,
        cashDrawerAdjustmentsRaw,
        dayDrawerOpensRaw,
        inventoryCountSessionsRaw,
        archivedAuditLogsRaw,
        archivedDayClosesRaw,
        archivedVoidRecordsRaw,
        archivedReturnRecordsRaw,
      ] = await Promise.all([
        getEntitiesByBucket<DebtPayment>("debtPayment"),
        getEntitiesByBucket<DayCloseSummary>("dayClose"),
        getEntitiesByBucket<AuditLogEntry>("auditLog"),
        getEntitiesByBucket<Supplier>("supplier"),
        getEntitiesByBucket<Purchase>("purchase"),
        getEntitiesByBucket<SupplierPayment>("supplierPayment"),
        getEntitiesByBucket<StockMovement>("stockMovement"),
        getEntitiesByBucket<VoidRecord>("voidRecord"),
        getEntitiesByBucket<ReturnRecord>("returnRecord"),
        getEntitiesByBucket<CashExpense>("cashExpense"),
        getEntitiesByBucket<CashDrawerAdjustment>("cashDrawerAdjustment"),
        getEntitiesByBucket<DayDrawerOpen>("dayDrawerOpen"),
        getEntitiesByBucket<InventoryCountSession>("inventoryCountSession"),
        getEntitiesByBucket<AuditLogEntry>("archivedAuditLog"),
        getEntitiesByBucket<DayCloseSummary>("archivedDayClose"),
        getEntitiesByBucket<VoidRecord>("archivedVoidRecord"),
        getEntitiesByBucket<ReturnRecord>("archivedReturnRecord"),
      ]);
      const archivedSalesRaw = (await getEntitiesByIds<Sale>("archivedSale", manifest.archivedSalesOrder)).map(
        normalizeSale,
      );
      const remainder = {
        debtPayments: debtPaymentsRaw,
        dayCloses: dayClosesRaw,
        auditLogs: auditLogsRaw,
        suppliers: suppliersRaw.map(normalizeSupplier),
        purchases: purchasesRaw.map(normalizePurchase),
        supplierPayments: supplierPaymentsRaw.map(normalizeSupplierPayment),
        stockMovements: stockMovementsRaw.map(normalizeStockMovement),
        voidRecords: voidRecordsRaw,
        returnRecords: returnRecordsRaw,
        cashExpenses: cashExpensesRaw.map(normalizeCashExpense),
        cashDrawerAdjustments: cashDrawerAdjustmentsRaw.map(normalizeCashDrawerAdjustment),
        dayDrawerOpens: dayDrawerOpensRaw.map(normalizeDayDrawerOpen),
        inventoryCountSessions: inventoryCountSessionsRaw.map(normalizeInventoryCountSession),
        archivedSales: archivedSalesRaw,
        archivedAuditLogs: archivedAuditLogsRaw,
        archivedDayCloses: archivedDayClosesRaw,
        archivedVoidRecords: archivedVoidRecordsRaw,
        archivedReturnRecords: archivedReturnRecordsRaw,
      };
      usePosStore.getState().hydrateRemainder({
        debtPayments: remainder.debtPayments,
        dayCloses: remainder.dayCloses,
        auditLogs: remainder.auditLogs,
        suppliers: remainder.suppliers,
        purchases: remainder.purchases,
        supplierPayments: remainder.supplierPayments,
        stockMovements: remainder.stockMovements,
        voidRecords: remainder.voidRecords,
        returnRecords: remainder.returnRecords,
        cashExpenses: remainder.cashExpenses,
        cashDrawerAdjustments: remainder.cashDrawerAdjustments,
        dayDrawerOpens: remainder.dayDrawerOpens,
        inventoryCountSessions: remainder.inventoryCountSessions,
        archivedSales: remainder.archivedSales,
        archivedAuditLogs: remainder.archivedAuditLogs,
        archivedDayCloses: remainder.archivedDayCloses,
        archivedVoidRecords: remainder.archivedVoidRecords,
        archivedReturnRecords: remainder.archivedReturnRecords,
      });
      return;
    }

    const snap = await readSnapshotWithFallback();
    if (snap) {
      void migrateSnapshotToEntities(snap as PersistedSnapshot);
    }
    if (snapshotHasInventoryOrSales(snap)) {
      hydrateEssentialsFromSnap(snap!);
      scheduleHydrateRemainderFromSnap(snap!);
      return;
    }

    if (snap) {
      hydrateEssentialsFromSnap(snap);
    } else {
      const preferences = preferencesForAccountBootstrap(key);
      usePosStore.getState().hydrateEssentials({ products: [], customers: [], preferences });
      // Supabase accounts: skip empty disk write until cloud recovery completes (P0 snapshot safety).
      if (!key.startsWith("sb:")) {
        void writeSnapshot({
          products: [],
          customers: [],
          sales: [],
          preferences,
          debtPayments: [],
          dayCloses: [],
          auditLogs: [],
          suppliers: [],
          purchases: [],
          supplierPayments: [],
          stockMovements: [],
          voidRecords: [],
          returnRecords: [],
        });
      }
    }
    scheduleLegacySnapshotMigration(snap);
  };

  try {
    await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("bootstrap_timeout")), BOOTSTRAP_DISK_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    if (!usePosStore.getState()._hydrated) {
      usePosStore.getState().hydrateEssentials({
        products: [],
        customers: [],
        preferences: preferencesForAccountBootstrap(key),
      });
    }
    if (import.meta.env.DEV) console.warn("[waka-pos] bootstrap disk", e);
  }
  markBootstrapEnd();
  schedulePostBootstrapTasks();
}

export function formatProductPriceLabel(product: Product): string {
  const u = product.baseUnit || "ea";
  const p = pricePerBaseUnitUgx(product);
  if (p <= 0) return "—";
  if (product.sellingMode === "unit") return `${p.toLocaleString()} UGX`;
  return `${p.toLocaleString()} UGX / ${u}`;
}
