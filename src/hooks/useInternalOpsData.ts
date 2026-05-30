import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PREVIEW_BIZ_TYPES,
  PREVIEW_DASHBOARD_STATS,
  PREVIEW_DISTRICTS,
  PREVIEW_MAP_PINS,
  PREVIEW_PLAN_METRICS,
  PREVIEW_RECENT_SHOPS,
  PREVIEW_SUPPORT_TICKETS,
  previewDayBuckets,
} from "../lib/internalAdminPreview";
import {
  aggregateAppVersions,
  buildOpsActivityFeed,
  computeShopHealth,
  computeSystemHealth,
  type OpsFeedEvent,
  type ShopHealth,
} from "../lib/internalOpsIntelligence";
import {
  fetchBusinessTypeSlices,
  fetchDistrictOpsTable,
  fetchFieldMapPins,
  fetchFieldVisitsOpen,
  fetchFleetDevices,
  fetchInternalDashboardStats,
  fetchInternalOpsCharts7d,
  fetchOpsAuditFeed,
  fetchOrgBillingOffersForQueue,
  fetchPendingSubscriptionRequests,
  fetchPlanTierMetrics,
  fetchShopsBySignupDate,
  fetchSalesVolumeBuckets7d,
  fetchShopSignupBuckets7d,
  fetchSubscriptionGrowthBuckets7d,
  fetchSupportTickets,
  type BusinessTypeSlice,
  type DayBucket,
  type DistrictOpsRow,
  type FieldMapPin,
  type FieldVisitRow,
  type FleetDeviceRow,
  type InternalDashboardStats,
  type OpsAuditRow,
  type OrgBillingOfferStaffRow,
  type PendingSubscriptionRequestRow,
  type PlanTierMetrics,
  type RecentShopRow,
  type SupportTicketRow,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";
import { PREVIEW_FLEET_DEVICES } from "../lib/internalAdminPreview";

type InternalOpsCacheSnapshot = {
  at: number;
  stats: InternalDashboardStats | null;
  statsError: boolean;
  statsErrorMessage: string;
  plans: PlanTierMetrics[];
  recent: RecentShopRow[];
  tickets: SupportTicketRow[];
  districts: DistrictOpsRow[];
  bizTypes: BusinessTypeSlice[];
  signups7: DayBucket[];
  subs7: DayBucket[];
  sales7: DayBucket[];
  visits: FieldVisitRow[];
  pendingTrials: PendingSubscriptionRequestRow[];
  billingOfferRows: OrgBillingOfferStaffRow[];
  fleetDevices: FleetDeviceRow[];
  auditFeed: OpsAuditRow[];
};

let INTERNAL_OPS_CACHE: InternalOpsCacheSnapshot | null = null;
const INTERNAL_OPS_CACHE_TTL_MS = 20_000;

export function kampalaNowParts(): { hour: number; dateStr: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "numeric", hour12: false }).format(now),
  );
  const dateStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return { hour, dateStr };
}

export function greetingKey(hour: number): string {
  if (hour < 12) return "internalDashGreetMorning";
  if (hour < 17) return "internalDashGreetAfternoon";
  return "internalDashGreetEvening";
}

export type OpsSheetId = "trials" | "annual" | "support" | "visits" | "billing" | "charts" | "map" | null;

export type InternalOpsLoadScope = "full" | "overview" | "shops" | "devices" | "support" | "billing" | "analytics";

