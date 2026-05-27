import type {
  BusinessTypeSlice,
  DistrictOpsRow,
  FieldMapPin,
  InternalDashboardStats,
  PlanTierMetrics,
  RecentShopRow,
  ShopOpsDetail,
  SupportTicketRow,
  WakaInternalAdminRow,
} from "./wakaInternalAdmin";
import type { OpsActivationRow } from "./businessActivation";
import type { InternalAdminRow } from "./wakaInternalAdmin";

/** Demo shop id for preview shop profile (`/internal/waka/shop/preview-shop-demo?preview=1`). */
export const PREVIEW_SHOP_ID = "preview-shop-demo";

/** True when the app shell should yield the viewport to the internal admin overlay. */
export function isInternalAdminAppPath(pathname: string): boolean {
  return pathname === "/internal/waka" || pathname.startsWith("/internal/waka/");
}

export const INTERNAL_ADMIN_PREVIEW_ROW: WakaInternalAdminRow = {
  id: "00000000-0000-4000-8000-000000000099",
  email: "preview@waka.ug",
  full_name: "Preview Admin",
  role: "super_admin",
  assigned_district_ids: [],
  active: true,
  max_shops: null,
};

/** Dev-only unless `VITE_INTERNAL_ADMIN_PREVIEW=1` (never enable in production builds). */
export function isInternalAdminPreviewEnabled(): boolean {
  if (import.meta.env.PROD && import.meta.env.VITE_INTERNAL_ADMIN_PREVIEW !== "1") return false;
  return import.meta.env.DEV || import.meta.env.VITE_INTERNAL_ADMIN_PREVIEW === "1";
}

export function isInternalAdminPreviewActive(search: string): boolean {
  if (!isInternalAdminPreviewEnabled()) return false;
  const q = new URLSearchParams(search);
  const v = q.get("preview");
  return v === "1" || v === "true" || v === "yes";
}

export function internalAdminPreviewHref(path = "/internal/waka"): string {
  if (path.includes("preview=")) return path;
  const hashIdx = path.indexOf("#");
  const base = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
  const hash = hashIdx >= 0 ? path.slice(hashIdx) : "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}preview=1${hash}`;
}

export function internalAdminShopHref(shopId: string, previewMode: boolean): string {
  const path = `/internal/waka/shop/${shopId}`;
  return previewMode ? internalAdminPreviewHref(path) : path;
}

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

export const PREVIEW_DASHBOARD_STATS: InternalDashboardStats = {
  totalShops: 128,
  activeToday: 34,
  trialSubscriptions: 22,
  paidSubscriptions: 61,
  expiredSubscriptions: 8,
  suspendedShops: 3,
  pendingAiRequests: 2,
  pendingAnnualRequests: 4,
  lapsedTrials: 5,
  expiringTrialsNext7d: 7,
  activeDevices: 156,
  openSupportTickets: 6,
  salesTotalUgx: 48_500_000,
  shopsByDistrict: [
    { label: "Kampala", count: 52 },
    { label: "Wakiso", count: 28 },
    { label: "Mukono", count: 14 },
  ],
  latestSignups: [
    {
      shop_id: PREVIEW_SHOP_ID,
      shop_name: "Kampala Provisions (Preview)",
      created_at: daysAgo(1),
      district: "Kampala",
      owner_email: "owner@example.com",
      owner_name: "Sarah N.",
      plan_code: "business",
      subscription_status: "active",
      trial_ends_at: null,
    },
    {
      shop_id: "preview-shop-2",
      shop_name: "Ntinda Mini Mart (Preview)",
      created_at: daysAgo(3),
      district: "Kampala",
      owner_email: "demo2@example.com",
      owner_name: "James O.",
      plan_code: "starter",
      subscription_status: "trialing",
      trial_ends_at: daysAgo(-5),
    },
  ],
};

export const PREVIEW_PLAN_METRICS: PlanTierMetrics[] = [
  {
    code: "starter",
    activeCount: 40,
    trialCount: 12,
    expiringSoonCount: 3,
    monthlyPriceUgx: 25_000,
    estimatedMonthlyRevenueUgx: 1_000_000,
  },
  {
    code: "business",
    activeCount: 55,
    trialCount: 8,
    expiringSoonCount: 4,
    monthlyPriceUgx: 56_000,
    estimatedMonthlyRevenueUgx: 3_080_000,
  },
  {
    code: "waka_plus",
    activeCount: 18,
    trialCount: 2,
    expiringSoonCount: 0,
    monthlyPriceUgx: 110_000,
    estimatedMonthlyRevenueUgx: 1_980_000,
  },
];

export const PREVIEW_RECENT_SHOPS: RecentShopRow[] = [
  {
    id: PREVIEW_SHOP_ID,
    name: "Kampala Provisions (Preview)",
    district: "Kampala",
    city: "Central",
    is_active: true,
    created_at: daysAgo(12),
    plan_code: "business",
    trial_days_left: null,
    owner_label: "Sarah N.",
    owner_email: "owner@example.com",
    phone_e164: "+256700000001",
    business_type: "retail",
    gps_missing: false,
  },
  {
    id: "preview-shop-2",
    name: "Ntinda Mini Mart (Preview)",
    district: "Kampala",
    city: "Ntinda",
    is_active: true,
    created_at: daysAgo(20),
    plan_code: "starter",
    trial_days_left: 5,
    owner_label: "James O.",
    gps_missing: true,
  },
];

