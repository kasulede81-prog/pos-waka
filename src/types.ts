export type Language = "en" | "lg" | "sw";

/** POS staff role — persisted in snapshot + Supabase `shop_members` / user metadata when configured. */
export type UserRole = "owner" | "manager" | "cashier" | "stock_keeper" | "supervisor" | "waiter" | "kitchen" | "bar";

/**
 * Fine-grained capabilities for UI and mutations.
 * See `src/lib/permissions.ts` for the role → permission matrix.
 */
export type Permission =
  | "pos.sell"
  | "sale_void"
  | "stock.view"
  | "stock.adjust"
  | "stock.count"
  | "products.add"
  | "products.remove"
  | "products.edit_presets"
  | "customers.view"
  | "customers.debt"
  | "day.close"
  /** Record official shop drawer open for the day (owner/manager/supervisor). */
  | "day.open_drawer"
  /** Manager override when cashier float verification mismatches. */
  | "day.verify_opening_float"
  /** Open a cashier shift after day drawer is open. */
  | "shift.start"
  /** Close shift with cash count and handoff. */
  | "shift.close"
  | "reports.view"
  | "reports.profit"
  | "settings.view"
  | "settings.shop"
  /** Receipt header/footer branding (owner + manager) */
  | "settings.receipt"
  | "settings.devices"
  | "owner.dashboard"
  | "owner.activity"
  | "owner.cash_history"
  | "nav.office"
  | "ui.toggle_mode"
  /** View suppliers and balances */
  | "suppliers.view"
  /** Add/edit suppliers and record supplier payments */
  | "suppliers.manage"
  /** Record stock-in / purchases (restock) */
  | "purchases.record"
  /** Write off expired pharmacy stock (owner/manager) */
  | "pharmacy.expired_writeoff"
  /** Access pharmacy workspace routes */
  | "pharmacy.access"
  /** View purchase history in reports and product detail */
  | "purchases.view"
  /** Void a recorded purchase (reverse stock and supplier balance) */
  | "purchases.void"
  /** Stock, suppliers, reports, settings hub — not for cashiers */
  | "back_office.access"
  /** View / print receipts (today’s slips) without full reports */
  | "receipts.view"
  /** Record cash taken from the drawer (lunch, transport, etc.) */
  | "expenses.record"
  /** Edit cash expense entries */
  | "expenses.edit"
  /** Remove / void cash expense entries */
  | "expenses.delete"
  /** Approve or reject pending cashier expenses */
  | "expenses.approve"
  /** Restaurant/bar floor plan and table service */
  | "hospitality.floor"
  | "hospitality.order"
  | "hospitality.settle"
  | "hospitality.transfer"
  | "hospitality.kitchen"
  /** Hold cart / open table bill without completing */
  | "pending_sales.manage"
  /** Customize Sell screen shelf layout (owner, manager, stock keeper) */
  | "shelves.customize"
  /** Enterprise HQ workspace access (Phase 10) */
  | "enterprise.access"
  | "enterprise.branches"
  | "enterprise.dashboard"
  | "enterprise.transfers"
  | "enterprise.purchasing"
  | "enterprise.reports"
  | "enterprise.audit"
  | "enterprise.backup"
  | "enterprise.health";

export type AuditAction =
  | "sale_completed"
  | "sale_refund"
  | "sale_void"
  | "sale_return"
  | "discount_given"
  | "shift_close_count"
  | "stock_adjust"
  | "expired_stock_writeoff"
  | "price_change"
  | "debt_payment"
  | "debt_reconcile"
  | "day_close"
  | "day_close_blocked"
  | "day_close_preflight_failed"
  | "day_close_reopened"
  | "day_close_emergency"
  | "manager_override"
  | "variance_override"
  | "sync_override"
  | "hospitality_block"
  | "shift_block"
  | "back_office_unlock"
  | "back_office_unlock_success"
  | "back_office_unlock_failed"
  | "admin_pin_clear_applied"
  | "shift_start"
  | "shift_end"
  | "product_add"
  | "product_remove"
  | "product_presets"
  | "product_update"
  | "customer_add"
  | "supplier_add"
  | "supplier_edit"
  | "purchase_saved"
  | "purchase_void"
  | "supplier_payment"
  | "cash_expense_created"
  | "cash_expense_voided"
  | "cash_expense_approved"
  | "cash_expense_rejected"
  | "cash_drawer_adjustment"
  | "drawer_open"
  | "auth_forbidden"
  | "archive_purge"
  | "archive_purge_blocked"
  | "day_close_preflight_warning"
  | "day_close_override"
  | "sync_unknown_operation"
  | "device_viewed"
  | "device_disconnected"
  | "device_removed"
  | "device_reactivated"
  | "device_heartbeat_rejected"
  | "device_limit_hit"
  | "device_login_blocked"
  | "device_replacement_completed"
  | "device_new_activation"
  | "device_pending_dismissed"
  | "device_suspicious_fingerprint"
  | "receipt_reprint"
  | "receipt_pdf_export"
  | "debt_manual_adjust"
  | "cash_expense_edited"
  | "customer_merge"
  | "product_restore"
  | "staff_login"
  | "staff_logout"
  | "staff_login_failed"
  | "staff_pin_reset"
  | "staff_password_reset"
  | "staff_account_created"
  | "staff_account_deleted"
  | "staff_suspended"
  | "staff_reactivated"
  | "staff_device_changed"
  | "staff_account_unlocked"
  | "staff_lockout_triggered"
  | "staff_login_rejected_device"
  | "staff_security_alert"
  | "staff_security_event"
  | "pos_lock"
  | "pos_unlock"
  | "staff_switch_user"
  | "staff_session_expired"
  | "custom_role_created"
  | "custom_role_updated"
  | "custom_role_deleted"
  | "custom_role_cloned"
  | "staff_role_assigned"
  | "staff_role_removed"
  | "inventory_count_started"
  | "inventory_count_submitted"
  | "inventory_count_approved"
  | "inventory_count_applied"
  | "inventory_count_cancelled"
  | "day_drawer_open"
  | "day_drawer_open_supersede"
  | "day_drawer_open_void"
  | "shift_float_verified"
  | "shift_float_mismatch"
  | "shift_float_override"
  | "shift_handoff_ready"
  | "shift_handoff_verified"
  | "shift_handoff_override"
  | "sensitive_action_auth_granted"
  | "sensitive_action_auth_denied"
  | "pharmacy_batch_received"
  | "pharmacy_batch_dispensed"
  | "pharmacy_batch_writeoff"
  | "pharmacy_batch_return"
  | "pharmacy_fefo_override"
  | "pharmacy_prescription_created"
  | "pharmacy_prescription_verified"
  | "pharmacy_prescription_dispensed"
  | "pharmacy_prescription_cancelled"
  | "pharmacy_prescription_reopened"
  | "pharmacy_prescription_refilled"
  | "pharmacy_controlled_dispensed"
  | "pharmacy_manager_approval"
  | "pharmacy_patient_updated"
  | "controlled_dispense"
  | "controlled_override"
  | "controlled_return"
  | "controlled_destroy"
  | "controlled_void"
  | "witness_signed"
  | "regulatory_export";

export type AuditLogEntry = {
  id: string;
  at: string;
  actorUserId: string;
  actorName?: string;
  role: UserRole;
  action: AuditAction;
  /** Short single-line for lists */
  payloadSummary: string;
  /** Structured detail for sync / inspection */
  payload: Record<string, unknown>;
  deviceId?: string;
};

export type ShiftRecord = {
  id: string;
  actorUserId: string;
  actorName?: string;
  role: UserRole;
  startAt: string;
  endAt?: string | null;
  salesTotalUgx: number;
  debtTotalUgx: number;
  refundsUgx: number;
  estimatedCashUgx: number;
  /** Total customer price reductions given today on this shift */
  discountsTotalUgx?: number;
  /** Voided item value removed from sales */
  voidsTotalUgx?: number;
  /** Returned item refunds */
  returnsTotalUgx?: number;
  /** Cash collected from customer debt repayments during this shift */
  debtPaymentsTotalUgx?: number;
  /** Cash physically counted at shift close */
  countedCashUgx?: number | null;
  /** counted − expected (positive = over, negative = short) */
  cashDifferenceUgx?: number | null;
  /** @deprecated v1 only — optional self-reported float. Ignored for day ledger in formula v2. */
  openingFloatUgx?: number | null;
  /** Cashier physical count at shift start (v2 verification). */
  verifiedFloatUgx?: number | null;
  /** v2 segment baseline frozen at shift start (day open or prior handoff). */
  segmentBaselineUgx?: number | null;
  verificationStatus?:
    | "matched"
    | "mismatch_overridden"
    | "handoff_matched"
    | "handoff_overridden"
    | "legacy_unverified"
    | null;
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
  verifiedByLabel?: string | null;
  /** Cashier count minus segment baseline at shift start (audit only; does not change opening float). */
  verificationVarianceUgx?: number | null;
  dayDrawerOpenId?: string | null;
  /** Cash left in drawer for next cashier (recorded at shift close). */
  handoffFloatUgx?: number | null;
  /** Prior closed shift on same day (handoff chain). */
  priorShiftId?: string | null;
  /** Cloud sync pending (multi-device). */
  pendingSync?: boolean;
  updatedAt?: string;
};

export type CashDrawerFormulaVersion = "v1" | "v2";

export type DayDrawerOpenStatus = "open" | "superseded" | "voided";

/** Authoritative day-level opening float — one active row per Kampala dateKey. */
export type DayDrawerOpen = {
  id: string;
  dateKey: string;
  openingFloatUgx: number;
  countedAt: string;
  countedByUserId: string;
  countedByLabel: string;
  firstVerifiedByUserId?: string | null;
  firstVerifiedByLabel?: string | null;
  note: string;
  witnessUserId?: string | null;
  deviceId: string;
  status: DayDrawerOpenStatus;
  supersedesId?: string | null;
  voidReason?: string | null;
  createdAt: string;
  updatedAt: string;
  pendingSync: boolean;
  /** Set when cloud RPC confirms this row. */
  cloudSyncedAt?: string | null;
  lastSyncError?: string | null;
  deletedAt?: string | null;
};

