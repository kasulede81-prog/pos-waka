import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  ChevronRight,
  MapPin,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { ResponsiveDataTable } from "../shared/ResponsiveDataTable";
import { AdminHero, AdminOpsPanel, AdminSectionSelect } from "./adminUi";
import { LovableFieldMap } from "./LovableFieldMap";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  PREVIEW_BIZ_TYPES,
  PREVIEW_DASHBOARD_STATS,
  PREVIEW_DISTRICTS,
  PREVIEW_MAP_PINS,
  PREVIEW_PLAN_METRICS,
  PREVIEW_RECENT_SHOPS,
  PREVIEW_SUPPORT_TICKETS,
  internalAdminShopHref,
  previewDayBuckets,
} from "../../lib/internalAdminPreview";
import {
  fetchBusinessTypeSlices,
  fetchDistrictOpsTable,
  fetchFieldMapPins,
  fetchFieldVisitsOpen,
  fetchInternalDashboardStats,
  fetchInternalOpsCharts7d,
  fetchOrgBillingOffersForQueue,
  fetchPendingSubscriptionRequests,
  fetchPlanTierMetrics,
  fetchShopsBySignupDate,
  fetchSalesVolumeBuckets7d,
  fetchShopSignupBuckets7d,
  fetchSubscriptionGrowthBuckets7d,
  fetchSupportTickets,
  formatDisplayEmail,
  formatOwnerDisplayLabel,
  type BusinessTypeSlice,
  type DayBucket,
  type DistrictOpsRow,
  type FieldMapPin,
  type FieldVisitRow,
  type InternalDashboardStats,
  type OrgBillingOfferStaffRow,
  type PendingSubscriptionRequestRow,
  type PlanTierMetrics,
  type RecentShopRow,
  type SupportTicketRow,
  type WakaInternalAdminRow,
} from "../../lib/wakaInternalAdmin";

import { InternalOpsQueuePanels } from "./InternalOpsQueuePanels";

const InternalFieldOpsMap = lazy(async () => {
  const m = await import("./InternalFieldOpsMap");
  return { default: m.InternalFieldOpsMap };
});

type Props = {
  lang: Language;
  email: string | null | undefined;
  adminRow: WakaInternalAdminRow | null;
  /** Dev / soft gate: show layout without live Supabase data. */
  previewMode: boolean;
  /** Use Lovable-import visual patterns (hero, shortcuts, simple map). */
  lovableUi?: boolean;
};

function kampalaNowParts(): { hour: number; dateStr: string } {
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

function greetingKey(hour: number): string {
  if (hour < 12) return "internalDashGreetMorning";
  if (hour < 17) return "internalDashGreetAfternoon";
  return "internalDashGreetEvening";
}

function SparkBars({ buckets, accentClass }: { buckets: DayBucket[]; accentClass: string }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex h-28 items-end justify-between gap-1.5 px-1">
      {buckets.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={clsx("w-full max-w-[2.25rem] rounded-t-lg transition-all duration-500", accentClass)}
            style={{ height: `${Math.max(8, (b.count / max) * 100)}%`, minHeight: b.count > 0 ? 12 : 4 }}
            title={`${b.label}: ${b.count}`}
          />
          <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function MiniSparkline({ values, stroke }: { values: number[]; stroke: string }) {
  const w = 120;
  const h = 40;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden>
      <polyline fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke={stroke} points={pts.join(" ")} />
    </svg>
  );
}

type OpsPanelId = "shops" | "districts" | "map" | "plans" | "support" | "trials" | "annual" | "charts" | "visits";

function PulseMetricChip({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-background"
    >
      <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-0.5 font-mono text-lg font-black text-foreground">{value}</span>
      <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold text-primary">
        {onOpen ? (
          <>
            Open <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
          </>
        ) : (
          "—"
        )}
      </span>
    </button>
  );
}

function PlanPremiumCard({ lang, plan, tone }: { lang: Language; plan: PlanTierMetrics; tone: "slate" | "orange" | "gold" }) {
  const nameKey =
    plan.code === "starter" ? "planStarterName" : plan.code === "business" ? "planBusinessName" : "planWakaPlusName";
  const toneCls = tone === "slate" ? "bg-card" : tone === "orange" ? "bg-primary/5" : "bg-secondary/5";
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-xl border border-border p-4 transition-transform duration-300 hover:-translate-y-0.5",
        toneCls,
      )}
    >
      <div className="absolute right-0 top-0 h-24 w-24 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary/10 blur-2xl" />
      <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(lang, "internalPlanLabel")}</p>
      <h3 className="mt-1 text-sm font-semibold text-foreground">{t(lang, nameKey)}</h3>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "internalPlanActiveShops")}</dt>
          <dd className="font-mono text-lg font-black text-foreground">{plan.activeCount}</dd>
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "internalPlanTrials")}</dt>
          <dd className="font-mono text-lg font-black text-foreground">{plan.trialCount}</dd>
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "internalPlanExpiring")}</dt>
          <dd className="font-mono text-lg font-black text-primary">{plan.expiringSoonCount}</dd>
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "internalPlanMrrEst")}</dt>
          <dd className="font-mono text-lg font-black text-secondary">UGX {plan.estimatedMonthlyRevenueUgx.toLocaleString("en-UG")}</dd>
        </div>
      </dl>
    </div>
  );
}

