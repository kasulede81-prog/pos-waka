import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Calendar,
  ChevronRight,
  CreditCard,
  Headphones,
  LifeBuoy,
  MapPin,
  RefreshCw,
  Sparkles,
  Store,
  Trash2,
} from "lucide-react";
import { AdminHero, AdminShortcut } from "./adminUi";
import { LovableFieldMap } from "./LovableFieldMap";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
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
  deleteSubscriptionRequest,
  deleteSupportTicket,
  internalOpsOrgBillingOfferFulfill,
  internalOpsOrgBillingOfferSend,
  internalOpsSetSubscriptionRequestStatus,
  fetchPlanTierMetrics,
  fetchRecentShops,
  fetchSalesVolumeBuckets7d,
  fetchShopSignupBuckets7d,
  fetchSubscriptionGrowthBuckets7d,
  fetchSupportTickets,
  googleMapsDirectionsUrl,
  markFieldVisitCompleted,
  updateSupportTicketStatus,
  whatsappUrlFromPhone,
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

function scrollToOpsSection(id: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

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
        fetchRecentShops(18),
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
    const id = window.setInterval(() => void loadAll(), 30_000);
    return () => window.clearInterval(id);
  }, [adminRow, previewMode, loadAll]);

  const filteredDistricts = useMemo(() => {
    const q = districtFilter.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter((d) => d.label.toLowerCase().includes(q));
  }, [districts, districtFilter]);

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

  const workAreas = [
    { href: "#ops-support", label: "Support", count: tickets.length, Icon: lovableUi ? LifeBuoy : Headphones, tone: "bg-violet-50 text-violet-900" },
    { href: "#ops-recent-shops", label: "Shops", count: recent.length, Icon: lovableUi ? Store : Building2, tone: "bg-orange-50 text-orange-950" },
    { href: "#ops-annual-queue", label: "Payments", count: pendingAnnualTickets.length, Icon: lovableUi ? CreditCard : Calendar, tone: "bg-amber-50 text-amber-950" },
    { href: "#ops-districts", label: "Districts", count: districts.length, Icon: MapPin, tone: "bg-emerald-50 text-emerald-950" },
  ];

  return (
    <div className={lovableUi ? "space-y-6 pb-6" : "space-y-4 pb-6"}>
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

      {lovableUi ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <AdminShortcut href="#ops-support" Icon={LifeBuoy} label="Support" count={tickets.length} />
          <AdminShortcut href="#ops-recent-shops" Icon={Store} label="Shops" count={recent.length} />
          <AdminShortcut href="#ops-annual-queue" Icon={CreditCard} label="Payments" count={pendingAnnualTickets.length} />
          <AdminShortcut href="#ops-districts" Icon={MapPin} label="Districts" count={districts.length} />
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {workAreas.map(({ href, label, count, Icon, tone }) => (
            <a
              key={href}
              href={href}
              className={clsx("rounded-2xl border border-border bg-card p-3 shadow-sm active:scale-[0.99]", tone)}
            >
              <span className="flex items-center justify-between gap-2">
                <Icon className="h-4 w-4" />
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-black">{count}</span>
              </span>
              <span className="mt-3 block text-sm font-black">{label}</span>
              <span className="mt-0.5 block text-[11px] font-bold opacity-70">Open section</span>
            </a>
          ))}
        </section>
      )}

      {/* Stats — compact pulse with drill-down */}
      <section id="ops-pulse" className="overflow-hidden rounded-xl border border-border bg-card scroll-mt-4">
        <details open className="group/pulse">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
            <div>
              <h2 className="text-sm font-semibold text-card-foreground">{t(lang, "internalDashPulseTitle")}</h2>
              <p className="text-[11px] font-medium text-muted-foreground">
                {statGrid.total} {t(lang, "internalStat_totalShops").toLowerCase()} · {statGrid.active}{" "}
                {t(lang, "internalStat_activeToday").toLowerCase()}
                {opsLoading ? <span className="ml-2 text-primary">{t(lang, "internalDashSyncing")}</span> : null}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-open/pulse:rotate-90" />
          </summary>
          <div className="space-y-3 border-t border-border bg-muted/20 px-3 pb-3 pt-3">
            <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "internalPulseTapHint")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <PulseMetricChip
                label={t(lang, "internalStat_totalShops")}
                value={statGrid.total}
                onOpen={() => scrollToOpsSection("ops-recent-shops")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_activeToday")}
                value={statGrid.active}
                onOpen={() => scrollToOpsSection("ops-districts")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_paidSubs")}
                value={statGrid.paid}
                onOpen={() => scrollToOpsSection("ops-plans")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_trialSubs")}
                value={statGrid.trial}
                onOpen={() => scrollToOpsSection("ops-pending-trials")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_salesShort")}
                value={statGrid.sales}
                onOpen={() => scrollToOpsSection("ops-charts")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_supportOpen")}
                value={statGrid.support}
                onOpen={() => scrollToOpsSection("ops-support")}
              />
              <PulseMetricChip
                label={t(lang, "internalStat_pendingAnnual")}
                value={statGrid.pendingAnnual}
                onOpen={() => scrollToOpsSection("ops-annual-queue")}
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
        </details>
      </section>

      {stats?.latestSignups?.length ? (
        <details className="rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50/50 to-white px-4 py-3 shadow-sm">
          <summary className="cursor-pointer text-base font-black text-stone-900 marker:content-none [&::-webkit-details-marker]:hidden">
            {t(lang, "internalLatestSignupsTitle")}{" "}
            <span className="ml-2 font-mono text-sm font-bold text-orange-800">({stats.latestSignups.length})</span>
          </summary>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.latestSignups.map((s) => (
              <li
                key={s.shop_id}
                className="rounded-2xl border border-orange-100 bg-gradient-to-br from-white to-orange-50/40 p-4 shadow-sm"
              >
                <Link
                  to={internalAdminShopHref(s.shop_id, previewMode)}
                  className="text-base font-black text-orange-950 underline decoration-orange-200"
                >
                  {s.shop_name}
                </Link>
                <p className="mt-1 text-xs font-semibold text-stone-600">
                  {[s.district].filter(Boolean).join(" · ") || "—"} · {s.owner_email ?? "—"}
                </p>
                <p className="mt-2 text-xs font-bold text-stone-500">
                  {t(lang, "internalRecentColPlan")}: <span className="font-mono uppercase text-stone-800">{s.plan_code ?? "—"}</span> ·{" "}
                  {t(lang, "internalRecentColStatus")}:{" "}
                  <span className="font-mono uppercase text-stone-800">{s.subscription_status ?? "—"}</span>
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {t(lang, "internalRecentColTrial")}: {s.trial_ends_at ? new Date(s.trial_ends_at).toLocaleDateString("en-GB") : "—"}
                </p>
                <p className="mt-1 font-mono text-[11px] text-stone-400">
                  {s.created_at ? new Date(s.created_at).toLocaleString("en-GB") : ""}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Plans */}
      <section id="ops-plans" className="space-y-3 scroll-mt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(lang, "internalPlansTitle")}</h2>
          <Building2 className="h-4 w-4 text-primary" />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {opsLoading && !plans.length
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-44 animate-pulse rounded-xl border border-border bg-card" />
              ))
            : (plans.length ? plans : [{ code: "starter" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 }, { code: "business" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 }, { code: "waka_plus" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 }]).map((plan, idx) => (
                <PlanPremiumCard key={plan.code} lang={lang} plan={plan} tone={idx === 0 ? "slate" : idx === 1 ? "orange" : "gold"} />
              ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Districts */}
          <section id="ops-districts" className="rounded-xl border border-border bg-card p-4 scroll-mt-4">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-card-foreground">{t(lang, "internalDistrictTitle")}</h2>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={districtFilter}
                  onChange={(e) => setDistrictFilter(e.target.value)}
                  placeholder={t(lang, "internalDistrictSearch")}
                  className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm font-semibold text-foreground outline-none ring-primary/20 focus:ring-2"
                />
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-border">
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
                  {opsLoading && !districts.length ? (
                    [...Array(6)].map((_, i) => (
                      <tr key={i} className="border-b border-stone-50">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="h-4 animate-pulse rounded bg-stone-100" />
                        </td>
                      </tr>
                    ))
                  ) : filteredDistricts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-stone-500">
                        {t(lang, "internalDistrictEmpty")}
                      </td>
                    </tr>
                  ) : (
                    filteredDistricts.map((row) => (
                      <tr key={row.districtId ?? row.label} className="border-b border-stone-50 transition hover:bg-orange-50/30">
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
          </section>

          <section id="ops-pending-trials" className="overflow-hidden rounded-xl border border-border bg-card scroll-mt-4">
            <details open={pendingTrials.length > 0} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-card-foreground">{t(lang, "internalPendingTrialsTitle")}</h2>
                  <p className="mt-1 truncate text-[11px] font-semibold text-muted-foreground">{t(lang, "internalPendingTrialsSub")}</p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">
                  {pendingTrials.length}
                </span>
              </summary>
            <ul className="space-y-3 border-t border-border bg-muted/10 p-3">
              {opsLoading && !pendingTrials.length ? (
                [...Array(3)].map((_, i) => (
                  <li key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
                ))
              ) : pendingTrials.length === 0 ? (
                <li className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
                  {t(lang, "internalPendingTrialsEmpty")}
                </li>
              ) : (
                pendingTrials.map((req) => (
                  <li
                    key={req.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-black text-stone-900">
                        {t(lang, "internalTrialPlanLabel")}:{" "}
                        <span className="uppercase text-orange-800">{req.requested_plan}</span>
                      </p>
                      <p className="mt-1 font-mono text-xs text-stone-500">
                        org {req.organization_id.slice(0, 8)}… · {new Date(req.created_at).toLocaleString("en-GB")}
                      </p>
                      {req.shop_id ? (
                        <Link
                          to={internalAdminShopHref(req.shop_id, previewMode)}
                          className="mt-2 inline-block text-xs font-black uppercase text-orange-800 underline decoration-orange-300"
                        >
                          {t(lang, "internalMapOpenShop")}
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        style={!canManageTrials ? { display: "none" } : undefined}
                        disabled={!canManageTrials || trialBusyId === `${req.id}-ok`}
                        onClick={async () => {
                          setTrialBusyId(`${req.id}-ok`);
                          const r = await internalOpsSetSubscriptionRequestStatus(req.id, "approved", null);
                          setTrialBusyId(null);
                          if (r.ok) {
                            window.dispatchEvent(new Event("waka:subscription-updated"));
                            void loadAll();
                          }
                        }}
                        className="h-7 rounded-lg bg-secondary px-3 text-xs font-black text-secondary-foreground disabled:opacity-40"
                      >
                        {trialBusyId === `${req.id}-ok` ? "…" : t(lang, "internalTrialApprove")}
                      </button>
                      <button
                        type="button"
                        style={!canManageTrials ? { display: "none" } : undefined}
                        disabled={!canManageTrials || trialBusyId === `${req.id}-no`}
                        onClick={async () => {
                          setTrialBusyId(`${req.id}-no`);
                          const r = await internalOpsSetSubscriptionRequestStatus(req.id, "rejected", "Rejected from dashboard");
                          setTrialBusyId(null);
                          if (r.ok) void loadAll();
                        }}
                        className="h-7 rounded-lg bg-destructive px-3 text-xs font-black text-destructive-foreground disabled:opacity-40"
                      >
                        {trialBusyId === `${req.id}-no` ? "…" : t(lang, "internalTrialReject")}
                      </button>
                      <button
                        type="button"
                        style={!canManageTrials ? { display: "none" } : undefined}
                        disabled={!canManageTrials || trialBusyId === `${req.id}-del`}
                        onClick={async () => {
                          if (!window.confirm("Delete this request?")) return;
                          setTrialBusyId(`${req.id}-del`);
                          setDeleteMsg(null);
                          const r = await deleteSubscriptionRequest(req.id);
                          setTrialBusyId(null);
                          if (r.ok) void loadAll();
                          else setDeleteMsg(r.message ?? "Delete failed.");
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-destructive/30 bg-card px-3 text-xs font-black text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {trialBusyId === `${req.id}-del` ? "…" : "Delete"}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
            </details>
          </section>

          <section id="ops-annual-queue" className="overflow-hidden rounded-3xl border border-amber-200/80 bg-white shadow-[0_12px_40px_rgb(28_25_23/0.04)] scroll-mt-4">
            <details open={pendingAnnualTickets.length > 0} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-gradient-to-br from-amber-50/50 to-white px-4 py-3 marker:content-none sm:px-5 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-stone-900 sm:text-base">{t(lang, "internalAnnualQueueTitle")}</h2>
                  <p className="mt-1 truncate text-xs font-semibold text-stone-600">{t(lang, "internalAnnualQueueSub")}</p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">
                  {pendingAnnualTickets.length}
                </span>
              </summary>
            <ul className="space-y-3 border-t border-amber-100 bg-amber-50/20 p-3 sm:p-4">
              {pendingAnnualTickets.length === 0 ? (
                <li className="rounded-2xl border border-dashed border-amber-200 bg-white/80 px-4 py-6 text-center text-sm font-semibold text-stone-600">
                  {t(lang, "internalAnnualQueueEmpty")}
                </li>
              ) : (
                pendingAnnualTickets.map((tk) => (
                  <li
                    key={tk.id}
                    className="flex flex-col gap-3 rounded-2xl border border-amber-100 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-black text-stone-900">{tk.shop_name ?? "—"}</p>
                      <p className="mt-1 text-xs font-semibold text-stone-500">
                        {tk.owner_email ?? "—"} · {tk.shop_phone_e164 ?? tk.contact_phone_e164 ?? "—"}
                      </p>
                      {tk.organization_id ? (
                        <p className="mt-1 font-mono text-[10px] text-stone-400">org {tk.organization_id}</p>
                      ) : (
                        <p className="mt-1 text-xs font-bold text-rose-700">{t(lang, "internalAnnualMissingOrg")}</p>
                      )}
                      <p className="mt-1 line-clamp-3 text-xs text-stone-600">{tk.body ?? tk.subject}</p>
                      <p className="mt-1 font-mono text-[11px] text-stone-400">{new Date(tk.created_at).toLocaleString("en-GB")}</p>
                    </div>
                    <div className="flex w-full min-w-[12rem] shrink-0 flex-col gap-2 sm:max-w-xs">
                      <label className="text-[10px] font-black uppercase text-stone-500">
                        {t(lang, "internalAnnualAmountUgx")}
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={annualAmountByTicket[tk.id] ?? ""}
                          onChange={(e) =>
                            setAnnualAmountByTicket((prev) => ({
                              ...prev,
                              [tk.id]: e.target.value,
                            }))
                          }
                          placeholder={t(lang, "internalAnnualAmountPlaceholder")}
                          className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-bold text-stone-900"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          style={!canSendAnnualOffer ? { display: "none" } : undefined}
                          disabled={
                            !canSendAnnualOffer ||
                            !tk.organization_id ||
                            annualSendBusy === tk.id ||
                            !(Number(annualAmountByTicket[tk.id] ?? 0) > 0)
                          }
                          onClick={async () => {
                            if (!tk.organization_id) return;
                            const amt = Math.floor(Number(annualAmountByTicket[tk.id] ?? 0));
                            if (!(amt > 0)) return;
                            setAnnualSendBusy(tk.id);
                            const r = await internalOpsOrgBillingOfferSend(
                              tk.organization_id,
                              amt,
                              t(lang, "internalAnnualOfferDefaultNote"),
                              tk.shop_id ?? null,
                            );
                            setAnnualSendBusy(null);
                            if (r.ok) {
                              window.dispatchEvent(new Event("waka:subscription-updated"));
                              void loadAll();
                            }
                          }}
                          className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                        >
                          {annualSendBusy === tk.id ? "…" : t(lang, "internalAnnualSendOffer")}
                        </button>
                        <button
                          type="button"
                          style={!canResolveSupport ? { display: "none" } : undefined}
                          disabled={!canResolveSupport || annualBusyId === `${tk.id}-ok`}
                          onClick={async () => {
                            setAnnualBusyId(`${tk.id}-ok`);
                            const r = await updateSupportTicketStatus(tk.id, "in_progress");
                            setAnnualBusyId(null);
                            if (r.ok) void loadAll();
                          }}
                          className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                        >
                          {annualBusyId === `${tk.id}-ok` ? "…" : t(lang, "internalAnnualQueueWorking")}
                        </button>
                        <button
                          type="button"
                          style={!canResolveSupport ? { display: "none" } : undefined}
                          disabled={!canResolveSupport || annualBusyId === `${tk.id}-cl`}
                          onClick={async () => {
                            setAnnualBusyId(`${tk.id}-cl`);
                            const r = await updateSupportTicketStatus(tk.id, "closed");
                            setAnnualBusyId(null);
                            if (r.ok) void loadAll();
                          }}
                          className="rounded-xl border-2 border-stone-300 bg-white px-3 py-2 text-xs font-black text-stone-900 disabled:opacity-40"
                        >
                          {annualBusyId === `${tk.id}-cl` ? "…" : t(lang, "internalAnnualQueueClose")}
                        </button>
                        <button
                          type="button"
                          style={!canResolveSupport ? { display: "none" } : undefined}
                          disabled={!canResolveSupport || annualBusyId === `${tk.id}-del`}
                          onClick={async () => {
                            if (!window.confirm("Delete this request?")) return;
                            setAnnualBusyId(`${tk.id}-del`);
                            setDeleteMsg(null);
                            const r = await deleteSupportTicket(tk.id);
                            setAnnualBusyId(null);
                            if (r.ok) void loadAll();
                            else setDeleteMsg(r.message ?? "Delete failed.");
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {annualBusyId === `${tk.id}-del` ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>

            {billingOfferRows.length > 0 ? (
              <div className="mt-6 rounded-2xl border border-orange-200/80 bg-white/90 p-4">
                <h3 className="text-sm font-black text-stone-900">{t(lang, "internalBillingOffersQueueTitle")}</h3>
                <p className="mt-1 text-xs font-semibold text-stone-600">{t(lang, "internalBillingOffersQueueSub")}</p>
                <ul className="mt-3 space-y-2">
                  {billingOfferRows.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-col gap-2 rounded-xl border border-stone-100 bg-stone-50/80 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-stone-500">
                          {o.organization_id.slice(0, 8)}… · {o.status}
                        </p>
                        <p className="font-black text-stone-900">
                          UGX {Number(o.amount_ugx).toLocaleString("en-UG")}{" "}
                          <span className="text-xs font-semibold text-stone-600">{o.message ? `· ${o.message}` : ""}</span>
                        </p>
                        <p className="text-[11px] text-stone-500">{new Date(o.created_at).toLocaleString("en-GB")}</p>
                      </div>
                      {o.status === "claimed_paid" && canManageBillingOffers ? (
                        <button
                          type="button"
                          disabled={billingFulfillBusy === o.id}
                          onClick={async () => {
                            setBillingFulfillBusy(o.id);
                            const r = await internalOpsOrgBillingOfferFulfill(o.id, null);
                            setBillingFulfillBusy(null);
                            if (r.ok) {
                              window.dispatchEvent(new Event("waka:subscription-updated"));
                              void loadAll();
                            }
                          }}
                          className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                        >
                          {billingFulfillBusy === o.id ? "…" : t(lang, "internalBillingOfferFulfill")}
                        </button>
                      ) : o.status === "pending" ? (
                        <span className="shrink-0 text-xs font-bold text-amber-800">{t(lang, "internalBillingOfferAwaitingOwner")}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            </details>
          </section>

          <section id="ops-recent-shops" className="overflow-hidden rounded-3xl border border-stone-200/80 bg-white shadow-[0_12px_40px_rgb(28_25_23/0.04)] scroll-mt-4">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none sm:px-5 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-stone-900 sm:text-base">{t(lang, "internalRecentTitle")}</h2>
                  <p className="mt-1 truncate text-xs font-semibold text-stone-500">Latest shops and plan status</p>
                </div>
                <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">
                  {recent.length}
                </span>
              </summary>
            <div className="border-t border-stone-100 bg-stone-50/40 p-3">
              {opsLoading && !recent.length ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-100" />
                  ))}
                </div>
              ) : recent.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-stone-200 bg-white px-4 py-8 text-center text-sm font-semibold text-stone-600">
                  No shops found
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {recent.map((row) => (
                    <article key={row.id} className="rounded-2xl border border-stone-100 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-black text-stone-950">{row.name}</h3>
                          <p className="mt-0.5 truncate text-xs font-semibold text-stone-500">
                            {[row.district, row.city].filter(Boolean).join(" · ") || "No location"}
                          </p>
                          <p className="mt-1 truncate text-xs font-bold text-stone-700">
                            {row.owner_label ?? row.owner_email ?? "No owner shown"}
                          </p>
                        </div>
                        <span
                          className={clsx(
                            "shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase",
                            row.is_active ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700",
                          )}
                        >
                          {row.is_active ? t(lang, "internalStatusActive") : t(lang, "internalStatusInactive")}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded-lg bg-stone-100 px-2 py-1 text-[10px] font-black uppercase text-stone-700">
                          {row.plan_code ?? "no plan"}
                        </span>
                        <span
                          className={clsx(
                            "rounded-lg px-2 py-1 text-[10px] font-black uppercase",
                            row.gps_missing === false ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900",
                          )}
                        >
                          {row.gps_missing === false ? t(lang, "internalGpsOk") : t(lang, "internalGpsMissing")}
                        </span>
                        <span className="rounded-lg bg-stone-100 px-2 py-1 text-[10px] font-bold text-stone-600">
                          {row.created_at ? new Date(row.created_at).toLocaleDateString("en-GB") : "—"}
                        </span>
                      </div>
                      <Link
                        to={internalAdminShopHref(row.id, previewMode)}
                        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-xl bg-primary px-3 text-xs font-black text-primary-foreground shadow-sm active:bg-primary/90"
                      >
                        Open / edit shop
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </div>
            </details>
          </section>

          {/* Support */}
          <section id="ops-support" className="overflow-hidden rounded-3xl border border-stone-200/80 bg-white shadow-[0_12px_40px_rgb(28_25_23/0.04)] scroll-mt-4">
            <details open={tickets.length > 0} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none sm:px-5 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-black text-stone-900 sm:text-base">{t(lang, "internalSupportTitle")}</h2>
                    <Headphones className="h-4 w-4 text-violet-500" />
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-stone-500">{t(lang, "internalSupportSub")}</p>
                </div>
                <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">
                  {tickets.length}
                </span>
              </summary>
            <ul className="space-y-3 border-t border-stone-100 bg-stone-50/50 p-3 sm:p-4">
              {opsLoading && !tickets.length ? (
                [...Array(4)].map((_, i) => (
                  <li key={i} className="h-20 animate-pulse rounded-2xl bg-stone-100" />
                ))
              ) : tickets.length === 0 ? (
                <li className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/80 px-4 py-8 text-center text-sm font-semibold text-stone-600">
                  {t(lang, "internalSupportEmpty")}
                </li>
              ) : (
                tickets.map((tk) => {
                  const waUrl = whatsappUrlFromPhone(tk.contact_phone_e164 ?? tk.shop_phone_e164);
                  return (
                    <li
                      key={tk.id}
                      className="flex flex-col gap-3 rounded-2xl border border-stone-100 bg-gradient-to-br from-white to-stone-50/80 p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-black text-stone-900">{tk.subject || t(lang, "internalSupportNoSubject")}</p>
                        <p className="mt-0.5 text-xs font-semibold text-stone-500">
                          {[tk.shop_name, tk.shop_district].filter(Boolean).join(" · ") || "—"} · {tk.channel} ·{" "}
                          {new Date(tk.created_at).toLocaleString("en-GB")}
                        </p>
                        {tk.owner_name || tk.owner_email ? (
                          <p className="mt-1 text-xs font-bold text-stone-700">
                            {t(lang, "internalRecentColOwner")}: {[tk.owner_name, tk.owner_email].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {tk.issue_type ? (
                          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{tk.issue_type}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-md bg-stone-900 px-2 py-0.5 text-[10px] font-black uppercase text-white">{tk.status}</span>
                          <span
                            className={clsx(
                              "rounded-md px-2 py-0.5 text-[10px] font-black uppercase",
                              tk.priority === "urgent" || tk.priority === "high"
                                ? "bg-rose-100 text-rose-900"
                                : "bg-orange-100 text-orange-900",
                            )}
                          >
                            {tk.priority}
                          </span>
                          {tk.shop_id ? (
                            <Link
                              to={internalAdminShopHref(tk.shop_id, previewMode)}
                              className="rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-black uppercase text-orange-950 underline decoration-orange-400"
                            >
                              {t(lang, "internalShopProfileTitle")}
                            </Link>
                          ) : null}
                          {waUrl ? (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase text-white"
                            >
                              {t(lang, "internalSupportWhatsapp")}
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
                        <button
                          type="button"
                          style={!canResolveSupport ? { display: "none" } : undefined}
                          disabled={!canResolveSupport || tk.status === "in_progress" || ticketBusyId === `${tk.id}-ip`}
                          onClick={async () => {
                            setTicketBusyId(`${tk.id}-ip`);
                            const r = await updateSupportTicketStatus(tk.id, "in_progress");
                            setTicketBusyId(null);
                            if (r.ok) void loadAll();
                          }}
                          className="rounded-xl border-2 border-stone-300 bg-white px-4 py-2.5 text-xs font-black text-stone-900 transition hover:bg-stone-50 disabled:opacity-40"
                        >
                          {ticketBusyId === `${tk.id}-ip` ? "…" : t(lang, "internalSupportInProgress")}
                        </button>
                        <button
                          type="button"
                          style={!canResolveSupport ? { display: "none" } : undefined}
                          disabled={!canResolveSupport || tk.status === "resolved" || ticketBusyId === `${tk.id}-rs`}
                          onClick={async () => {
                            setTicketBusyId(`${tk.id}-rs`);
                            const r = await updateSupportTicketStatus(tk.id, "resolved");
                            setTicketBusyId(null);
                            if (r.ok) void loadAll();
                          }}
                          className="rounded-xl bg-stone-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-stone-800 disabled:opacity-40"
                        >
                          {ticketBusyId === `${tk.id}-rs` ? "…" : t(lang, "internalSupportMarkResolved")}
                        </button>
                        <button
                          type="button"
                          style={!canResolveSupport ? { display: "none" } : undefined}
                          disabled={!canResolveSupport || ticketBusyId === `${tk.id}-del`}
                          onClick={async () => {
                            if (!window.confirm("Delete this support request?")) return;
                            setTicketBusyId(`${tk.id}-del`);
                            setDeleteMsg(null);
                            const r = await deleteSupportTicket(tk.id);
                            setTicketBusyId(null);
                            if (r.ok) void loadAll();
                            else setDeleteMsg(r.message ?? "Delete failed.");
                          }}
                          className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {ticketBusyId === `${tk.id}-del` ? "…" : "Delete"}
                        </button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
            </details>
          </section>
        </div>

        {/* Sidebar: map + insights */}
        <div className="space-y-8">
          <section id="ops-map" className="relative overflow-hidden rounded-3xl border border-orange-100 bg-gradient-to-b from-stone-900 to-stone-800 p-5 text-white shadow-xl sm:p-6 scroll-mt-4">
            <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(251,146,60,0.35), transparent 50%), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.08), transparent 45%)" }} />
            <div className="relative">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-orange-300" />
                    <h2 className="text-lg font-black">{t(lang, "internalMapTitle")}</h2>
                  </div>
                  <p className="mt-2 text-sm font-medium text-stone-300">{t(lang, "internalMapSub")}</p>
                  <p className="mt-2 text-xs font-bold text-orange-100/90">{t(lang, "internalMapLiveTitle")}</p>
                </div>
                <label className="flex min-w-[10rem] flex-col text-[11px] font-black uppercase tracking-wide text-orange-100/90">
                  {t(lang, "internalMapFilterDistrict")}
                  <select
                    value={mapDistrictId}
                    onChange={(e) => setMapDistrictId(e.target.value)}
                    className="mt-1 rounded-xl border border-white/20 bg-stone-950/60 px-3 py-2 text-sm font-bold text-white outline-none ring-orange-300/40 focus:ring-2"
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
              </div>
              <p className="mt-4 text-sm font-bold text-orange-50">
                {t(lang, "internalMapShopCount").replace("{{count}}", String(mapPins.length))}
              </p>
              {lovableUi ? (
                <div className="mt-4">
                  <LovableFieldMap pins={mapPins} />
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="mt-4 h-[min(22rem,55vh)] min-h-[220px] animate-pulse rounded-2xl bg-stone-800/80 ring-1 ring-white/10" />
                  }
                >
                  <InternalFieldOpsMap lang={lang} pins={mapPins} accessToken={mapboxAccessToken} />
                </Suspense>
              )}
            </div>
          </section>

          <section id="ops-charts" className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6 scroll-mt-4">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "internalInsightsTitle")}</h2>
            <div className="mt-5 space-y-6">
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
                <p className="mt-2 text-[11px] font-semibold text-stone-500">{t(lang, "internalChartSalesNote")}</p>
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "internalChartBizTypes")}</p>
                <ul className="mt-3 space-y-2">
                  {(bizTypes.length ? bizTypes : [{ type: "—", count: 0 }]).map((b) => (
                    <li key={b.type} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm">
                      <span className="font-semibold capitalize text-stone-800">
                        {(() => {
                          const k = `businessType_${b.type}`;
                          const lbl = t(lang, k);
                          return lbl === k ? b.type.replace(/_/g, " ") : lbl;
                        })()}
                      </span>
                      <span className="font-mono font-black text-orange-700">{b.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Top districts strip + visits */}
      <div id="ops-visits" className="grid gap-8 scroll-mt-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
          <h2 className="text-lg font-black text-stone-900">{t(lang, "internalStat_topDistricts")}</h2>
          <ul className="mt-4 space-y-2">
            {(stats?.shopsByDistrict?.length ? stats.shopsByDistrict : []).slice(0, 8).map((d) => (
              <li
                key={d.label}
                className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-orange-50/50 to-white px-4 py-3 ring-1 ring-orange-100/60"
              >
                <span className="font-bold text-stone-900">{d.label}</span>
                <span className="font-mono text-lg font-black text-orange-800">{d.count}</span>
              </li>
            ))}
            {!stats?.shopsByDistrict?.length && !opsLoading ? (
              <li className="rounded-2xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-500">{t(lang, "internalDistrictEmpty")}</li>
            ) : null}
          </ul>
        </section>

        <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
          <h2 className="text-lg font-black text-stone-900">{t(lang, "internalFieldVisitsTitle")}</h2>
          {visitMsg ? <p className="mt-2 text-sm font-bold text-rose-600">{visitMsg}</p> : null}
          <ul className="mt-4 space-y-3">
            {visits.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/80 px-4 py-8 text-center text-sm font-semibold text-stone-600">
                {t(lang, "internalVisitNoOpen")}
              </li>
            ) : (
              visits.map((v) => {
                const shop = v.shops;
                const lat = shop?.latitude ?? null;
                const lng = shop?.longitude ?? null;
                const canDir = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
                return (
                  <li key={v.id} className="rounded-2xl border border-stone-100 bg-stone-50/60 p-4 shadow-sm">
                    <p className="font-black text-stone-900">{shop?.name ?? v.shop_id}</p>
                    <p className="text-xs font-semibold text-stone-500">{[shop?.district, shop?.city].filter(Boolean).join(" · ") || "—"}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canDir ? (
                        <a
                          href={googleMapsDirectionsUrl(lat!, lng!)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center rounded-xl bg-orange-600 px-4 py-2 text-xs font-black text-white shadow-md hover:bg-orange-700"
                        >
                          {t(lang, "internalVisitDirections")}
                        </a>
                      ) : null}
                      <button
                        type="button"
                        disabled={visitBusyId === v.id}
                        className="inline-flex min-h-[44px] items-center rounded-xl border-2 border-stone-300 bg-white px-4 py-2 text-xs font-black text-stone-900 hover:bg-stone-50 disabled:opacity-50"
                        onClick={async () => {
                          setVisitMsg(null);
                          setVisitBusyId(v.id);
                          const r = await markFieldVisitCompleted(v.id);
                          setVisitBusyId(null);
                          if (!r.ok) setVisitMsg(r.message ?? t(lang, "internalVisitDoneError"));
                          else void loadAll();
                        }}
                      >
                        {visitBusyId === v.id ? "…" : t(lang, "internalVisitDone")}
                      </button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