export type VoidReason = "wrong_item" | "customer_changed_mind" | "returned_item" | "wrong_quantity" | "other";

export type ReturnReason = "damaged" | "warm_bad" | "broken" | "wrong_item" | "other";

/** Logged when a cashier voids a line from a completed sale — never silent deletion. */
export type VoidRecord = {
  id: string;
  saleId: string;
  lineIndex: number;
  productId: string;
  productName: string;
  quantity: number;
  amountUgx: number;
  reason: VoidReason;
  note?: string;
  actorUserId: string;
  actorName?: string;
  shiftId?: string | null;
  createdAt: string;
};

/** Customer brought product back — stock restored, sale totals adjusted. */
export type ReturnRecord = {
  id: string;
  saleId?: string | null;
  productId: string;
  productName: string;
  quantity: number;
  refundAmountUgx: number;
  /** COGS reversed from original sale line snapshot */
  cogsUgx?: number;
  /** Unit cost per base unit from original sale line */
  unitCostUgx?: number;
  reason: ReturnReason;
  note?: string;
  actorUserId: string;
  actorName?: string;
  shiftId?: string | null;
  createdAt: string;
};

/** How the shop usually sells — set during onboarding */
export type ShopSellingStyle = "piece" | "carton" | "sack" | "mixed";

/** What kind of shop this is — drives simple adaptive UI */
export type BusinessType =
  | "kiosk_duka"
  | "wholesale"
  | "mini_supermarket"
  | "hardware"
  | "restaurant"
  | "bar"
  | "restaurant_bar"
  | "hotel"
  | "salon"
  | "pharmacy"
  | "boutique"
  | "electronics"
  | "produce_market"
  | "mobile_money_agent"
  | "other";

/** Client sale lifecycle — pending maps to DB draft */
export type SaleStatus = "completed" | "pending" | "cancelled";

export type TableDisplayStatus =
  | "available"
  | "occupied"
  | "payment_pending"
  | "reserved"
  | "needs_cleaning"
  | "cleaning"
  | "needs_attention"
  | "blocked"
  | "disabled";

/** Manager lock on a table — prevents seating until cleared. */
export type TableLockReason = "maintenance" | "private_event" | "blocked" | "manager_reserved";

export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "no_show"
  | "cancelled"
  | "completed";

export type WaitlistSource = "walk_in" | "phone" | "online";

export type WaitlistEntryStatus = "waiting" | "seated" | "cancelled" | "no_show";

export type WaitlistPriority = "normal" | "high" | "vip";

export type SeatingTimelineEventType =
  | "reserved"
  | "seated"
  | "first_order"
  | "kitchen_fired"
  | "ready"
  | "bill_requested"
  | "paid"
  | "cleaning_started"
  | "cleaning_finished"
  | "available";

export type HospitalityAuditEventType =
  | "reservation_created"
  | "reservation_edited"
  | "reservation_confirmed"
  | "reservation_cancelled"
  | "reservation_seated"
  | "reservation_completed"
  | "reservation_no_show"
  | "reservation_table_changed"
  | "waitlist_created"
  | "waitlist_seated"
  | "waitlist_cancelled"
  | "table_combined"
  | "table_split"
  | "table_locked"
  | "table_unlocked"
  | "cleaning_started"
  | "cleaning_finished"
  | "manager_override"
  | "section_assigned"
  | "bill_split"
  | "bill_merge"
  | "bill_payment"
  | "bill_partial_settlement"
  | "bill_settled"
  | "bill_reopened"
  | "bill_voided"
  | "bill_refund"
  | "bill_discount_approved"
  | "bill_service_charge"
  | "bill_tip";

export type SeatingTimelineEvent = {
  type: SeatingTimelineEventType;
  at: string;
  sessionId?: string | null;
  reservationId?: string | null;
  actorLabel?: string | null;
};

export type HospitalityAuditEvent = {
  id: string;
  type: HospitalityAuditEventType;
  at: string;
  entityType: "reservation" | "waitlist" | "table" | "session" | "section";
  entityId: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
};

/** Phase 6.4+ — website, SMS, OpenTable, etc. Architecture only. */
export type ReservationFutureHooks = {
  websiteBookingId?: string | null;
  mobileBookingId?: string | null;
  qrBookingId?: string | null;
  smsReminderSent?: boolean;
  whatsappReminderSent?: boolean;
  externalProvider?: string | null;
};

export type TableReservation = {
  id: string;
  reservationNumber: number;
  guestName: string;
  phone: string;
  email?: string | null;
  guestCount: number;
  reservationDate: string;
  reservationTime: string;
  areaId?: string | null;
  preferredTableId?: string | null;
  assignedTableIds?: string[];
  notes?: string | null;
  isVip: boolean;
  status: ReservationStatus;
  seatedSessionId?: string | null;
  createdAt: string;
  updatedAt?: string;
  pendingSync?: boolean;
  futureHooks?: ReservationFutureHooks | null;
};

export type WaitlistEntry = {
  id: string;
  name: string;
  guestCount: number;
  phone?: string | null;
  arrivalTime: string;
  estimatedWaitMinutes?: number | null;
  priority: WaitlistPriority;
  notes?: string | null;
  source: WaitlistSource;
  status: WaitlistEntryStatus;
  seatedSessionId?: string | null;
  createdAt: string;
  updatedAt?: string;
  pendingSync?: boolean;
};

export type WaiterSection = {
  id: string;
  name: string;
  waiterStaffId?: string | null;
  waiterLabel: string;
  tableIds: string[];
  sortOrder: number;
  isActive: boolean;
};

export type CombinedTableGroup = {
  id: string;
  primaryTableId: string;
  tableIds: string[];
  displayLabel: string;
  areaId: string;
  capacity: number;
  originalLabels: Record<string, string>;
  originalCapacities: Record<string, number>;
  createdAt: string;
  pendingSync?: boolean;
};

export type HospitalityCustomerProfile = {
  phone: string;
  name?: string | null;
  visitCount: number;
  averageSpendUgx: number;
  favouriteTableId?: string | null;
  lastVisitAt?: string | null;
  preferredWaiterLabel?: string | null;
  specialNotes?: string | null;
  isVip: boolean;
  /** Phase 6.5 — read-only payment history hooks. */
  billCount?: number;
  preferredPaymentMethod?: RestaurantPaymentMethod | null;
  outstandingBalanceUgx?: number;
};

export type FloorNotificationKind =
  | "reservation_arriving"
  | "reservation_late"
  | "waitlist_waiting"
  | "cleaning_overdue"
  | "bill_waiting"
  | "kitchen_ready"
  | "vip_arrival";

export type FloorNotification = {
  id: string;
  kind: FloorNotificationKind;
  messageKey: string;
  entityId: string;
  tableLabel?: string | null;
  at: string;
};

export type TableSessionStatus = "open" | "payment_pending" | "closed" | "cancelled" | "merged";

export type TableSessionKind = "table" | "named_tab";

export type KitchenStationType =
  | "kitchen"
  | "bar"
  | "grill"
  | "coffee"
  | "dessert"
  | "pizza"
  | "fryer"
  | "other";

/** Default course for fire-by-course (Phase 6.3). */
export type HospitalityCourse = "starter" | "main" | "side" | "dessert" | "drink" | "other";

// ─── Phase 6.6 — Menu production model ───────────────────────────────────────

/** Finished menu item vs raw ingredient vs semi-finished prep. */
export type ProductKind = "retail" | "finished_menu" | "ingredient" | "semi_finished";

export type ModifierSelectionMode = "single" | "multiple";