export function useInternalOpsData(
  adminRow: WakaInternalAdminRow | null,
  previewMode: boolean,
  loadScope: InternalOpsLoadScope = "full",
) {
  const [opsLoading, setOpsLoading] = useState(!previewMode && Boolean(adminRow));
  const [stats, setStats] = useState<InternalDashboardStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [statsErrorMessage, setStatsErrorMessage] = useState("");
  const [plans, setPlans] = useState<PlanTierMetrics[]>([]);
  const [recent, setRecent] = useState<RecentShopRow[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [districts, setDistricts] = useState<DistrictOpsRow[]>([]);
  const [bizTypes, setBizTypes] = useState<BusinessTypeSlice[]>([]);
  const [signups7, setSignups7] = useState<DayBucket[]>([]);
  const [subs7, setSubs7] = useState<DayBucket[]>([]);
  const [sales7, setSales7] = useState<DayBucket[]>([]);
  const [visits, setVisits] = useState<FieldVisitRow[]>([]);
  const [mapPins, setMapPins] = useState<FieldMapPin[]>([]);
  const [mapDistrictId, setMapDistrictId] = useState("");
  const [pendingTrials, setPendingTrials] = useState<PendingSubscriptionRequestRow[]>([]);
  const [billingOfferRows, setBillingOfferRows] = useState<OrgBillingOfferStaffRow[]>([]);
  const [fleetDevices, setFleetDevices] = useState<FleetDeviceRow[]>([]);
  const [auditFeed, setAuditFeed] = useState<OpsAuditRow[]>([]);

  const seedPreview = useCallback(() => {
    const buckets = previewDayBuckets();
    setStats(PREVIEW_DASHBOARD_STATS);
    setPlans(PREVIEW_PLAN_METRICS);
    setRecent(PREVIEW_RECENT_SHOPS);
    setTickets(PREVIEW_SUPPORT_TICKETS);
    setDistricts(PREVIEW_DISTRICTS);
    setBizTypes(PREVIEW_BIZ_TYPES);
    setSignups7(buckets);
    setSubs7(buckets);
    setSales7(buckets);
    setVisits([]);
    setMapPins(PREVIEW_MAP_PINS);
    setPendingTrials([]);
    setBillingOfferRows([]);
    setFleetDevices(PREVIEW_FLEET_DEVICES);
    setAuditFeed([]);
    setStatsError(false);
    setStatsErrorMessage("");
    setOpsLoading(false);
  }, []);

  const hydrateFromCache = useCallback((cache: InternalOpsCacheSnapshot) => {
    setStats(cache.stats);
    setStatsError(cache.statsError);
    setStatsErrorMessage(cache.statsErrorMessage);
    setPlans(cache.plans);
    setRecent(cache.recent);
    setTickets(cache.tickets);
    setDistricts(cache.districts);
    setBizTypes(cache.bizTypes);
    setSignups7(cache.signups7);
    setSubs7(cache.subs7);
    setSales7(cache.sales7);
    setVisits(cache.visits);
    setPendingTrials(cache.pendingTrials);
    setBillingOfferRows(cache.billingOfferRows);
    setFleetDevices(cache.fleetDevices);
    setAuditFeed(cache.auditFeed);
  }, []);

  const loadInFlightRef = useRef(false);

  const loadChartBuckets = useCallback(async () => {
    const charts = await fetchInternalOpsCharts7d();
    if (charts?.signups?.length) {
      return {
        signups7: charts.signups,
        subs7: charts.subscriptions,
        sales7: charts.sales,
      };
    }
    const [su7, sub7, sa7] = await Promise.all([
      fetchShopSignupBuckets7d(),
      fetchSubscriptionGrowthBuckets7d(),
      fetchSalesVolumeBuckets7d(),
    ]);
    const empty = Array.from({ length: 7 }, (_, i) => ({ label: `${i + 1}`, count: 0 }));
    return {
      signups7: su7.length ? su7 : empty,
      subs7: sub7.length ? sub7 : empty,
      sales7: sa7.length ? sa7 : empty,
    };
  }, []);

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (previewMode) {
      seedPreview();
      return;
    }
    if (!adminRow) return;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!opts?.silent) setOpsLoading(true);
    setStatsError(false);
    setStatsErrorMessage("");
    try {
      const dash = await fetchInternalDashboardStats();
      if (!dash.ok) {
        setStatsError(true);
        setStatsErrorMessage(dash.message);
        setStats(null);
      } else {
        setStats(dash.stats);
      }

      const cacheBase = {
        at: Date.now(),
        stats: dash.ok ? dash.stats : null,
        statsError: !dash.ok,
        statsErrorMessage: dash.ok ? "" : dash.message,
      };

      if (loadScope === "shops") {
        const r = await fetchShopsBySignupDate(100);
        setRecent(r);
        INTERNAL_OPS_CACHE = {
          ...cacheBase,
          plans: [],
          recent: r,
          tickets: [],
          districts: [],
          bizTypes: [],
          signups7: [],
          subs7: [],
          sales7: [],
          visits: [],
          pendingTrials: [],
          billingOfferRows: [],
          fleetDevices: [],
          auditFeed: [],
        };
        return;
      }

      if (loadScope === "devices") {
        const [p, fleet] = await Promise.all([fetchPlanTierMetrics(), fetchFleetDevices(120)]);
        setPlans(p);
        setFleetDevices(fleet);
        INTERNAL_OPS_CACHE = {
          ...cacheBase,
          plans: p,
          recent: [],
          tickets: [],
          districts: [],
          bizTypes: [],
          signups7: [],
          subs7: [],
          sales7: [],
          visits: [],
          pendingTrials: [],
          billingOfferRows: [],
          fleetDevices: fleet,
          auditFeed: [],
        };
        return;
      }

      if (loadScope === "support") {
        const [tk, v] = await Promise.all([fetchSupportTickets(80), fetchFieldVisitsOpen()]);
        setTickets(tk);
        setVisits(v);
        INTERNAL_OPS_CACHE = {
          ...cacheBase,
          plans: [],
          recent: [],
          tickets: tk,
          districts: [],
          bizTypes: [],
          signups7: [],
          subs7: [],
          sales7: [],
          visits: v,
          pendingTrials: [],
          billingOfferRows: [],
          fleetDevices: [],
          auditFeed: [],
        };
        return;
      }

      if (loadScope === "billing") {
        const [p, pend, offers, tk, v] = await Promise.all([
          fetchPlanTierMetrics(),
          fetchPendingSubscriptionRequests(40),
          fetchOrgBillingOffersForQueue(60),
          fetchSupportTickets(80),
          fetchFieldVisitsOpen(),
        ]);
        setPlans(p);
        setPendingTrials(pend);
        setBillingOfferRows(offers);
        setTickets(tk);
        setVisits(v);
        INTERNAL_OPS_CACHE = {
          ...cacheBase,
          plans: p,
          recent: [],
          tickets: tk,
          districts: [],
          bizTypes: [],
          signups7: [],
          subs7: [],
          sales7: [],
          visits: v,
          pendingTrials: pend,
          billingOfferRows: offers,
          fleetDevices: [],
          auditFeed: [],
        };
        return;
      }

      if (loadScope === "analytics") {
        const charts = await loadChartBuckets();
        setSignups7(charts.signups7);
        setSubs7(charts.subs7);
        setSales7(charts.sales7);
        const [d, b, fleet, p] = await Promise.all([
          fetchDistrictOpsTable(),
          fetchBusinessTypeSlices(),
          fetchFleetDevices(120),
          fetchPlanTierMetrics(),
        ]);
        setDistricts(d);
        setBizTypes(b);
        setFleetDevices(fleet);
        setPlans(p);
        INTERNAL_OPS_CACHE = {
          ...cacheBase,
          plans: p,
          recent: [],
          tickets: [],
          districts: d,
          bizTypes: b,
          signups7: charts.signups7,
          subs7: charts.subs7,
          sales7: charts.sales7,
          visits: [],
          pendingTrials: [],
          billingOfferRows: [],
          fleetDevices: fleet,
          auditFeed: [],
        };
        return;
      }

      const charts = loadScope === "overview" || loadScope === "full" ? await loadChartBuckets() : null;
      if (charts) {
        setSignups7(charts.signups7);
        setSubs7(charts.subs7);
        setSales7(charts.sales7);
      }

      if (loadScope === "overview") {
        const [p, r, tk, d, b, v, pend, offers, fleet, audit] = await Promise.all([
          fetchPlanTierMetrics(),
          fetchShopsBySignupDate(100),
          fetchSupportTickets(80),
          fetchDistrictOpsTable(),
          fetchBusinessTypeSlices(),
          fetchFieldVisitsOpen(),
          fetchPendingSubscriptionRequests(40),
          fetchOrgBillingOffersForQueue(60),
          fetchFleetDevices(120),
          fetchOpsAuditFeed(25),
        ]);
        setPlans(p);
        setRecent(r);
        setTickets(tk);
        setDistricts(d);
        setBizTypes(b);
        setVisits(v);
        setPendingTrials(pend);
        setBillingOfferRows(offers);
        setFleetDevices(fleet);
        setAuditFeed(audit);
        INTERNAL_OPS_CACHE = {
          ...cacheBase,
          plans: p,
          recent: r,
          tickets: tk,
          districts: d,
          bizTypes: b,
          signups7: charts?.signups7 ?? [],
          subs7: charts?.subs7 ?? [],
          sales7: charts?.sales7 ?? [],
          visits: v,
          pendingTrials: pend,
          billingOfferRows: offers,
          fleetDevices: fleet,
          auditFeed: audit,
        };
        return;
      }

      const [p, r, tk, d, b, v, pins, pend, offers, fleet, audit] = await Promise.all([
        fetchPlanTierMetrics(),
        fetchShopsBySignupDate(100),
        fetchSupportTickets(80),
        fetchDistrictOpsTable(),
        fetchBusinessTypeSlices(),
        fetchFieldVisitsOpen(),
        fetchFieldMapPins({ districtId: mapDistrictId || null, limit: 400 }),
        fetchPendingSubscriptionRequests(40),
        fetchOrgBillingOffersForQueue(60),
        fetchFleetDevices(120),
        fetchOpsAuditFeed(25),
      ]);
      setPlans(p);
      setRecent(r);
      setTickets(tk);
      setDistricts(d);
      setBizTypes(b);
      setVisits(v);
      setMapPins(pins);
      setPendingTrials(pend);
      setBillingOfferRows(offers);
      setFleetDevices(fleet);
      setAuditFeed(audit);
      INTERNAL_OPS_CACHE = {
        ...cacheBase,
        plans: p,
        recent: r,
        tickets: tk,
        districts: d,
        bizTypes: b,
        signups7: charts?.signups7 ?? [],
        subs7: charts?.subs7 ?? [],
        sales7: charts?.sales7 ?? [],
        visits: v,
        pendingTrials: pend,
        billingOfferRows: offers,
        fleetDevices: fleet,
        auditFeed: audit,
      };
    } finally {
      loadInFlightRef.current = false;
      setOpsLoading(false);
    }
  }, [adminRow, loadChartBuckets, loadScope, mapDistrictId, previewMode, seedPreview]);

  useEffect(() => {
    if (previewMode) {
      seedPreview();
      return;
    }
    if (!adminRow) return;
    const cache = INTERNAL_OPS_CACHE;
    if (cache && Date.now() - cache.at < INTERNAL_OPS_CACHE_TTL_MS) {
      hydrateFromCache(cache);
      setOpsLoading(false);
      void loadAll({ silent: true });
      return;
    }
    void loadAll();
  }, [adminRow?.id, previewMode, loadScope]);

  useEffect(() => {
    if (previewMode || !adminRow) return;
    const pollMs =
      loadScope === "shops" || loadScope === "devices" || loadScope === "support" ? 60_000 : 45_000;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadAll({ silent: true });
    };
    const id = window.setInterval(tick, pollMs);
    return () => window.clearInterval(id);
  }, [adminRow?.id, previewMode, loadScope, loadAll]);

  useEffect(() => {
    if (previewMode || !adminRow || loadScope !== "full") return;
    void fetchFieldMapPins({ districtId: mapDistrictId || null, limit: 400 }).then(setMapPins);
  }, [adminRow?.id, mapDistrictId, previewMode, loadScope]);

  const shopOpenings = useMemo(() => {
    const byId = new Map<string, RecentShopRow>();
    for (const row of recent) byId.set(row.id, row);
    for (const s of stats?.latestSignups ?? []) {
      if (byId.has(s.shop_id)) continue;
      byId.set(s.shop_id, {
        id: s.shop_id,
        name: s.shop_name,
        district: s.district,
        city: null,
        owner_email: s.owner_email,
        owner_label: s.owner_name,
        plan_code: s.plan_code,
        trial_days_left: null,
        is_active: s.subscription_status === "active",
        gps_missing: true,
        created_at: s.created_at,
        last_seen_at: null,
        product_count: undefined,
        sale_count_30d: undefined,
      });
    }
    return [...byId.values()].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }, [recent, stats?.latestSignups]);

  const pendingAnnualTickets = useMemo(
    () => tickets.filter((tk) => tk.status === "pending" && tk.issue_type === "annual_plan_request"),
    [tickets],
  );

  const openSupportTickets = useMemo(
    () => tickets.filter((tk) => tk.status === "pending" || tk.status === "open"),
    [tickets],
  );

  const fmtUgx = (n: number | null | undefined) =>
    n === null || n === undefined || Number.isNaN(n) ? "—" : `UGX ${n.toLocaleString("en-UG")}`;

  const statGrid = useMemo(() => {
    if (!stats) {
      return {
        total: "—",
        active: "—",
        paid: "—",
        trial: "—",
        endedTrials: "—",
        expiring: "—",
        devices: "—",
        support: "—",
        sales: "—" as string,
        suspended: "—",
        pendingAnnual: "—",
      };
    }
    const ended = (stats.lapsedTrials ?? 0) + (stats.expiredSubscriptions ?? 0);
    return {
      total: String(stats.totalShops),
      active: String(stats.activeToday),
      paid: String(stats.paidSubscriptions),
      trial: String(stats.trialSubscriptions),
      endedTrials: String(ended),
      expiring: String(stats.expiringTrialsNext7d ?? 0),
      devices: String(stats.activeDevices ?? 0),
      support: String(stats.openSupportTickets ?? 0),
      sales: fmtUgx(stats.salesTotalUgx),
      suspended: String(stats.suspendedShops ?? 0),
      pendingAnnual: String(stats.pendingAnnualRequests ?? 0),
    };
  }, [stats]);

  const shopHealthById = useMemo(() => {
    const m = new Map<string, ShopHealth>();
    for (const s of shopOpenings) m.set(s.id, computeShopHealth(s));
    return m;
  }, [shopOpenings]);

  const fleetPendingSync = useMemo(
    () => fleetDevices.reduce((sum, d) => sum + (d.pending_sync > 0 ? 1 : 0), 0),
    [fleetDevices],
  );

  const appVersions = useMemo(() => aggregateAppVersions(fleetDevices), [fleetDevices]);

  const systemHealth = useMemo(
    () => computeSystemHealth(stats, shopOpenings, fleetPendingSync, appVersions),
    [stats, shopOpenings, fleetPendingSync, appVersions],
  );

  const activityFeed = useMemo((): OpsFeedEvent[] => {
    const base = buildOpsActivityFeed({
      shops: shopOpenings,
      tickets,
      pendingTrials,
      latestSignups: stats?.latestSignups ?? [],
    });
    for (const a of auditFeed.slice(0, 8)) {
      base.push({
        id: `audit-${a.id}`,
        at: a.created_at,
        timeLabel: new Intl.DateTimeFormat("en-GB", {
          timeZone: "Africa/Kampala",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(a.created_at)),
        message: `${a.action.replace(/_/g, " ")}${a.actor ? ` · ${a.actor}` : ""}`,
        priority: "low",
        shopId: a.target_shop_id ?? undefined,
        kind: "system",
      });
    }
    return base.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, 35);
  }, [shopOpenings, tickets, pendingTrials, stats?.latestSignups, auditFeed]);

  return {
    opsLoading,
    stats,
    statsError,
    statsErrorMessage,
    plans,
    tickets,
    districts,
    bizTypes,
    signups7,
    subs7,
    sales7,
    visits,
    mapPins,
    mapDistrictId,
    setMapDistrictId,
    pendingTrials,
    billingOfferRows,
    shopOpenings,
    pendingAnnualTickets,
    openSupportTickets,
    statGrid,
    fleetDevices,
    auditFeed,
    shopHealthById,
    systemHealth,
    activityFeed,
    appVersions,
    loadAll,
    seedPreview,
  };
}