export const PREVIEW_SUPPORT_TICKETS: SupportTicketRow[] = [
  {
    id: "preview-ticket-1",
    subject: "Cannot sync after update",
    body: "Sample ticket for layout preview.",
    status: "open",
    priority: "normal",
    channel: "in_app",
    created_at: daysAgo(0),
    shop_id: PREVIEW_SHOP_ID,
    shop_name: "Kampala Provisions (Preview)",
    shop_district: "Kampala",
    shop_phone_e164: "+256700000001",
    contact_phone_e164: "+256700000001",
    owner_name: "Sarah N.",
    owner_email: "owner@example.com",
    issue_type: "sync",
    device_fingerprint: null,
    app_version: "1.0.0",
    sync_health_snapshot: null,
    assigned_internal_admin_id: null,
    assigned_admin_email: null,
  },
];

export const PREVIEW_DISTRICTS: DistrictOpsRow[] = [
  {
    districtId: "preview-d1",
    label: "Kampala",
    totalShops: 52,
    activeToday: 41,
    paidShops: 35,
    fieldAgentsAssigned: 3,
  },
  {
    districtId: "preview-d2",
    label: "Wakiso",
    totalShops: 28,
    activeToday: 22,
    paidShops: 18,
    fieldAgentsAssigned: 2,
  },
];

export const PREVIEW_BIZ_TYPES: BusinessTypeSlice[] = [
  { type: "retail", count: 64 },
  { type: "restaurant", count: 22 },
];

export const PREVIEW_MAP_PINS: FieldMapPin[] = [
  {
    shop_id: PREVIEW_SHOP_ID,
    shop_name: "Kampala Provisions (Preview)",
    lat: 0.3476,
    lng: 32.5825,
    district: "Kampala",
    city: "Central",
    is_active: true,
    district_id: "preview-d1",
    plan_code: "business",
    subscription_status: "active",
    last_seen_at: daysAgo(0),
  },
];

export const PREVIEW_ACTIVATIONS: OpsActivationRow[] = [
  {
    id: "preview-act-1",
    shop_id: PREVIEW_SHOP_ID,
    status: "pending",
    business_display_name: "New Boutique (Preview)",
    public_reference_code: "WAKA-PREV-001",
    created_at: daysAgo(0),
    created_by: "preview-user",
    shop_lifecycle: "pending_activation",
  },
];

export const PREVIEW_INTERNAL_ADMINS: InternalAdminRow[] = [
  {
    id: "preview-admin-1",
    user_id: "preview-user-1",
    email: "ops@waka.ug",
    full_name: "Operations Lead",
    role: "operations_admin",
    active: true,
    assigned_district_ids: [],
    created_at: daysAgo(90),
  },
  {
    id: "preview-admin-2",
    user_id: "preview-user-2",
    email: "field@waka.ug",
    full_name: "Field Agent",
    role: "field_agent",
    active: true,
    assigned_district_ids: ["preview-d1"],
    created_at: daysAgo(120),
  },
];

export const PREVIEW_SHOP_OPS_DETAIL: ShopOpsDetail = {
  shop: {
    id: PREVIEW_SHOP_ID,
    name: "Kampala Provisions (Preview)",
    district: "Kampala",
    city: "Central",
    is_active: true,
    organization_id: "preview-org",
    last_seen_at: daysAgo(0),
    phone_e164: "+256700000001",
    created_at: daysAgo(120),
    latitude: 0.3476,
    longitude: 32.5825,
  },
  owner_label: "Sarah N.",
  owner_email: "sarah.n@example.com",
  product_count: 42,
  sale_count_30d: 128,
  last_sale_at: daysAgo(0),
  subscription: {
    id: "preview-sub-1",
    status: "active",
    trial_ends_at: null,
    plan_code: "business",
    payment_status: "paid",
    current_period_end: daysAgo(-30),
  },
  plan_code: "business",
  devices: [
    {
      id: "preview-device-1",
      shop_id: PREVIEW_SHOP_ID,
      device_fingerprint: "preview-fp-1",
      label: "Counter tablet",
      platform: "android",
      app_version: "1.0.0",
      last_seen_at: daysAgo(0),
      is_active: true,
      trusted: true,
      suspicious_flag: false,
      created_at: daysAgo(30),
    },
  ],
  sync_health: {
    shop_id: PREVIEW_SHOP_ID,
    last_pull_at: daysAgo(0),
    last_push_ok_at: daysAgo(0),
    pending_outbound: 0,
    last_error: null,
    updated_at: daysAgo(0),
  },
  subscriptionPaymentsRecent: [],
};

export function previewDayBuckets(): { label: string; count: number }[] {
  return Array.from({ length: 7 }, (_, i) => ({
    label: `D-${6 - i}`,
    count: 4 + (i % 3) * 2,
  }));
}