export type ModifierOption = {
  id: string;
  label: string;
  priceDeltaUgx?: number;
  /** Ingredient consumed per parent item when this option is chosen. */
  ingredientProductId?: string | null;
  ingredientQtyBase?: number | null;
  isDefault?: boolean;
  kitchenNote?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type ModifierGroup = {
  id: string;
  label: string;
  required: boolean;
  selectionMode: ModifierSelectionMode;
  minSelections?: number;
  maxSelections?: number;
  options: ModifierOption[];
  sortOrder?: number;
};

export type ProductVariant = {
  id: string;
  label: string;
  sku?: string | null;
  barcode?: string | null;
  priceUgx?: number | null;
  costPriceUgx?: number | null;
  prepTimeMinutes?: number | null;
  recipe?: Recipe | null;
  sortOrder?: number;
  isDefault?: boolean;
  isActive?: boolean;
};

export type RecipeLine = {
  ingredientProductId: string;
  quantityBase: number;
  unitLabel?: string | null;
  wastePercent?: number | null;
  prepNotes?: string | null;
};

export type Recipe = {
  lines: RecipeLine[];
  /** Yield quantity per recipe (default 1 sell unit). */
  yieldQty?: number;
  prepNotes?: string | null;
};

export type ComboSlotChoice = {
  productId: string;
  priceDeltaUgx?: number;
  isDefault?: boolean;
};

export type ComboSlot = {
  id: string;
  label: string;
  required: boolean;
  minChoices?: number;
  maxChoices?: number;
  choices: ComboSlotChoice[];
  sortOrder?: number;
};

export type ComboMealConfig = {
  slots: ComboSlot[];
  /** Fixed combo price — overrides sum of component prices when set. */
  comboPriceUgx?: number | null;
};

export type MenuSectionDef = {
  id: string;
  label: string;
  sortOrder: number;
  isActive?: boolean;
};

export type ProductMenuConfig = {
  productKind?: ProductKind;
  modifierGroups?: ModifierGroup[];
  variants?: ProductVariant[];
  combo?: ComboMealConfig | null;
  recipe?: Recipe | null;
  menuSection?: string | null;
  menuSortOrder?: number;
  hideFromMenu?: boolean;
};

export type SaleLineModifier = {
  groupId: string;
  groupLabel: string;
  optionId: string;
  optionLabel: string;
  priceDeltaUgx: number;
  kitchenNote?: string | null;
};

export type SaleLineComboSelection = {
  slotId: string;
  slotLabel: string;
  productId: string;
  productName: string;
  priceDeltaUgx: number;
};

export type IngredientShortage = {
  ingredientProductId: string;
  ingredientName: string;
  requiredBase: number;
  availableBase: number;
  unitLabel: string;
};

export type IngredientStockPolicy = "warn" | "block" | "manager_override";

/** Phase 7.1 — ingredient shortage handling for hospitality orders. */
export type HospitalityIngredientPolicyConfig = {
  policy: IngredientStockPolicy;
  allowNegativeInventory?: boolean;
  autoReserveIngredients?: boolean;
  lowStockThreshold?: number | null;
  kitchenWarningLevel?: number | null;
};

export type HospitalityTaxMode = "exclusive" | "inclusive";

/** Product-level kitchen/bar routing — authoritative over keyword heuristics. */
export type ProductHospitalityRouting = {
  /** Where this item is prepared (Kitchen, Bar, Grill, …). */
  productionStation?: KitchenStationType | null;
  /** Typical prep time in minutes — for KDS timers (Phase 6.3). */
  prepTimeMinutes?: number | null;
  /** Default course when firing tickets. */
  defaultCourse?: HospitalityCourse | null;
  /** Chit/printer station — defaults to productionStation when unset. */
  printableStation?: KitchenStationType | null;
  /** Phase 6.2 — allow menu modifiers on this item. */
  modifiersAllowed?: boolean;
  /** Phase 6.2 — allow cooking preferences (rare, medium, well done). */
  cookingPreferencesAllowed?: boolean;
  /** True when productionStation was inferred, not manually confirmed. */
  routingAutoInferred?: boolean;
  /** Explicit floor station when multiple stations share a type. */
  productionStationId?: string | null;
};

export type DiningArea = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type DiningTable = {
  id: string;
  areaId: string;
  label: string;
  capacity?: number;
  sortOrder: number;
  displayStatus: TableDisplayStatus;
  isActive: boolean;
  /** Manager lock — table cannot receive guests while set. */
  lockReason?: TableLockReason | null;
  lockNote?: string | null;
  /** When part of a temporary combined group (non-primary tables hidden from floor). */
  combinedGroupId?: string | null;
  isAccessible?: boolean;
  isSmoking?: boolean;
  /** Commercial seating timeline for analytics. */
  seatingTimeline?: SeatingTimelineEvent[];
  cleaningStartedAt?: string | null;
};

/** Reserved for Phase 6.7+ — printers, TVs, voice alerts, QR pickup. */
export type KitchenStationFutureHooks = {
  printerIds?: string[];
  displayMonitorIds?: string[];
  kitchenTvIds?: string[];
  voiceAlertsEnabled?: boolean;
  qrPickupEnabled?: boolean;
};

/** Phase 6.7 — printer connection and vendor hints. */
export type PrinterConnectionType = "usb" | "bluetooth" | "network" | "builtin";

export type PrinterVendorHint = "generic" | "epson" | "xprinter" | "sunmi" | "rongta";

/** Maps to kitchen station types for routing chits. */
export type PrinterStationRole = "kitchen" | "bar" | "coffee" | "dessert" | "receipt" | "grill" | "pizza" | "fryer" | "other";

export type PrinterProfile = {
  id: string;
  name: string;
  connectionType: PrinterConnectionType;
  paperWidth: "58mm" | "80mm";
  stationRoles: PrinterStationRole[];
  isDefaultReceipt?: boolean;
  vendorHint?: PrinterVendorHint;
  networkHost?: string | null;
  networkPort?: number | null;
  /** Opaque id from WebUSB / Web Bluetooth pairing session. */
  pairedDeviceKey?: string | null;
  isEnabled: boolean;
  lastSeenAt?: string | null;
  lastError?: string | null;
};

export type PrintJobKind =
  | "kitchen_chit_new"
  | "kitchen_chit_modified"
  | "kitchen_chit_void"
  | "kitchen_chit_course"
  | "kitchen_chit_reprint"
  | "receipt"
  | "drawer_kick"
  | "test";

export type PrintJobStatus = "queued" | "sending" | "done" | "failed";

export type PrintJobRecord = {
  id: string;
  kind: PrintJobKind;
  printerId: string | null;
  stationId?: string | null;
  ticketId?: string | null;
  saleId?: string | null;
  tableSessionId?: string | null;
  tableLabel?: string | null;
  businessDate?: string | null;
  status: PrintJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
  lastAttemptAt?: string | null;
  error?: string | null;
  payloadSummary: string;
  /** True when ESC/POS bytes are in IndexedDB. */
  payloadPersisted?: boolean;
};

export type ReceiptTemplateKind = "restaurant" | "bar" | "cafe" | "hotel" | "custom";

export type ReceiptTemplateConfig = {
  kind: ReceiptTemplateKind;
  showTableNumber: boolean;
  showWaiter: boolean;
  showGuests: boolean;
  showModifiers: boolean;
  showDiscounts: boolean;
  showSplitSummary: boolean;
  showQrPlaceholder: boolean;
  customLogoUrl?: string | null;
};

export type CashDrawerAuditEntry = {
  id: string;
  at: string;
  reason: "payment" | "manual" | "no_sale";
  byUserId?: string | null;
  byLabel?: string | null;
  saleId?: string | null;
  ok: boolean;
  error?: string | null;
};

export type HospitalityHardwarePrefs = {
  printers: PrinterProfile[];
  printQueue: PrintJobRecord[];
  printHistory: PrintJobRecord[];
  receiptTemplate: ReceiptTemplateConfig;
  autoPrintKitchen: boolean;
  autoPrintReceipt: boolean;
  openDrawerOnPayment: boolean;
  customerDisplayEnabled: boolean;
  drawerAudit: CashDrawerAuditEntry[];
};

export type KitchenStation = {
  id: string;
  name: string;
  stationType: KitchenStationType;
  sortOrder: number;
  isActive: boolean;
  /** Phase 6.7 hardware — printer ids assigned in printer management. */
  futureHooks?: KitchenStationFutureHooks | null;
};

export type KitchenTicketPriority = "normal" | "high" | "vip";

export type KitchenTicketItemStatus = "active" | "cancelled";

export type KitchenTicketStatus =
  | "queued"
  | "accepted"
  | "preparing"
  | "cooking"
  | "ready"
  | "picked_up"
  | "served"
  | "completed"
  | "cancelled";

/** Audited status transition on a production ticket. */
export type KitchenTicketStatusEvent = {
  fromStatus: KitchenTicketStatus | null;
  toStatus: KitchenTicketStatus;
  at: string;
  byUserId?: string | null;
  byLabel?: string | null;
  reason?: string | null;
};

/** Audited manager recall — e.g. ready → preparing. */
export type KitchenTicketRecallEvent = {
  fromStatus: KitchenTicketStatus;
  toStatus: KitchenTicketStatus;
  reason: string;
  at: string;
  byUserId?: string | null;
  byLabel?: string | null;
};

export type TableSession = {
  id: string;
  /** table = dining table; named_tab = bar walk-up tab (John Tab, VIP Group, …) */
  sessionKind?: TableSessionKind;
  /** Set for table sessions; null/omitted for named tabs */
  tableId?: string | null;
  /** Display name for named_tab sessions */
  tabLabel?: string | null;
  saleId: string;
  guestCount: number;
  /** Optional split for commercial open-table flow */
  adultCount?: number | null;
  childrenCount?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  specialNotes?: string | null;
  /** Future-ready: reservations, QR, etc. */
  needsAttention?: boolean;
  waiterStaffId?: string | null;
  waiterLabel?: string | null;
  status: TableSessionStatus;
  openedAt: string;
  closedAt?: string | null;
  /** Link to reservation when seated from booking. */
  reservationId?: string | null;
  waitlistEntryId?: string | null;
  updatedAt?: string;
  pendingSync?: boolean;
};

export type HospitalityFloorState = {
  areas: DiningArea[];
  tables: DiningTable[];
  sessions: TableSession[];
  stations: KitchenStation[];
  kitchenTickets?: KitchenTicket[];
  reservations?: TableReservation[];
  waitlist?: WaitlistEntry[];
  waiterSections?: WaiterSection[];
  combinedGroups?: CombinedTableGroup[];
  hospitalityAuditLog?: HospitalityAuditEvent[];
  /** Daily reservation number sequence — max number used today. */
  lastReservationNumberDate?: string | null;
  lastReservationNumber?: number;
};

export type KitchenTicketItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Kitchen notes — extra spicy, no onions, allergy, etc. */
  notes?: string | null;
  course?: HospitalityCourse | null;
  prepTimeMinutes?: number | null;
  itemStatus?: KitchenTicketItemStatus;
  /** Phase 6.6 — modifier labels for KDS display. */
  modifierLabels?: string[];
  variantLabel?: string | null;
  /** Links ticket item back to sale line for line-id fire tracking. */
  saleLineId?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
};

export type KitchenTicket = {
  id: string;
  tableSessionId: string;
  saleId: string;
  stationId: string;
  stationType: KitchenStationType;
  status: KitchenTicketStatus;
  ticketNumber: number;
  firedAt: string;
  tableLabel: string;
  areaName?: string | null;
  waiterLabel?: string | null;
  guestCount?: number | null;
  /** 1-based fire round for this table session. */
  orderRound?: number;
  priority?: KitchenTicketPriority;
  /** Target prep minutes — max of item prep times when fired. */
  prepTargetMinutes?: number | null;
  ticketNotes?: string | null;
  items: KitchenTicketItem[];
  acceptedAt?: string | null;
  preparingAt?: string | null;
  cookingAt?: string | null;
  readyAt?: string | null;
  pickedUpAt?: string | null;
  servedAt?: string | null;
  completedAt?: string | null;
  statusHistory?: KitchenTicketStatusEvent[];
  recallHistory?: KitchenTicketRecallEvent[];
  updatedAt?: string;
  pendingSync?: boolean;
};