export function InternalOpsDashboard({ lang, email, adminRow, previewMode, lovableUi = false }: Props) {
  const { hour, dateStr } = useMemo(() => kampalaNowParts(), []);
  const displayName =
    adminRow?.full_name?.trim() ||
    (adminRow?.email ? adminRow.email.split("@")[0] : (email ?? "").split("@")[0]) ||
    "Team";
  const roleNorm = (adminRow?.role ?? "").toLowerCase();
  const canResolveSupport = roleNorm === "super_admin" || roleNorm === "support_admin" || roleNorm === "finance_admin";
  const canManageTrials =
    roleNorm === "super_admin" ||
    roleNorm === "subscriptions_admin" ||
    roleNorm === "finance_admin" ||
    roleNorm === "operations_admin";
  const canManageBillingOffers =
    roleNorm === "super_admin" ||
    roleNorm === "subscriptions_admin" ||
    roleNorm === "finance_admin" ||
    roleNorm === "operations_admin";
  const canSendAnnualOffer =
    roleNorm === "super_admin" ||
    roleNorm === "subscriptions_admin" ||
    roleNorm === "finance_admin" ||
    roleNorm === "operations_admin" ||
    roleNorm === "support_admin";
  const mapboxAccessToken = useMemo(
    () => import.meta.env.VITE_MAPBOX_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    [],
  );

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
  const [districtFilter, setDistrictFilter] = useState("");
  const [mapPins, setMapPins] = useState<FieldMapPin[]>([]);
  const [mapDistrictId, setMapDistrictId] = useState<string>("");
  const [visitBusyId, setVisitBusyId] = useState<string | null>(null);
  const [ticketBusyId, setTicketBusyId] = useState<string | null>(null);
  const [visitMsg, setVisitMsg] = useState<string | null>(null);
  const [pendingTrials, setPendingTrials] = useState<PendingSubscriptionRequestRow[]>([]);
  const [trialBusyId, setTrialBusyId] = useState<string | null>(null);
  const [annualBusyId, setAnnualBusyId] = useState<string | null>(null);
  const [annualSendBusy, setAnnualSendBusy] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [annualAmountByTicket, setAnnualAmountByTicket] = useState<Record<string, string>>({});
  const [billingOfferRows, setBillingOfferRows] = useState<OrgBillingOfferStaffRow[]>([]);
  const [billingFulfillBusy, setBillingFulfillBusy] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<OpsPanelId | null>(null);

  const openPanel = useCallback((id: OpsPanelId) => setActivePanel(id), []);
  const closePanel = useCallback(() => setActivePanel(null), []);

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
    setStatsError(false);
    setStatsErrorMessage("");
    setOpsLoading(false);
  }, []);

  const loadAll = useCallback(async () => {
    if (previewMode) {
      seedPreview();
      return;
    }
    if (!adminRow) return;
    setOpsLoading(true);
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

      const charts = await fetchInternalOpsCharts7d();
      if (charts?.signups?.length) {
        setSignups7(charts.signups);
        setSubs7(charts.subscriptions);
        setSales7(charts.sales);
      } else {
        const [su7, sub7, sa7] = await Promise.all([
          fetchShopSignupBuckets7d(),
          fetchSubscriptionGrowthBuckets7d(),
          fetchSalesVolumeBuckets7d(),
        ]);
        setSignups7(su7.length ? su7 : Array.from({ length: 7 }, (_, i) => ({ label: `${i + 1}`, count: 0 })));
        setSubs7(sub7.length ? sub7 : Array.from({ length: 7 }, (_, i) => ({ label: `${i + 1}`, count: 0 })));
        setSales7(sa7.length ? sa7 : Array.from({ length: 7 }, (_, i) => ({ label: `${i + 1}`, count: 0 })));
      }

      const [p, r, tk, d, b, v, pins, pend, offers] = await Promise.all([
        fetchPlanTierMetrics(),
        fetchShopsBySignupDate(100),
        fetchSupportTickets(80),
        fetchDistrictOpsTable(),
        fetchBusinessTypeSlices(),
        fetchFieldVisitsOpen(),
        fetchFieldMapPins({ districtId: mapDistrictId || null, limit: 400 }),
        fetchPendingSubscriptionRequests(40),
        fetchOrgBillingOffersForQueue(60),
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
    } finally {
      setOpsLoading(false);
    }
  }, [adminRow, mapDistrictId, previewMode, seedPreview]);

  useEffect(() => {
    if (previewMode) {
      seedPreview();
      return;
    }
    if (!adminRow) return;
    void loadAll();
  }, [adminRow, previewMode, loadAll, seedPreview]);

  useEffect(() => {
    if (previewMode || !adminRow) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadAll();
    };
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [adminRow, previewMode, loadAll]);

  useEffect(() => {
    if (previewMode || !adminRow) return;
    void fetchFieldMapPins({ districtId: mapDistrictId || null, limit: 400 }).then(setMapPins);
  }, [adminRow, mapDistrictId, previewMode]);

  const filteredDistricts = useMemo(() => {
    const q = districtFilter.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter((d) => d.label.toLowerCase().includes(q));
  }, [districts, districtFilter]);

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

  const fmtUgx = (n: number | null | undefined) =>
    n === null || n === undefined || Number.isNaN(n) ? "—" : `UGX ${n.toLocaleString("en-UG")}`;

  const salesSpark = useMemo(() => sales7.map((b) => b.count), [sales7]);
  const signupSpark = useMemo(() => signups7.map((b) => b.count), [signups7]);
  const subsSpark = useMemo(() => subs7.map((b) => b.count), [subs7]);

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

  return (
    <div className={lovableUi ? "space-y-4 pb-4 sm:space-y-6 sm:pb-6" : "space-y-3 pb-4 sm:space-y-4 sm:pb-6"}>
      {lovableUi ? (
        <AdminHero
          greeting={t(lang, greetingKey(hour))}
          subtitle={displayName}
          dateLabel={dateStr}
          roleLabel={(adminRow?.role ?? "admin").replace(/_/g, " ")}
          districtCount={adminRow?.assigned_district_ids?.length ?? 0}
          onRefresh={() => void (previewMode ? seedPreview() : loadAll())}
          refreshing={opsLoading}
        />
      ) : (
      <header className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
        <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t(lang, "internalDashOpsCenter")}
            </div>
            <h1 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
              {t(lang, greetingKey(hour))}, {displayName}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                {dateStr}
              </span>
              {adminRow ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-primary-foreground">
                  {adminRow.role.replace(/_/g, " ")}
                </span>
              ) : previewMode ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary bg-muted px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-primary">
                  {t(lang, "internalDashPreviewBadge")}
                </span>
              ) : null}
              {adminRow ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-foreground">
                  {String(adminRow.assigned_district_ids?.length ?? 0)} {t(lang, "internalDashDistrictsBadge")}
                </span>
              ) : null}
            </p>
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{t(lang, "internalDashHeroSub")}</p>
          </div>
          <div className="flex shrink-0 gap-2 overflow-x-auto">
            <button
              type="button"
              disabled={!adminRow || opsLoading}
              onClick={() => void loadAll()}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-black text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", opsLoading && "animate-spin")} />
              {t(lang, "internalDashQuickRefresh")}
            </button>
          </div>
        </div>
      </header>
      )}

      {previewMode ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          {t(lang, "internalAdminPreviewOverviewHint")}
        </p>
      ) : null}
      {!previewMode && statsError ? (
        <p className="rounded-xl border border-destructive/25 bg-card px-4 py-3 text-xs font-bold text-destructive">
          {t(lang, "internalStatsError")}
          {statsErrorMessage ? (
            <span className="mt-1 block font-mono text-[11px] font-semibold text-destructive">{statsErrorMessage}</span>
          ) : null}
        </p>
      ) : null}
      {deleteMsg ? (
        <p className="rounded-xl border border-destructive/25 bg-card px-4 py-3 text-xs font-bold text-destructive">
          {deleteMsg}
        </p>
      ) : null}

      <AdminSectionSelect
        label={t(lang, "internalAdminOpsSelect")}
        value={activePanel ?? ""}
        onChange={(v) => {
          if (!v) closePanel();
          else openPanel(v as OpsPanelId);
        }}
        options={[
          { value: "", label: t(lang, "internalAdminOverviewOnly") },
          {
            value: "shops",
            label: t(lang, "internalOpsPanelShops"),
            count: Number(statGrid.total) || shopOpenings.length,
          },
          { value: "districts", label: t(lang, "internalOpsPanelDistricts"), count: districts.length },
          { value: "map", label: t(lang, "internalOpsPanelMap"), count: mapPins.length },
          { value: "plans", label: t(lang, "internalPlansTitle") },
          { value: "support", label: t(lang, "internalSupportTitle"), count: Number(statGrid.support) || tickets.length },
          { value: "trials", label: t(lang, "internalPendingTrialsTitle"), count: pendingTrials.length },
          { value: "annual", label: t(lang, "internalAnnualQueueTitle"), count: pendingAnnualTickets.length },
          { value: "charts", label: t(lang, "internalInsightsTitle") },
          { value: "visits", label: t(lang, "internalFieldVisitsTitle"), count: visits.length },
        ]}
        className="rounded-xl border border-border bg-card p-3"
      />

      {/* Stats — compact pulse with drill-down */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold text-card-foreground">{t(lang, "internalDashPulseTitle")}</h2>
          <p className="text-[11px] font-medium text-muted-foreground">
            {statGrid.total} {t(lang, "internalStat_totalShops").toLowerCase()} · {statGrid.active}{" "}
            {t(lang, "internalStat_activeToday").toLowerCase()}
            {opsLoading ? <span className="ml-2 text-primary">{t(lang, "internalDashSyncing")}</span> : null}
          </p>
        </div>
        <div className="space-y-3 border-t border-border bg-muted/20 px-3 pb-3 pt-3">
            <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "internalPulseTapHint")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <PulseMetricChip
                label={t(lang, "internalStat_totalShops")}
                value={statGrid.total}
                onOpen={() => openPanel("shops")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_activeToday")}
                value={statGrid.active}
                onOpen={() => openPanel("districts")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_paidSubs")}
                value={statGrid.paid}
                onOpen={() => openPanel("plans")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_trialSubs")}
                value={statGrid.trial}
                onOpen={() => openPanel("trials")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_salesShort")}
                value={statGrid.sales}
                onOpen={() => openPanel("charts")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_supportOpen")}
                value={statGrid.support}
                onOpen={() => openPanel("support")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_pendingAnnual")}
                value={statGrid.pendingAnnual}
                onOpen={() => openPanel("annual")}
              />
            </div>
            <details className="rounded-xl border border-stone-100 bg-stone-50/50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-stone-600">
                {t(lang, "internalPulseMoreMetrics")}
              </summary>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-stone-100">
                  <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalStat_endedTrials")}</dt>
                  <dd className="font-mono font-black text-stone-900">{statGrid.endedTrials}</dd>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-stone-100">
                  <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalStat_expiringSoon")}</dt>
                  <dd className="font-mono font-black text-stone-900">{statGrid.expiring}</dd>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-stone-100">
                  <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalStat_devices")}</dt>
                  <dd className="font-mono font-black text-stone-900">{statGrid.devices}</dd>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-stone-100">
                  <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalStat_suspendedShops")}</dt>
                  <dd className="font-mono font-black text-stone-900">{statGrid.suspended}</dd>
                </div>
              </dl>
            </details>
          </div>
      </section>

      <AdminOpsPanel
        title={t(lang, "internalOpsPanelShops")}
        subtitle={
          stats
            ? tTemplate(lang, "internalOpsPanelShopsSubCount", {
                shown: String(shopOpenings.length),
                total: String(stats.totalShops),
              })
            : t(lang, "internalOpsPanelShopsSub")
        }
        open={activePanel === "shops"}
        onClose={closePanel}
        wide
      >
        <ResponsiveDataTable minWidthPx={720}>
          <thead>
            <tr className="border-b border-border bg-muted/50 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">{t(lang, "internalRecentColName")}</th>
              <th className="px-3 py-2">{t(lang, "internalRecentColDistrict")}</th>
              <th className="px-3 py-2">{t(lang, "internalRecentColOwner")}</th>
              <th className="px-3 py-2">{t(lang, "internalRecentColPlan")}</th>
              <th className="px-3 py-2">{t(lang, "internalRecentColJoined")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
              {opsLoading && !shopOpenings.length ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-stone-50">
                    <td colSpan={6} className="px-3 py-2">
                      <div className="h-4 animate-pulse rounded bg-stone-100" />
                    </td>
                  </tr>
                ))
              ) : shopOpenings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm font-semibold text-stone-500">
                    No shops found
                  </td>
                </tr>
              ) : (
                shopOpenings.map((row) => (
                  <tr key={row.id} className="border-b border-stone-50 hover:bg-orange-50/30">
                    <td className="max-w-[10rem] truncate px-3 py-2 font-bold text-stone-900">{row.name}</td>
                    <td className="max-w-[8rem] truncate px-3 py-2 text-xs text-stone-600">
                      {[row.district, row.city].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-xs font-semibold text-stone-700">
                      {formatDisplayEmail(row.owner_email) ??
                        formatOwnerDisplayLabel({ ownerLabel: row.owner_label }) ??
                        "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs uppercase">{row.plan_code ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-stone-500">
                      {row.created_at ? new Date(row.created_at).toLocaleDateString("en-GB") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={internalAdminShopHref(row.id, previewMode)}
                        onClick={closePanel}
                        className="inline-flex rounded-lg bg-primary px-2.5 py-1 text-[10px] font-black uppercase text-primary-foreground"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
        </ResponsiveDataTable>
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalDistrictTitle")}
        subtitle={t(lang, "internalOpsPanelDistrictsSub")}
        open={activePanel === "districts"}
        onClose={closePanel}
        wide
      >
        <div className="relative mb-3">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            placeholder={t(lang, "internalDistrictSearch")}
            className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm font-semibold text-foreground outline-none ring-primary/20 focus:ring-2"
          />
        </div>
        <div className="overflow-x-auto rounded-xl ring-1 ring-border">
          <table className="min-w-[640px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">{t(lang, "internalDistrictColDistrict")}</th>
                <th className="px-4 py-3 text-right">{t(lang, "internalDistrictColShops")}</th>
                <th className="px-4 py-3 text-right">{t(lang, "internalDistrictColActive")}</th>
                <th className="px-4 py-3 text-right">{t(lang, "internalDistrictColPaid")}</th>
                <th className="px-4 py-3 text-right">{t(lang, "internalDistrictColAgents")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDistricts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-stone-500">
                    {t(lang, "internalDistrictEmpty")}
                  </td>
                </tr>
              ) : (
                filteredDistricts.map((row) => (
                  <tr key={row.districtId ?? row.label} className="border-b border-stone-50 hover:bg-orange-50/30">
                    <td className="px-4 py-3 font-bold text-stone-900">{row.label}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-800">{row.totalShops}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-800">{row.activeToday}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-800">{row.paidShops}</td>
                    <td className="px-4 py-3 text-right font-mono text-orange-900">{row.fieldAgentsAssigned}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {(stats?.shopsByDistrict?.length ? stats.shopsByDistrict : []).length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {(stats?.shopsByDistrict ?? []).slice(0, 12).map((d) => (
              <span
                key={d.label}
                className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-xs font-bold text-stone-800"
              >
                {d.label}
                <span className="font-mono text-orange-800">{d.count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalMapTitle")}
        subtitle={t(lang, "internalMapSub")}
        open={activePanel === "map"}
        onClose={closePanel}
        wide
      >
        <label className="mb-3 flex max-w-xs flex-col text-[11px] font-black uppercase tracking-wide text-stone-600">
          {t(lang, "internalMapFilterDistrict")}
          <select
            value={mapDistrictId}
            onChange={(e) => setMapDistrictId(e.target.value)}
            className="mt-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-900"
          >
            <option value="">{t(lang, "internalMapFilterAll")}</option>
            {districts
              .filter((row) => row.districtId)
              .map((row) => (
                <option key={row.districtId!} value={row.districtId!}>
                  {row.label}
                </option>
              ))}
          </select>
        </label>
        <p className="mb-3 text-sm font-bold text-stone-700">
          {t(lang, "internalMapShopCount").replace("{{count}}", String(mapPins.length))}
        </p>
        {mapboxAccessToken ? (
          <Suspense fallback={<div className="h-[min(22rem,55vh)] min-h-[220px] animate-pulse rounded-2xl bg-stone-100" />}>
            <InternalFieldOpsMap lang={lang} pins={mapPins} accessToken={mapboxAccessToken} />
          </Suspense>
        ) : (
          <LovableFieldMap pins={mapPins} />
        )}
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalPlansTitle")}
        open={activePanel === "plans"}
        onClose={closePanel}
        wide
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {(plans.length
            ? plans
            : [
                { code: "starter" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 },
                { code: "business" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 },
                { code: "waka_plus" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 },
              ]
          ).map((plan, idx) => (
            <PlanPremiumCard key={plan.code} lang={lang} plan={plan} tone={idx === 0 ? "slate" : idx === 1 ? "orange" : "gold"} />
          ))}
        </div>
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalInsightsTitle")}
        open={activePanel === "charts"}
        onClose={closePanel}
        wide
      >
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "internalChartSignups")}</p>
              <MiniSparkline values={signupSpark.length ? signupSpark : [0, 0, 0, 0, 0]} stroke="#ea580c" />
            </div>
            <SparkBars buckets={signups7} accentClass="bg-gradient-to-t from-orange-500 to-orange-300" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "internalChartSubs")}</p>
              <MiniSparkline values={subsSpark.length ? subsSpark : [0, 0, 0, 0, 0]} stroke="#0d9488" />
            </div>
            <SparkBars buckets={subs7} accentClass="bg-gradient-to-t from-teal-500 to-emerald-300" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "internalChartSalesTrend")}</p>
              <MiniSparkline values={salesSpark.length ? salesSpark : [0, 0, 0, 0, 0]} stroke="#7c3aed" />
            </div>
            <SparkBars buckets={sales7} accentClass="bg-gradient-to-t from-violet-500 to-violet-300" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(bizTypes.length ? bizTypes : [{ type: "—", count: 0 }]).map((b) => (
              <span key={b.type} className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold capitalize text-stone-800">
                {b.type.replace(/_/g, " ")} <span className="font-mono font-black text-orange-700">{b.count}</span>
              </span>
            ))}
          </div>
        </div>
      </AdminOpsPanel>

      {/* trials, support, annual, visits panels — reuse legacy markup via id refs */}
      <InternalOpsQueuePanels
        lang={lang}
        previewMode={previewMode}
        activePanel={activePanel}
        closePanel={closePanel}
        opsLoading={opsLoading}
        pendingTrials={pendingTrials}
        pendingAnnualTickets={pendingAnnualTickets}
        tickets={tickets}
        visits={visits}
        visitMsg={visitMsg}
        canManageTrials={canManageTrials}
        canResolveSupport={canResolveSupport}
        canSendAnnualOffer={canSendAnnualOffer}
        canManageBillingOffers={canManageBillingOffers}
        trialBusyId={trialBusyId}
        setTrialBusyId={setTrialBusyId}
        annualBusyId={annualBusyId}
        setAnnualBusyId={setAnnualBusyId}
        annualSendBusy={annualSendBusy}
        setAnnualSendBusy={setAnnualSendBusy}
        ticketBusyId={ticketBusyId}
        setTicketBusyId={setTicketBusyId}
        visitBusyId={visitBusyId}
        setVisitBusyId={setVisitBusyId}
        setVisitMsg={setVisitMsg}
        setDeleteMsg={setDeleteMsg}
        annualAmountByTicket={annualAmountByTicket}
        setAnnualAmountByTicket={setAnnualAmountByTicket}
        billingOfferRows={billingOfferRows}
        billingFulfillBusy={billingFulfillBusy}
        setBillingFulfillBusy={setBillingFulfillBusy}
        loadAll={loadAll}
      />
    </div>
  );
}