/** Phase 6.5 — restaurant payment methods (offline-first). */
export type RestaurantPaymentMethod = "cash" | "mobile_money" | "atm" | "card" | "voucher" | "credit";

export type RestaurantBillSplitMode = "none" | "equal" | "by_seat" | "by_item" | "custom";

export type BillSplitStatus = "open" | "partial" | "paid";

export type BillSplitLine = {
  /** Stable id for payment allocation — generated when missing. */
  id?: string;
  label: string;
  amountUgx: number;
  /** Seat number when split by seat. */
  seatNumber?: number | null;
  /** Sale line ids when split by item. */
  lineIds?: string[];
  paidUgx?: number;
  status?: BillSplitStatus;
};

export type BillPaymentRecord = {
  id: string;
  method: RestaurantPaymentMethod;
  amountUgx: number;
  reference?: string | null;
  voucherCode?: string | null;
  /** Which split this payment applies to (optional). */
  splitId?: string | null;
  recordedAt: string;
  recordedByUserId?: string | null;
  recordedByLabel?: string | null;
  pendingSync?: boolean;
};

export type RestaurantTipMode = "none" | "fixed" | "percent" | "custom";

export type RestaurantBillDiscountApproval = {
  approvedByUserId: string;
  approvedByLabel: string;
  reason: string;
  at: string;
  kind: "line" | "bill";
};

export type RestaurantBillDraft = {
  splitMode: RestaurantBillSplitMode;
  splits: BillSplitLine[];
  payments: BillPaymentRecord[];
  serviceChargePercent?: number | null;
  tipMode?: RestaurantTipMode;
  tipUgx?: number;
  tipPercent?: number | null;
  /** Framework only — configurable tax % (not enforced by URA). */
  taxPercent?: number | null;
  discountApproval?: RestaurantBillDiscountApproval | null;
  billRequestedAt?: string | null;
  reopenedAt?: string | null;
  reopenedByUserId?: string | null;
  reopenedByLabel?: string | null;
  reopenedReason?: string | null;
  previousTotalUgx?: number | null;
  voidedAt?: string | null;
  voidedByUserId?: string | null;
  voidedByLabel?: string | null;
  voidReason?: string | null;
};

/** Phase 6.5+ future hooks — architecture only, do not implement. */
export type RestaurantPaymentFutureHooks = {
  onlinePaymentId?: string | null;
  qrPaymentId?: string | null;
  payAtTableToken?: string | null;
  digitalWalletId?: string | null;
  customerInvoiceId?: string | null;
  fiscalPrinterJobId?: string | null;
  taxAuthorityRef?: string | null;
  loyaltyRedemptionId?: string | null;
  giftCardId?: string | null;
};

/** How the product is counted and priced at the kiosk */
export type SellingMode = "unit" | "weighted" | "portion";

export type LineInputMode = "quantity" | "money";

export type PharmacyPackagingLevel1 = {
  unit: string;
  containsBaseUnits: number;
};

export type PharmacyPackagingLevel2 = {
  unit: string;
  containsLevel1Units: number;
};

export type PharmacySellConfig = {
  tablet: boolean;
  strip: boolean;
  box: boolean;
};

export type PharmacyMedicineOtcClass = "otc" | "prescription";

export type PharmacyBatchStatus = "active" | "depleted" | "expired" | "quarantine" | "returned" | "written_off";

export type PharmacyWriteOffReason = "expired" | "broken" | "lost" | "damaged" | "recall";

export type PharmacyBatchEventType =
  | "created"
  | "received"
  | "adjusted"
  | "transferred"
  | "dispensed"
  | "returned"
  | "written_off"
  | "expired"
  | "fefo_override";

export type PharmacyBatchEvent = {
  id: string;
  type: PharmacyBatchEventType;
  at: string;
  quantityDelta?: number;
  actorUserId?: string | null;
  actorName?: string | null;
  note?: string | null;
  refId?: string | null;
  deviceId?: string | null;
  businessDate?: string | null;
  online?: boolean | null;
};

/** Commercial batch sub-ledger — quantities in base units; sum(active remaining) should match stockOnHand when batch-tracked. */
export type PharmacyBatchRecord = {
  id: string;
  batchNumber: string;
  lotNumber?: string | null;
  supplierBatch?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  purchaseId?: string | null;
  purchaseInvoice?: string | null;
  purchaseDate?: string | null;
  manufactureDate?: string | null;
  expiryDate: string;
  quantityReceived: number;
  quantityRemaining: number;
  unitCostUgx: number;
  sellingPriceUgx?: number | null;
  status: PharmacyBatchStatus;
  location?: string | null;
  notes?: string | null;
  receivedAt: string;
  timeline: PharmacyBatchEvent[];
  /** @deprecated Legacy field — migrated to quantityRemaining on read. */
  quantityBase?: number;
};

/** Controlled medicine schedule/class for regulatory register. */
export type PharmacyControlledSchedule =
  | "none"
  | "schedule_2"
  | "schedule_3"
  | "schedule_4"
  | "narcotic"
  | "psychotropic";

/** Pharmacy-specific medicine master data (retail products omit this). */
export type PharmacyMedicineMaster = {
  brandName?: string | null;
  genericName?: string | null;
  manufacturer?: string | null;
  country?: string | null;
  registrationNumber?: string | null;
  medicineCategory?: string | null;
  otcOrPrescription?: PharmacyMedicineOtcClass | null;
  controlledDrug?: boolean;
  /** Phase 8.6 — regulatory schedule/class. */
  controlledSchedule?: PharmacyControlledSchedule | null;
  regulatoryCategory?: string | null;
  maxQuantityPerDispense?: number | null;
  managerOverrideRequired?: boolean;
  witnessRequired?: boolean;
  refrigerated?: boolean;
  hazardous?: boolean;
  batchTracked?: boolean;
  expiryTracked?: boolean;
  barcodes?: string[];
  supplierSku?: string | null;
  storageNotes?: string | null;
};

export type PharmacyCompliancePrefs = {
  witnessWorkflowEnabled?: boolean;
  largeControlledQuantityThreshold?: number;
  failedApprovalAlertThreshold?: number;
  frequentOverrideWindowHours?: number;
  frequentOverrideThreshold?: number;
};

export type PharmacyControlledRegisterKind =
  | "dispense"
  | "override"
  | "return"
  | "destroy"
  | "void"
  | "witness";

export type PharmacyControlledOverrideKind =
  | "controlled"
  | "quantity"
  | "fefo"
  | "batch"
  | "expired"
  | "discount"
  | "price";

/** Immutable security register entry for inspector review. */
export type PharmacyControlledRegisterEntry = {
  id: string;
  kind: PharmacyControlledRegisterKind;
  at: string;
  businessDate: string;
  productId: string;
  productName: string;
  controlledSchedule?: string | null;
  regulatoryCategory?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  prescriptionId?: string | null;
  prescriptionNumber?: string | null;
  saleId?: string | null;
  returnId?: string | null;
  batchNumber?: string | null;
  batchExpiry?: string | null;
  quantity: number;
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  managerUserId?: string | null;
  managerName?: string | null;
  witnessUserId?: string | null;
  witnessName?: string | null;
  overrideReason?: string | null;
  overrideKind?: PharmacyControlledOverrideKind | null;
  deviceId?: string | null;
  pharmacistRole?: string | null;
  managerRole?: string | null;
  pinVerified?: boolean;
  approvalMethod?: string | null;
  immutable: true;
  createdAt: string;
};

export type PharmacyComplianceAlertSeverity = "info" | "warning" | "critical";

export type PharmacyComplianceAlert = {
  id: string;
  at: string;
  severity: PharmacyComplianceAlertSeverity;
  kind: string;
  message: string;
  relatedSaleId?: string | null;
  relatedUserId?: string | null;
  relatedProductId?: string | null;
};

export type PharmacyDispenseComplianceApproval = {
  patientVerified: boolean;
  prescriptionVerified: boolean;
  managerApproved: boolean;
  managerReason?: string | null;
  witnessUserId?: string | null;
  witnessName?: string | null;
  approvedAt: string;
  /** Phase 9.1 — real staff identity for inspector register. */
  managerUserId?: string | null;
  managerName?: string | null;
  managerRole?: UserRole | null;
  pharmacistUserId?: string | null;
  pharmacistName?: string | null;
  pharmacistRole?: UserRole | null;
  pinVerified?: boolean;
  approvalMethod?: "owner_pin" | null;
};

/** Phase 8.4 — prescription classification. */
export type PharmacyPrescriptionType =
  | "walk_in_otc"
  | "paper_rx"
  | "electronic_rx"
  | "repeat"
  | "chronic"
  | "emergency";

export type PharmacyPrescriptionStatus =
  | "draft"
  | "waiting_verification"
  | "verified"
  | "dispensing"
  | "ready"
  | "dispensed"
  | "cancelled"
  | "archived";

export type PharmacyPrescriptionPriority = "normal" | "urgent";

export type PharmacyDispenseType = "otc" | "prescription";

export type PharmacyPrescriptionLine = {
  id: string;
  productId: string;
  productName: string;
  strength?: string | null;
  form?: string | null;
  quantityPrescribed: number;
  quantityDispensed: number;
  directions?: string | null;
  batchOverrideId?: string | null;
  batchNumber?: string | null;
  batchExpiry?: string | null;
};

export type PharmacyPrescription = {
  id: string;
  prescriptionNumber: string;
  type: PharmacyPrescriptionType;
  status: PharmacyPrescriptionStatus;
  priority: PharmacyPrescriptionPriority;
  patientId: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  doctorName?: string | null;
  doctorId?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  prescriptionDate: string;
  refillCount: number;
  refillsUsed: number;
  lastRefillAt?: string | null;
  nextRefillEligibleAt?: string | null;
  lines: PharmacyPrescriptionLine[];
  saleId?: string | null;
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
  verifiedByName?: string | null;
  dispensedAt?: string | null;
  dispensedByUserId?: string | null;
  dispensedByName?: string | null;
  controlledMedicinesApproved?: boolean;
  controlledApprovalReason?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  pendingSync?: boolean;
};

export type PharmacyPatientGender = "male" | "female" | "other" | "unspecified";

export type PharmacyBloodGroup =
  | "A+"
  | "A-"
  | "B+"
  | "B-"
  | "AB+"
  | "AB-"
  | "O+"
  | "O-"
  | "unknown";

export type PharmacyPatientMedicalFlags = {
  pregnancy?: boolean;
  breastfeeding?: boolean;
  diabetes?: boolean;
  hypertension?: boolean;
  asthma?: boolean;
  kidneyDisease?: boolean;
  liverDisease?: boolean;
};

export type PharmacyPatientNote = {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: string;
};

export type PharmacyPatientDocumentKind =
  | "prescription_scan"
  | "lab_report"
  | "insurance_card"
  | "doctor_referral";

/** Architecture placeholder — no cloud storage in Phase 8.5. */
export type PharmacyPatientDocument = {
  id: string;
  kind: PharmacyPatientDocumentKind;
  label: string;
  placeholder: true;
  createdAt: string;
};

export type PharmacyChronicMedStatus = "active" | "completed" | "missed";

export type PharmacyChronicMedication = {
  id: string;
  productId: string;
  productName: string;
  directions?: string | null;
  intervalDays: number;
  lastDispensedAt?: string | null;
  nextExpectedAt?: string | null;
  status: PharmacyChronicMedStatus;
  prescriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PharmacyPatientProfile = {
  patientCode: string;
  dateOfBirth?: string | null;
  gender?: PharmacyPatientGender | null;
  email?: string | null;
  address?: string | null;
  nationalId?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  preferredLanguage?: string | null;
  bloodGroup?: PharmacyBloodGroup | null;
  weightKg?: number | null;
  heightCm?: number | null;
  allergies?: string[];
  allergiesText?: string | null;
  chronicConditions?: string | null;
  medicalFlags?: PharmacyPatientMedicalFlags | null;
  notes?: PharmacyPatientNote[];
  documents?: PharmacyPatientDocument[];
  chronicMedications?: PharmacyChronicMedication[];
  /** @deprecated Migrated to nationalId on read. */
  idNumber?: string | null;
};

export type PharmacyDoctor = {
  id: string;
  name: string;
  clinic?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  pendingSync?: boolean;
};

export type PharmacyPatientTimelineEvent = {
  id: string;
  at: string;
  kind:
    | "prescription_created"
    | "prescription_dispensed"
    | "prescription_refill"
    | "otc_sale"
    | "controlled_dispensed"
    | "debt_payment";
  title: string;
  detail?: string | null;
  prescriptionId?: string | null;
  prescriptionNumber?: string | null;
  saleId?: string | null;
  amountUgx?: number | null;
  doctorName?: string | null;
  productName?: string | null;
  batchNumber?: string | null;
  quantity?: number | null;
};

export type PharmacyBatchReceiveInput = {
  batchNumber: string;
  expiryDate: string;
  quantityBase: number;
  unitCostUgx: number;
  lotNumber?: string | null;
  supplierBatch?: string | null;
  manufactureDate?: string | null;
  purchaseDate?: string | null;
  purchaseInvoice?: string | null;
  sellingPriceUgx?: number | null;
  location?: string | null;
  notes?: string | null;
};

/** How `minimumStockAlert` is interpreted when pharmacy packaging is enabled. */
export type PharmacyLowStockUnit = "tablet" | "strip" | "box";

/** Customer-facing sell unit on receipts (inventory stays in base units). */
export type PharmacySaleUnitType = "tablet" | "strip" | "box";

export type PharmacyPackaging = {
  enabled: boolean;
  baseUnit: string;
  level1?: PharmacyPackagingLevel1 | null;
  level2?: PharmacyPackagingLevel2 | null;
  sell: PharmacySellConfig;
  priceStripUgx?: number | null;
  priceBoxUgx?: number | null;
  /** Alert when stock falls below `minimumStockAlert` in this unit (default tablet). */
  lowStockAlertUnit?: PharmacyLowStockUnit | null;
  batches?: PharmacyBatchRecord[];
};

export type Product = {
  id: string;
  name: string;
  sellingMode: SellingMode;
  /** Stock and sales quantities are in this unit (ea, kg, litre, …) */
  baseUnit: string;
  /** Supplier pack (e.g. 20L jerrican) — optional */
  buyingUnit?: string | null;
  /** Base units per one buying unit — optional */
  conversionRate?: number | null;
  /** UGX per base unit (used for sell-by-money) */
  sellingPricePerUnitUgx: number;
  /** UGX cost per base unit — profit hints (may be fractional for pack breakdowns) */
  costPricePerUnitUgx: number;
  /** Invoice total for one buying pack/crate when cost was derived from pack ÷ units */
  buyingPackCostUgx?: number | null;
  /** FIFO slot index for pack-cost allocation (units sold from pack-priced inventory). */
  packCostUnitsDepleted?: number | null;
  stockOnHand: number;
  minimumStockAlert: number;
  category: string;
  sku: string;
  /** ISO date YYYY-MM-DD — medicine expiry (Pharmacy Mode) */
  expiryDate?: string | null;
  /** e.g. 500mg, 250mg */
  medicineStrength?: string | null;
  /** e.g. Tablet, Capsule, Syrup */
  medicineForm?: string | null;
  /** Optional strip/box hierarchy + sell units (pharmacy packaging mode). */
  pharmacyPackaging?: PharmacyPackaging | null;
  /** Extended pharmacy master data (brand, generic, regulatory flags, barcodes). */
  pharmacyMaster?: PharmacyMedicineMaster | null;
  updatedAt: string;
  /** Monotonic for last-write-wins sync hints */
  version: number;
  /** Tap-to-sell amounts in UGX (e.g. 500, 1000 for oil) */
  quickPresetsMoneyUgx?: number[];
  /** Tap-to-sell amounts in base units (e.g. 1, 2, 5 kg) */
  quickPresetsQty?: number[];
  /** Restaurant / bar production routing and prep metadata (Phase 6.2+). */
  hospitality?: ProductHospitalityRouting | null;
  /** Phase 6.6 — modifiers, variants, recipes, combos. */
  menu?: ProductMenuConfig | null;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  location: string;
  createdAt: string;
  version: number;
  /** Cloud `updated_at` for incremental sync merge. */
  updatedAt?: string;
  /** Running “mpa mpaka” balance in UGX */
  debtBalanceUgx: number;
  /** Phase 8.4 — optional clinical profile for pharmacy patients. */
  pharmacyProfile?: PharmacyPatientProfile | null;
};

/** Who you buy stock from (distributor, market, etc.) */
export type Supplier = {
  id: string;
  name: string;
  phone: string;
  location: string;
  notes: string;
  /** UGX you still owe this supplier */
  balanceOwedUgx: number;
  /** Last time you saved a purchase from them */
  lastSupplyAt?: string | null;
  /** Running total of all purchase invoices (UGX) */
  totalPurchasesUgx: number;
  createdAt: string;
  version: number;
};

/** One line on a restock / purchase slip — quantities in buying units (crate, sack, jerrican). */
export type PurchaseLine = {
  productId: string;
  name: string;
  qtyBuyingUnits: number;
  costPerBuyingUnitUgx: number;
  /** When base_units, qtyBuyingUnits holds base quantity (pharmacy direct entry). */
  unitMode?: "buying_units" | "base_units";
};

/** Stock-in from a supplier (or walk-in) — updates shelf stock and cost. */
export type Purchase = {
  id: string;
  supplierId: string;
  supplierName: string;
  lines: PurchaseLine[];
  /** Sum of line costs */
  totalCostUgx: number;
  /** Cash or transfer paid now */
  amountPaidUgx: number;
  /** Added to supplier balance: totalCost - amountPaid (can be negative if overpaying old debt) */
  balanceDeltaUgx: number;
  notes: string;
  /** Optional supplier invoice reference (future-ready). */
  invoiceNumber?: string;
  /** Set when voided — purchase is never hard-deleted. */
  voidedAt?: string | null;
  voidReason?: string;
  /** Set when purchase row (incl. stock-in) was acknowledged by cloud before void. */
  preVoidCloudSynced?: boolean;
  /** Set after void stock reversal is pushed to cloud (prevents double subtraction). */
  voidStockSyncedAt?: string | null;
  createdAt: string;
  pendingSync: boolean;
};

export type SupplierPayment = {
  id: string;
  supplierId: string;
  amountUgx: number;
  /** Future-ready: cash, mobile_money, bank_transfer, etc. */
  paymentMethod?: string;
  /** Future-ready: receipt or transfer reference. */
  reference?: string;
  createdByUserId?: string;
  createdByName?: string;
  createdAt: string;
  pendingSync: boolean;
};

export type StockMovementKind =
  | "opening_stock"
  | "purchase_in"
  | "sale_out"
  | "adjust_damage"
  | "adjust_use"
  | "adjust_other"
  | "adjust_count"
  | "adjust_expired_writeoff"
  | "inventory_count_variance";

export type StockMovement = {
  id: string;
  at: string;
  productId: string;
  productName: string;
  /** Positive = stock in, negative = stock out */
  deltaBaseUnits: number;
  kind: StockMovementKind;
  summary: string;
  refId?: string;
  supplierId?: string | null;
};

export type InventoryCountSessionStatus =
  | "draft"
  | "counting"
  | "submitted"
  | "approved"
  | "applied"
  | "cancelled";

export type InventoryCountLine = {
  id: string;
  sessionId: string;
  productId: string;
  productName?: string;
  expectedQtySnapshot: number;
  countedQty: number | null;
  varianceQty: number;
  varianceCostUgx: number;
  varianceRetailUgx: number;
  reason: string;
  updatedAt: string;
};

export type InventoryCountSession = {
  id: string;
  sessionNumber: number;
  status: InventoryCountSessionStatus;
  startedAt: string | null;
  startedBy: string | null;
  startedByName?: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName?: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName?: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  appliedByName?: string | null;
  snapshotCreatedAt: string | null;
  notes: string;
  lines: InventoryCountLine[];
  pendingSync: boolean;
  updatedAt: string;
};

export type SaleLine = {
  /** Stable line id — required for multi-device pending bill merge */
  id?: string;
  /** Last line edit — used for line-level LWW merge */
  updatedAt?: string;
  productId: string;
  name: string;
  inputMode: LineInputMode;
  /** Quantity in product base units */
  quantity: number;
  /** Selling price per base unit at the time of sale */
  unitPriceUgx: number;
  /** Buying cost per base unit at the time of sale */
  unitCostUgx: number;
  lineTotalUgx: number;
  /** List price before any discount (defaults to lineTotalUgx) */
  originalLineTotalUgx?: number;
  /** UGX taken off this line for the customer */
  discountUgx?: number;
  /** Gross profit after all discounts (Revenue − COGS) — snapshotted at sale completion */
  estimatedProfitUgx: number;
  /** COGS snapshotted at sale completion (quantity × unit cost, pack slots when applicable) */
  cogsUgx?: number;
  /** Cart-level discount allocated to this line */
  cartDiscountUgx?: number;
  /** Net revenue after line + cart discounts */
  netRevenueUgx?: number;
  /** Same as estimatedProfitUgx when snapshotted — explicit alias for reporting */
  grossProfitUgx?: number;
  /** Base unit label at time of sale */
  baseUnit?: string;
  /** Financial snapshot completeness — cloud / legacy hydration */
  financialDataStatus?: "complete" | "repaired" | "legacy" | "needs_repair";
  /** When inputMode is money, what the customer handed */
  moneyAmountUgx?: number | null;
  /** Pharmacy POS: unit the cashier sold (display only; `quantity` is base units). */
  saleUnitType?: PharmacySaleUnitType | null;
  /** Count in `saleUnitType` (e.g. 2 tablets, 1 strip). */
  saleUnitQty?: number | null;
  /** Pharmacy: pharmacist-selected batch (overrides FEFO). */
  pharmacyBatchOverrideId?: string | null;
  /** Pharmacy: reason when FEFO was overridden. */
  pharmacyFefoOverrideReason?: string | null;
  /** Pharmacy: FEFO-selected batch number (display snapshot). */
  pharmacyBatchNumber?: string | null;
  /** Pharmacy: FEFO-selected batch expiry (display snapshot). */
  pharmacyBatchExpiry?: string | null;
  /** Set when voided after payment — line stays on receipt for audit */
  voided?: boolean;
  voidedAt?: string | null;
  /** Kitchen notes for this line — printed/displayed on production tickets. */
  notes?: string | null;
  /** Seat assignment for split-by-seat billing (Phase 6.5). */
  seatNumber?: number | null;
  /** Phase 6.6 — selected variant. */
  variantId?: string | null;
  variantLabel?: string | null;
  /** Phase 6.6 — modifier selections snapshotted at order time. */
  selectedModifiers?: SaleLineModifier[];
  /** Phase 6.6 — combo slot selections. */
  comboSelections?: SaleLineComboSelection[];
  /** Unique config key for merge / kitchen fire (product + variant + modifiers + combo). */
  configFingerprint?: string;
  /** Course override for fire-by-course. */
  course?: HospitalityCourse | null;
  /** True when line is a combo meal parent. */
  isComboMeal?: boolean;
  /** Product.version when line entered cart — cross-tab sale guard */
  stockVersionAtAdd?: number;
};

export type Sale = {
  id: string;
  /** completed (default for legacy rows) · pending (open table / held cart) · cancelled */
  status?: SaleStatus;
  /** Cashier label: Table 5, customer name, etc. */
  referenceLabel?: string | null;
  /** Linked hospitality table session when applicable */
  tableSessionId?: string | null;
  /** Last cart update — used for sync merge */
  updatedAt?: string | null;
  /** 1-based receipt sequence for this Kampala day (001, 002...). */
  receiptSeq?: number;
  lines: SaleLine[];
  subtotalUgx: number;
  totalUgx: number;
  cashPaidUgx: number;
  /** Amount still on account */
  debtUgx: number;
  /** Sum of line discounts on this sale */
  discountTotalUgx?: number;
  /** Running total voided from this sale after completion */
  voidedTotalUgx?: number;
  estimatedProfitUgx: number;
  /** True when cloud/legacy lines lack repairable financial snapshots */
  financialRepairRequired?: boolean;
  /** True when sale lines originate from legacy migration without cost data */
  legacyFinancialData?: boolean;
  /** Phase 8.4 — linked prescription when dispensed from Rx workflow. */
  prescriptionId?: string | null;
  /** Phase 8.4 — OTC vs prescription-linked sale. */
  dispenseType?: PharmacyDispenseType | null;
  createdAt: string;
  pendingSync: boolean;
  lastSyncError?: string | null;
  /** When set, sale debt is linked to this person for balance tracking */
  customerId?: string | null;
  /** Staff who completed the sale (session actor); drives cashier performance on owner dashboard */
  soldByUserId?: string | null;
  /** Assigned waiter from table session — used for hospitality KPIs (not the bill closer). */
  waiterStaffId?: string | null;
  waiterName?: string | null;
  /** Optional split-bill breakdown shown on receipt (hospitality) */
  splitBreakdown?: BillSplitLine[] | null;
  /** Phase 6.5 — in-progress billing state for open table bills. */
  billDraft?: RestaurantBillDraft | null;
  /** Phase 6.5 — service charge snapshotted at settlement. */
  serviceChargeUgx?: number | null;
  /** Phase 6.5 — tip snapshotted at settlement. */
  tipUgx?: number | null;
  /** Phase 6.5 — tax snapshotted at settlement (framework). */
  taxUgx?: number | null;
  /** Phase 6.5 — individual payment lines when multiple methods used. */
  billPayments?: BillPaymentRecord[] | null;
  /** Phase 7.1 — whole-sale void (bill voided, sale preserved for audit). */
  saleVoidedAt?: string | null;
  saleVoidReason?: string | null;
  saleVoidedByUserId?: string | null;
  saleVoidedByLabel?: string | null;
  /** Phase 6.5 — future payment integrations (architecture only). */
  paymentFutureHooks?: RestaurantPaymentFutureHooks | null;
  /** Payment mode selected at checkout. */
  paymentMethod?: "cash" | "atm" | "mobile_money" | "mixed" | "credit" | "voucher";
  /** What customer actually handed over (when captured at checkout). */
  amountPaidUgx?: number | null;
  /** Change returned to customer at checkout (when captured). */
  changeGivenUgx?: number | null;
  /** Branding frozen at checkout — historical receipts must not change. */
  receiptHeaderSnapshot?: ReceiptHeaderSnapshot | null;
  receiptFooterSnapshot?: ReceiptFooterSnapshot | null;
  /** Customer label frozen for debt receipts (RCPT-06). */
  receiptCustomerName?: string | null;
  receiptCustomerPhone?: string | null;
};

export type DebtPayment = {
  id: string;
  customerId: string;
  amountUgx: number;
  createdAt: string;
  receiptHeaderSnapshot?: ReceiptHeaderSnapshot | null;
  receiptFooterSnapshot?: ReceiptFooterSnapshot | null;
};

/** End-of-day note — counted cash vs expected */
/** Immutable audit metadata for day-close PDF exports (no accounting effect). */
export type DayCloseDocumentSnapshot = {
  documentVersion: 1 | 2;
  generatedAt: string;
  closedByUserId: string | null;
  closedByLabel: string;
  expectedCashUgx: number;
  countedCashUgx: number;
  varianceUgx: number;
  totalSalesUgx: number;
  profitEstimateUgx: number;
  totalDebtUgx: number;
  cashFromSalesUgx: number;
  debtCollectedUgx: number;
  refundsUgx: number;
  expenseUgx: number;
  transactionCount: number;
  /** V2 drawer ledger fields (optional on legacy snapshots). */
  openingFloatUgx?: number;
  cashSalesUgx?: number;
  supplierPaymentsUgx?: number;
  adjustmentInflowsUgx?: number;
  adjustmentOutflowsUgx?: number;
  cashRefundsUgx?: number;
};

export type DayCloseSummary = {
  id: string;
  dateKey: string;
  expectedCashUgx: number;
  countedCashUgx: number;
  differenceUgx: number;
  totalSalesUgx: number;
  totalDebtUgx: number;
  profitEstimateUgx: number;
  createdAt: string;
  /** When superseded by a re-close with explicit override. */
  supersededAt?: string | null;
  overrideReason?: string | null;
  replacesCloseId?: string | null;
  /** PDF/print snapshot for accountant archive */
  documentSnapshot?: DayCloseDocumentSnapshot | null;
  /** Opening float recorded at day close (UGX). */
  openingFloatUgx?: number | null;
  pendingSync?: boolean;
  updatedAt?: string;
  /** Emergency close (power outage, etc.) — requires owner PIN + audit. */
  isEmergency?: boolean;
  closedByUserId?: string | null;
  closedByLabel?: string | null;
  emergencyReason?: string | null;
};

/** Permanent record when owner reopens a closed business day. */
export type DayReopenRecord = {
  id: string;
  dateKey: string;
  closeId: string;
  reason: string;
  reopenedByUserId: string;
  reopenedByLabel: string;
  reopenedAt: string;
  deviceId: string;
  pendingSync?: boolean;
};

export const CASH_DRAWER_ADJUSTMENT_TYPES = [
  "opening_float",
  "owner_injection",
  "owner_withdrawal",
  "bank_deposit",
  "safe_transfer_in",
  "safe_transfer_out",
  "cash_added",
  "cash_removed",
  "float_replenishment",
] as const;

export type CashDrawerAdjustmentType = (typeof CASH_DRAWER_ADJUSTMENT_TYPES)[number];

/** Cash added to or removed from the physical drawer (not sales, debt, or expenses). */
export type CashDrawerAdjustment = {
  id: string;
  type: CashDrawerAdjustmentType;
  amountUgx: number;
  note: string;
  actorUserId: string;
  actorName?: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string | null;
  pendingSync: boolean;
  lastSyncError?: string | null;
  deletedAt?: string | null;
};

export const EXPENSE_CATEGORIES = [
  "transport",
  "rent",
  "salaries",
  "electricity",
  "airtime",
  "miscellaneous",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** @deprecated Use CashExpense */
export type Expense = {
  id: string;
  category: ExpenseCategory;
  amountUgx: number;
  note: string;
  paidAt: string;
  pendingSync: boolean;
};

/** Money removed from the cash drawer (operational expenses). */
export type CashExpenseApprovalStatus = "approved" | "pending" | "rejected";

/** Money removed from the cash drawer (operational expenses). */
export type CashExpense = {
  id: string;
  category: string;
  amountUgx: number;
  description: string;
  /** Kampala calendar date YYYY-MM-DD */
  paidOn: string;
  createdAt: string;
  createdByUserId: string;
  createdByLabel?: string;
  deviceId?: string;
  /** Defaults to approved for legacy rows and owner/manager entries. */
  approvalStatus?: CashExpenseApprovalStatus;
  approvedByUserId?: string | null;
  approvedByLabel?: string | null;
  approvedAt?: string | null;
  rejectedByUserId?: string | null;
  rejectedByLabel?: string | null;
  rejectedAt?: string | null;
  pendingSync: boolean;
  lastSyncError?: string | null;
  deletedAt?: string | null;
};

export type CustomStaffRoleStatus = "active" | "disabled" | "archived";

export type CustomStaffRole = {
  id: string;
  name: string;
  inheritsFrom: UserRole;
  permissions: Permission[];
  status?: CustomStaffRoleStatus;
  /** Industry template used as the starting point. */
  sourceTemplateId?: string | null;
  /** Custom role cloned from another custom role. */
  clonedFromRoleId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffAccount = {
  id: string;
  name: string;
  /** Unique per shop when set (e.g. cashier01). */
  username?: string | null;
  role: UserRole;
  /** Industry role template id (display + wizard selection). */
  roleTemplateId?: string | null;
  /** Owner-defined custom role id from preferences.customStaffRoles. */
  customRoleId?: string | null;
  /** Cached effective permissions for offline checks / audits. */
  permissions?: Permission[];
  pin?: string | null;
  password?: string | null;
  pinHash?: string | null;
  passwordHash?: string | null;
  phone?: string | null;
  email?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** True until cloud confirms create/update (offline queue). */
  pendingCloudSync?: boolean;
  lastLoginAt?: string | null;
  lastDeviceFingerprint?: string | null;
  lastLoginPlatform?: string | null;
  failedPinAttempts?: number;
  lockedUntil?: string | null;
  lastFailedLoginAt?: string | null;
  firstFailedLoginAt?: string | null;
  failuresInWindow?: number;
  failureWindowStartedAt?: string | null;
  pinChangedAt?: string | null;
  passwordChangedAt?: string | null;
};

/** Receipt printer paper — 58mm / 80mm thermal, or A4 for office printers. */
export type ReceiptPaperSize = "58mm" | "80mm" | "a4";

/** Structured receipt header fields (Settings → Receipt branding). */
export type ReceiptHeaderConfig = {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  tin: string;
};

/** Per-field visibility on printed / PDF receipts. */
export type ReceiptDisplayOptions = {
  showCashier: boolean;
  showReceiptNumber: boolean;
  showPaymentMethod: boolean;
  showCustomerName: boolean;
  showCustomerPhone: boolean;
  showDebtInfo: boolean;
  showShopAddress: boolean;
  showShopPhone: boolean;
};

/** Frozen header lines at sale / debt payment time (RCPT-07). */
export type ReceiptHeaderSnapshot = {
  lines: string[];
};

/** Frozen footer lines + powered-by at sale time (RCPT-07). */
export type ReceiptFooterSnapshot = {
  lines: string[];
  poweredBy: string | null;
  displayOptions: ReceiptDisplayOptions;
};

/** How long sales / activity stay in active lists before moving to archive. */
export type DataRetentionPolicy = "forever" | "3m" | "6m" | "12m";

/** Sell screen shelf tile size (grid span). */
export type PosShelfSize = "small" | "medium" | "large";

/** Shelf accent color on Sell screen. */
export type PosShelfColor = "default" | "red" | "orange" | "blue" | "green" | "purple";

/** Optional shelf badge on Sell screen. */
export type PosShelfBadge = "fast_moving" | "promotion";

/** Per-shelf visual layout (keyed by category name or sentinel). */
export type PosShelfLayoutConfig = {
  displayName?: string;
  icon?: string;
  color?: PosShelfColor;
  /** Full-spectrum pick from color wheel (#RRGGBB). Overrides preset color when set. */
  customColor?: string;
  size?: PosShelfSize;
  /** Continuous tile scale 25–100 (replaces discrete size when set). */
  scale?: number;
  featured?: boolean;
  badge?: PosShelfBadge | null;
};

/** Shop template for initial shelf layout. */
export type PosShelfPresetId =
  | "retail"
  | "supermarket"
  | "pharmacy"
  | "restaurant"
  | "bar"
  | "hardware"
  | "boutique";

/** Main menu launcher tile accent (reuse shelf palette). */
export type LauncherTileColor = PosShelfColor;

/** Per-tile launcher customization. Sell hero is always orange and not customized. */
export type LauncherTileConfig = {
  hidden?: boolean;
  pinned?: boolean;
  color?: LauncherTileColor;
  /** 25–100 continuous scale (small → large tile). */
  scale?: number;
  customColor?: string | null;
};

export type ShopPreferences = {
  businessType: BusinessType;
  /** Giant one-hand sell screen */
  kioskQuickSell: boolean;
  /** First-time business type picker */
  onboardingDone: boolean;
  /** Post-signup wizard (business type, selling style, optional GPS/staff/products) */
  onboardingWizardDone?: boolean;
  /** Uganda selling style from onboarding */
  shopSellingStyle?: ShopSellingStyle | null;
  /** Enable carton/sack breakdown defaults when selling style is mixed */
  mixedPackSelling?: boolean;
  /** 2 = new prefs shape; missing = older snapshot → skip onboarding */
  schemaVersion?: number;
  /** After first-sale celebration modal is dismissed */
  celebratedFirstSale?: boolean;
  /** Short tone when a sale completes (Android / speakers) */
  saleSoundOn?: boolean;
  /** Vibration on key taps and sale success */
  hapticsOn?: boolean;
  /**
   * Touch-first cashier flow vs owner back office (extra dashboard / cash history).
   * Only owner/manager may set `owner_back_office`; others stay on cashier.
   */
  posUiMode?: "cashier" | "owner_back_office";
  /**
   * Offline / dev only: simulate another role. Honoured only when Supabase is off or `import.meta.env.DEV`,
   * and the real auth role is owner — see `resolveSessionActor`.
   */
  devRoleOverride?: UserRole | null;
  /** Flag day-close variance when abs(diff) exceeds max(pct of expected, fixed UGX). */
  cashVarianceThresholdPct?: number;
  cashVarianceThresholdUgxFixed?: number;
  /** Maximum recommended cash kept in the drawer before banking (UGX). */
  cashSafeLimitUgx?: number | null;
  /** Manager notes keyed by Kampala date (YYYY-MM-DD). */
  cashPositionDayNotes?: Record<string, string>;
  /** Kampala date key (YYYY-MM-DD) of last automatic daily backup written */
  lastAutoBackupDateKey?: string;
  /** When the owner last opened Investigation / risks (ISO). Hides launcher badges until new events. */
  ownerRisksReviewedAt?: string | null;
  /** Owner-reviewed attention-center alerts (critical/warning). */
  ownerAlertAcknowledgements?: Array<{
    alertId: string;
    acknowledgedAt: string;
    acknowledgedBy: string;
  }>;
  /**
   * Multi-branch (future): when set, rows may be tagged with this id for sync and dashboards.
   * Single-shop installs leave these unset.
   */
  activeBranchId?: string | null;
  branchDisplayName?: string | null;
  /**
   * Optional 4–6 digit PIN to unlock Back Office on this device (stored in local snapshot).
   * Not bank-grade; deters casual access on shared phones.
   */
  backOfficePin?: string | null;
  /** Business profile (owner setup) cached locally for offline UX. */
  shopDisplayName?: string | null;
  shopPhoneE164?: string | null;
  shopAddressLine?: string | null;
  shopCurrency?: string | null;
  /** When false, cashiers cannot record drawer expenses (owners/managers always can). Default off. */
  staffCanRecordCashExpenses?: boolean;
  /** When true, cashier-recorded expenses need owner/manager approval before affecting cash totals. */
  requireCashierExpenseApproval?: boolean;
  /** Local multi-user profiles for fast shared-device switch. */
  staffAccounts?: StaffAccount[];
  /** Owner-defined roles with custom permission sets. */
  customStaffRoles?: CustomStaffRole[];
  /** Active staff profile on this device; null = auth role session. */
  activeStaffId?: string | null;
  /** Lock screen state for quick shift switches. */
  posLocked?: boolean;
  /** Auto-lock after idle minutes (0 = never). */
  staffAutoLockMinutes?: 0 | 2 | 5 | 10 | 15 | 30 | 60;
  /** When true, idle timeout requires PIN unlock (default on). */
  staffRequirePinAfterIdle?: boolean;
  /** Allow switch-user from lock screen (default on). */
  staffAllowSwitchUser?: boolean;
  /** Persist staff session across refresh/restart (default on). */
  staffRememberSession?: boolean;
  /** Failed PIN attempts before brute-force lock (default 5). */
  staffMaxFailedAttempts?: number;
  /** Session lifetime in minutes before PIN required again (default 480). */
  staffSessionTimeoutMinutes?: number;
  /** When true, sensitive actions require native biometric or Owner PIN (Owner-only setting). */
  biometricAuthEnabled?: boolean;
  /** single = only primary device may sell offline; multi = all devices (default). */
  registerMode?: "single" | "multi";
  /** Device fingerprint designated as primary register (single mode). */
  primaryDeviceFingerprint?: string | null;
  shifts?: ShiftRecord[];
  /** Product ids starred on Sell screen (fast access) */
  favoriteProductIds?: string[];
  /** Recently added-to-cart product ids (newest first); capped in UI logic */
  recentProductIds?: string[];
  /** Sell screen category chip: real category name, or `__waka_uncategorized__`; omit / null = All */
  posSellCategoryFilter?: string | null;
  /** Shop-wide Sell screen shelf order (set in stock/back office). */
  posPinnedShelfKeys?: string[];
  /** Per-shelf display overrides (name, color, icon, size, featured). */
  posShelfLayout?: Record<string, PosShelfLayoutConfig>;
  /** Product ids on the Quick Sell strip (one-tap add on Sell screen). */
  posQuickSellProductIds?: string[];
  /** Last applied shop shelf preset id. */
  posShelfPresetId?: PosShelfPresetId | null;
  /** Default tile scale (25–100) for shelves without a per-shelf size. */
  posShelfDefaultScale?: number;
  /** Main menu launcher tile order (excludes Sell hero). */
  launcherTileOrder?: string[];
  /** Main menu tile overrides — hide, pin, accent color. */
  launcherTileLayout?: Record<string, LauncherTileConfig>;
  /** Inventory products list view preference (Phase 19.1A). */
  inventoryViewPreference?: "auto" | "card" | "compact" | "table";
  /** Productivity overlay — archived product ids (Phase 19.1B, local prefs). */
  inventoryArchivedProductIds?: string[];
  /** Productivity overlay tags per product id (Phase 19.1B). */
  inventoryProductTags?: Record<string, string[]>;
  /** Saved inventory filter presets (Phase 19.1B). */
  inventorySavedFilters?: Array<{
    id: string;
    name: string;
    filters: Record<string, unknown>;
    query: string;
    createdAt: string;
  }>;
  /** Home hero live preview surround color (hex). Default light green when unset. */
  homeHeroPreviewBgColor?: string | null;
  /** Back office hub section tile order. */
  officeHubTileOrder?: string[];
  /** Back office hub section colors and visibility. */
  officeHubTileLayout?: Record<string, LauncherTileConfig>;
  /** Waka public shop ID (A001, …) cached after first online load. */
  wakaShopId?: string | null;
  /** Thermal / AirPrint receipt width (Settings → Receipts). */
  receiptPaperSize?: ReceiptPaperSize;
  /** Multiline receipt header; blank = shop name, phone, and location from Shop info. */
  receiptCustomHeaderText?: string | null;
  /** Main thank-you line at the bottom of receipts. */
  receiptCustomFooterText?: string | null;
  /** Return policy line; empty string hides it; blank uses default 24h message. */
  receiptReturnPolicyText?: string | null;
  /** Structured header fields (preferred over receiptCustomHeaderText). */
  receiptHeader?: ReceiptHeaderConfig | null;
  /** Up to 4 footer lines; empty entries ignored on print. */
  receiptFooterLines?: string[] | null;
  /** Field visibility on receipts (defaults all on). */
  receiptDisplayOptions?: ReceiptDisplayOptions | null;
  /** When false on premium plans, hide “Powered by Waka POS”. Free/Starter always show. */
  receiptShowPoweredByWaka?: boolean;
  /**
   * Archive sales, receipts, and activity after this window (never auto-delete).
   * Default: 3 months (90 days).
   */
  dataRetentionPolicy?: DataRetentionPolicy;
  /** Closed shifts moved out of active shift list (cash drawer history). */
  archivedShifts?: ShiftRecord[];
  /** Kampala YYYY-MM of last month owner was prompted about monthly report download. */
  lastMonthlyReportPromptMonth?: string | null;
  /** ISO time of last automatic archive job on this device. */
  lastArchiveRunAt?: string | null;
  /** Restaurant/bar floor layout — persisted locally for offline-first service */
  hospitalityFloor?: HospitalityFloorState;
  /** Owner reopen history — immutable audit trail for unlocked business days */
  dayReopenHistory?: DayReopenRecord[];
  /** Kill switch — when false, fall back to retail Sell even for hospitality business types */
  hospitalityModeEnabled?: boolean;
  /** Resume table order after refresh */
  activeTableSessionId?: string | null;
  /** When true, kitchen tickets fire only on explicit send (not each item tap) */
  hospitalityManualKitchenFire?: boolean;
  /** Default service charge % for restaurant bills (0 = off). */
  hospitalityServiceChargePercent?: number | null;
  /** Framework tax % on bills (0 = off) — not URA-integrated. */
  hospitalityTaxPercent?: number | null;
  /** Phase 7.1 — tax calculation mode on restaurant bills. */
  hospitalityTaxMode?: HospitalityTaxMode;
  /** Phase 7.1 — when false, tax % is ignored on bills. */
  hospitalityTaxEnabled?: boolean;
  /** Phase 6.6 — menu sections for hospitality menu builder. */
  hospitalityMenuSections?: MenuSectionDef[];
  /** Phase 6.6 — ingredient shortage handling before adding orders. */
  hospitalityIngredientStockPolicy?: IngredientStockPolicy;
  /** Phase 7.1 — extended ingredient policy settings. */
  hospitalityIngredientPolicy?: HospitalityIngredientPolicyConfig | null;
  /**
   * Bar-only: hide kitchen nav/widgets when false. Restaurant / restaurant_bar default on.
   * null = use default for business type.
   */
  hospitalityKitchenEnabled?: boolean | null;
  /** Auto-remove pending sales after TTL (future) */
  pendingSalesTtl?: "24h" | "3d" | "7d" | "never";
  staffCanManagePendingSales?: boolean;
  /** Kill switch — when false, fall back to retail UI even for pharmacy business type */
  pharmacyModeEnabled?: boolean;
  /** When selling expired medicine: warn cashier or block sale */
  pharmacyExpiredSaleBehavior?: "warn" | "block";
  /** Phase 8.6 — regulatory compliance preferences. */
  pharmacyCompliance?: PharmacyCompliancePrefs;
  /** Owner-only: extra diagnostics, support export, sync logging, pilot banners */
  pilotModeEnabled?: boolean;
  /** Optional discount policy; default unrestricted (backward compatible). */
  discountControlMode?: "unrestricted" | "manager_approval" | "max_percent";
  /** Percent threshold for manager_approval / max_percent modes. */
  discountMaxPercentThreshold?: number;
  /** Cash drawer reconciliation formula — undefined = v1 (legacy dual float). New shops default v2. */
  cashDrawerFormulaVersion?: CashDrawerFormulaVersion;
  /** Owner may supersede/void day open after first sale with PIN + reason (formula v2). */
  ownerDayOpenCorrectionAfterSales?: boolean;
  /** Phase 6.7 — kitchen printers, receipt templates, print queue. */
  hospitalityHardware?: HospitalityHardwarePrefs;
  /** Phase 7.1 UI — floor map table icon size, shape, and grid density. */
  hospitalityFloorDisplay?: HospitalityFloorDisplayPrefs | null;
};

/** Restaurant floor map presentation (UI only). */
export type HospitalityTableShape = "classic" | "round" | "square";
export type HospitalityTableSize = "sm" | "md" | "lg" | "xl";
export type HospitalityFloorGridDensity = "compact" | "normal" | "spacious";

export type HospitalityFloorDisplayPrefs = {
  tableShape?: HospitalityTableShape;
  tableSize?: HospitalityTableSize;
  gridDensity?: HospitalityFloorGridDensity;
};

export type SyncOperationKind =
  /** Canonical queue buckets for offline-first shop operations */
  | "pending_sales"
  | "pending_stock_updates"
  | "pending_returns"
  | "pending_expenses"
  | "pending_cash_expenses"
  | "pending_cash_drawer_adjustments"
  | "pending_inventory_counts"
  | "pending_day_drawer_opens"
  | "pending_shifts"
  | "pending_day_closes"
  | "pending_purchases"
  | "pending_hospitality"
  | "pending_staff"
  /** Legacy queue kinds kept for backward compatibility */
  | "sale"
  | "product"
  | "customer"
  | "stock_move"
  | "audit_log"
  | "purchase"
  | "supplier";

export type SyncOperation = {
  id: string;
  kind: SyncOperationKind;
  payload: unknown;
  createdAt: string;
  attempts: number;
  /** ISO time of last failed upload attempt — used for exponential backoff. */
  lastAttemptAt?: string | null;
};

/** High-level connectivity for the tiny header strip */
export type SyncStatus = "online" | "offline" | "syncing" | "pending";
