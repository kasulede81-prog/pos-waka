import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Building2,
  Calendar,
  CalendarClock,
  CreditCard,
  Headphones,
  MapPin,
  RefreshCw,
  Smartphone,
  Sparkles,
  Store,
  TrendingUp,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  fetchBusinessTypeSlices,
  fetchDistrictOpsTable,
  fetchFieldMapPins,
  fetchFieldVisitsOpen,
  fetchInternalDashboardStats,
  fetchInternalOpsCharts7d,
  fetchPendingSubscriptionRequests,
  internalOpsSetSubscriptionRequestStatus,
  fetchPlanTierMetrics,
  fetchRecentShops,
  fetchSalesVolumeBuckets7d,
  fetchShopSignupBuckets7d,
  fetchSubscriptionGrowthBuckets7d,
  fetchSupportTickets,
  googleMapsDirectionsUrl,
  internalOpsActivateAiStockAssistant,
  markFieldVisitCompleted,
  updateSupportTicketStatus,
  whatsappUrlFromPhone,
  type BusinessTypeSlice,
  type DayBucket,
  type DistrictOpsRow,
  type FieldMapPin,
  type FieldVisitRow,
  type InternalDashboardStats,
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

function StatHeroCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  sub?: string;
  gradient: string;
}) {
  return (
    <div
      className={clsx(
        "group relative overflow-hidden rounded-2xl border border-white/60 p-4 shadow-[0_8px_30px_rgb(28_25_23/0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgb(251_146_60/0.12)]",
        gradient,
      )}
    >
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/25 blur-2xl transition-opacity group-hover:opacity-90" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 text-orange-700 shadow-sm">
          <Icon className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <ArrowUpRight className="h-4 w-4 text-stone-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="relative mt-3 text-[11px] font-bold uppercase tracking-wider text-stone-500">{label}</p>
      <p className="relative mt-1 font-mono text-2xl font-black tracking-tight text-stone-900 sm:text-3xl">{value}</p>
      {sub ? <p className="relative mt-1 text-xs font-semibold text-stone-600">{sub}</p> : null}
    </div>
  );
}

function PlanPremiumCard({ lang, plan, tone }: { lang: Language; plan: PlanTierMetrics; tone: "slate" | "orange" | "gold" }) {
  const nameKey =
    plan.code === "starter" ? "planStarterName" : plan.code === "business" ? "planBusinessName" : "planWakaPlusName";
  const toneCls =
    tone === "slate"
      ? "from-slate-50 to-white border-slate-200/80"
      : tone === "orange"
        ? "from-orange-50/90 to-white border-orange-200/90"
        : "from-amber-50 to-orange-50/40 border-amber-200/80";
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 shadow-[0_10px_40px_rgb(28_25_23/0.06)] transition-transform duration-300 hover:-translate-y-0.5",
        toneCls,
      )}
    >
      <div className="absolute right-0 top-0 h-32 w-32 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-to-br from-orange-200/40 to-transparent blur-2xl" />
      <p className="text-xs font-black uppercase tracking-widest text-orange-800/80">{t(lang, "internalPlanLabel")}</p>
      <h3 className="mt-1 text-xl font-black text-stone-900">{t(lang, nameKey)}</h3>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-stone-100">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalPlanActiveShops")}</dt>
          <dd className="font-mono text-lg font-black text-stone-900">{plan.activeCount}</dd>
        </div>
        <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-stone-100">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalPlanTrials")}</dt>
          <dd className="font-mono text-lg font-black text-stone-900">{plan.trialCount}</dd>
        </div>
        <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-stone-100">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalPlanExpiring")}</dt>
          <dd className="font-mono text-lg font-black text-amber-900">{plan.expiringSoonCount}</dd>
        </div>
        <div className="rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-stone-100">
          <dt className="text-[10px] font-bold uppercase text-stone-500">{t(lang, "internalPlanMrrEst")}</dt>
          <dd className="font-mono text-lg font-black text-waka-800">UGX {plan.estimatedMonthlyRevenueUgx.toLocaleString("en-UG")}</dd>
        </div>
      </dl>
    </div>
  );
}

export function InternalOpsDashboard({ lang, email, adminRow, previewMode }: Props) {
  const { hour, dateStr } = useMemo(() => kampalaNowParts(), []);
  const displayName =
    adminRow?.full_name?.trim() ||
    (adminRow?.email ? adminRow.email.split("@")[0] : (email ?? "").split("@")[0]) ||
    "Team";
  const roleNorm = (adminRow?.role ?? "").toLowerCase();
  const canResolveSupport = roleNorm === "super_admin" || roleNorm === "support_admin" || roleNorm === "finance_admin";
  const canManageTrials =
    roleNorm === "super_admin" || roleNorm === "subscriptions_admin" || roleNorm === "finance_admin";

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
  const [aiActivateBusyOrg, setAiActivateBusyOrg] = useState<string | null>(null);
  const [annualBusyId, setAnnualBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
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

      const [p, r, tk, d, b, v, pins, pend] = await Promise.all([
        fetchPlanTierMetrics(),
        fetchRecentShops(18),
        fetchSupportTickets(80),
        fetchDistrictOpsTable(),
        fetchBusinessTypeSlices(),
        fetchFieldVisitsOpen(),
        fetchFieldMapPins({ districtId: mapDistrictId || null, limit: 400 }),
        fetchPendingSubscriptionRequests(40),
      ]);
      setPlans(p);
      setRecent(r);
      setTickets(tk);
      setDistricts(d);
      setBizTypes(b);
      setVisits(v);
      setMapPins(pins);
      setPendingTrials(pend);
    } finally {
      setOpsLoading(false);
    }
  }, [adminRow, mapDistrictId]);

  useEffect(() => {
    if (previewMode || !adminRow) return;
    void loadAll();
  }, [adminRow, previewMode, loadAll]);

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

  const pendingAiTickets = useMemo(
    () =>
      tickets.filter(
        (tk) =>
          tk.status === "pending" &&
          (tk.issue_type === "ai_stock_setup" || tk.issue_type === "ai_stock_trial_request"),
      ),
    [tickets],
  );

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
        pendingAi: "—",
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
      pendingAi: String(stats.pendingAiRequests ?? 0),
      pendingAnnual: String(stats.pendingAnnualRequests ?? 0),
    };
  }, [stats]);

  return (
    <div className="space-y-8 pb-12 pt-1">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-3xl border border-orange-100/80 bg-gradient-to-br from-white via-orange-50/40 to-white p-6 shadow-[0_20px_60px_rgb(251_146_60/0.12)] sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-orange-200/50 to-transparent blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-orange-900 ring-1 ring-orange-200/60">
              <Sparkles className="h-3.5 w-3.5 text-orange-600" />
              {t(lang, "internalDashOpsCenter")}
            </div>
            <h1 className="text-2xl font-black tracking-tight text-stone-900 sm:text-3xl">
              {t(lang, greetingKey(hour))}, {displayName}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-stone-600">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-orange-600" />
                {dateStr}
              </span>
              {adminRow ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                  {adminRow.role.replace(/_/g, " ")}
                </span>
              ) : previewMode ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-400 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-900">
                  {t(lang, "internalDashPreviewBadge")}
                </span>
              ) : null}
              {adminRow ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-black uppercase tracking-wide text-stone-700 ring-1 ring-stone-200/70">
                  {String(adminRow.assigned_district_ids?.length ?? 0)} {t(lang, "internalDashDistrictsBadge")}
                </span>
              ) : null}
            </p>
            <p className="max-w-xl text-sm leading-relaxed text-stone-600">{t(lang, "internalDashHeroSub")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={!adminRow || opsLoading}
              onClick={() => void loadAll()}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-stone-900 px-5 py-2.5 text-sm font-black text-white shadow-lg transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={clsx("h-4 w-4", opsLoading && "animate-spin")} />
              {t(lang, "internalDashQuickRefresh")}
            </button>
            <Link
              to="/support"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl border-2 border-orange-200 bg-white px-5 py-2.5 text-sm font-black text-orange-950 shadow-sm transition hover:bg-orange-50"
            >
              <Headphones className="h-4 w-4" />
              {t(lang, "internalDashQuickSupport")}
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-[48px] items-center rounded-2xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-bold text-stone-800 hover:bg-stone-50"
            >
              {t(lang, "internalAdminBack")}
            </Link>
          </div>
        </div>
      </header>

      {previewMode ? (
        <p className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-3 text-sm font-semibold text-amber-950 shadow-sm">
          {t(lang, "internalAdminDbGateHint")}
        </p>
      ) : null}
      {!previewMode && statsError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          {t(lang, "internalStatsError")}
          {statsErrorMessage ? (
            <span className="mt-1 block font-mono text-xs font-semibold text-rose-800">{statsErrorMessage}</span>
          ) : null}
        </p>
      ) : null}

      {/* Stats */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-2">
          <h2 className="text-lg font-black text-stone-900">{t(lang, "internalDashPulseTitle")}</h2>
          {opsLoading ? <span className="text-xs font-bold uppercase tracking-wide text-orange-600">{t(lang, "internalDashSyncing")}</span> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatHeroCard
            icon={Store}
            label={t(lang, "internalStat_totalShops")}
            value={statGrid.total}
            sub={t(lang, "internalDashStatSubShops")}
            gradient="bg-gradient-to-br from-white to-stone-50"
          />
          <StatHeroCard
            icon={Activity}
            label={t(lang, "internalStat_activeToday")}
            value={statGrid.active}
            sub={t(lang, "internalDashStatSubActive")}
            gradient="bg-gradient-to-br from-emerald-50/80 to-white"
          />
          <StatHeroCard
            icon={CreditCard}
            label={t(lang, "internalStat_paidSubs")}
            value={statGrid.paid}
            sub={t(lang, "internalDashStatSubPaid")}
            gradient="bg-gradient-to-br from-orange-50 to-white"
          />
          <StatHeroCard
            icon={Zap}
            label={t(lang, "internalStat_trialSubs")}
            value={statGrid.trial}
            sub={t(lang, "internalDashStatSubTrial")}
            gradient="bg-gradient-to-br from-amber-50/90 to-white"
          />
          <StatHeroCard
            icon={AlertTriangle}
            label={t(lang, "internalStat_endedTrials")}
            value={statGrid.endedTrials}
            sub={t(lang, "internalDashStatSubEndedTrials")}
            gradient="bg-gradient-to-br from-rose-50/60 to-white"
          />
          <StatHeroCard
            icon={Calendar}
            label={t(lang, "internalStat_expiringSoon")}
            value={statGrid.expiring}
            sub={t(lang, "internalDashStatSubExpiring")}
            gradient="bg-gradient-to-br from-orange-50/50 to-white"
          />
          <StatHeroCard
            icon={Smartphone}
            label={t(lang, "internalStat_devices")}
            value={statGrid.devices}
            sub={t(lang, "internalDashStatSubDevices")}
            gradient="bg-gradient-to-br from-sky-50/60 to-white"
          />
          <StatHeroCard
            icon={Headphones}
            label={t(lang, "internalStat_supportOpen")}
            value={statGrid.support}
            sub={t(lang, "internalDashStatSubSupport")}
            gradient="bg-gradient-to-br from-violet-50/70 to-white"
          />
          <StatHeroCard
            icon={TrendingUp}
            label={t(lang, "internalStat_salesShort")}
            value={statGrid.sales}
            sub={t(lang, "internalDashStatSubSales")}
            gradient="bg-gradient-to-br from-white to-orange-50/50"
          />
          <StatHeroCard
            icon={Ban}
            label={t(lang, "internalStat_suspendedShops")}
            value={statGrid.suspended}
            sub={t(lang, "internalDashStatSubSuspended")}
            gradient="bg-gradient-to-br from-stone-100 to-rose-50/40"
          />
          <StatHeroCard
            icon={Sparkles}
            label={t(lang, "internalStat_pendingAi")}
            value={statGrid.pendingAi}
            sub={t(lang, "internalDashStatSubPendingAi")}
            gradient="bg-gradient-to-br from-violet-50 to-white"
          />
          <StatHeroCard
            icon={CalendarClock}
            label={t(lang, "internalStat_pendingAnnual")}
            value={statGrid.pendingAnnual}
            sub={t(lang, "internalDashStatSubPendingAnnual")}
            gradient="bg-gradient-to-br from-amber-50 to-orange-50/60"
          />
        </div>
      </section>

      {stats?.latestSignups?.length ? (
        <section>
          <h2 className="mb-4 text-lg font-black text-stone-900">{t(lang, "internalLatestSignupsTitle")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.latestSignups.map((s) => (
              <li
                key={s.shop_id}
                className="rounded-2xl border border-orange-100 bg-gradient-to-br from-white to-orange-50/40 p-4 shadow-sm"
              >
                <Link to={`/internal/waka/shop/${s.shop_id}`} className="text-base font-black text-orange-950 underline decoration-orange-200">
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
        </section>
      ) : null}

      {/* Plans */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black text-stone-900">{t(lang, "internalPlansTitle")}</h2>
          <Building2 className="h-5 w-5 text-orange-400" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {opsLoading && !plans.length
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-52 animate-pulse rounded-3xl bg-stone-200/60" />
              ))
            : (plans.length ? plans : [{ code: "starter" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 }, { code: "business" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 }, { code: "waka_plus" as const, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 }]).map((plan, idx) => (
                <PlanPremiumCard key={plan.code} lang={lang} plan={plan} tone={idx === 0 ? "slate" : idx === 1 ? "orange" : "gold"} />
              ))}
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {/* Districts */}
          <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-black text-stone-900">{t(lang, "internalDistrictTitle")}</h2>
              <input
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                placeholder={t(lang, "internalDistrictSearch")}
                className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-900 outline-none ring-orange-200/50 focus:ring-2 sm:max-w-xs"
              />
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl ring-1 ring-stone-100">
              <table className="min-w-[640px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50/80 text-[11px] font-black uppercase tracking-wider text-stone-500">
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

          {/* Pending starter / plan trial requests */}
          <section className="rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50/50 to-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "internalPendingTrialsTitle")}</h2>
            <p className="mt-1 text-xs font-semibold text-stone-600">{t(lang, "internalPendingTrialsSub")}</p>
            <ul className="mt-4 space-y-3">
              {opsLoading && !pendingTrials.length ? (
                [...Array(3)].map((_, i) => (
                  <li key={i} className="h-16 animate-pulse rounded-2xl bg-amber-100/40" />
                ))
              ) : pendingTrials.length === 0 ? (
                <li className="rounded-2xl border border-dashed border-amber-200 bg-white/80 px-4 py-6 text-center text-sm font-semibold text-stone-600">
                  {t(lang, "internalPendingTrialsEmpty")}
                </li>
              ) : (
                pendingTrials.map((req) => (
                  <li
                    key={req.id}
                    className="flex flex-col gap-3 rounded-2xl border border-amber-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
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
                          to={`/internal/waka/shop/${req.shop_id}`}
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
                          if (r.ok) void loadAll();
                        }}
                        className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"
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
                        className="rounded-xl border-2 border-stone-300 bg-white px-4 py-2.5 text-xs font-black text-stone-900 disabled:opacity-40"
                      >
                        {trialBusyId === `${req.id}-no` ? "…" : t(lang, "internalTrialReject")}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="rounded-3xl border border-violet-200/80 bg-gradient-to-br from-violet-50/40 to-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "internalAiQueueTitle")}</h2>
            <p className="mt-1 text-xs font-semibold text-stone-600">{t(lang, "internalAiQueueSub")}</p>
            <ul className="mt-4 space-y-3">
              {opsLoading && !pendingAiTickets.length ? (
                [...Array(2)].map((_, i) => (
                  <li key={i} className="h-20 animate-pulse rounded-2xl bg-violet-100/30" />
                ))
              ) : pendingAiTickets.length === 0 ? (
                <li className="rounded-2xl border border-dashed border-violet-200 bg-white/80 px-4 py-6 text-center text-sm font-semibold text-stone-600">
                  {t(lang, "internalAiQueueEmpty")}
                </li>
              ) : (
                pendingAiTickets.map((tk) => (
                  <li
                    key={tk.id}
                    className="flex flex-col gap-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-black text-stone-900">{tk.shop_name ?? tk.subject ?? "—"}</p>
                      <p className="mt-1 text-xs font-semibold text-stone-500">
                        {tk.owner_email ?? "—"} · {tk.shop_phone_e164 ?? tk.contact_phone_e164 ?? "—"}
                      </p>
                      <p className="mt-1 text-[11px] font-bold uppercase text-violet-800">{tk.issue_type}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-stone-400">
                        {new Date(tk.created_at).toLocaleString("en-GB")}
                      </p>
                      {tk.shop_id ? (
                        <Link
                          to={`/internal/waka/shop/${tk.shop_id}`}
                          className="mt-2 inline-block text-xs font-black text-orange-800 underline"
                        >
                          {t(lang, "internalMapOpenShop")}
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        style={!canResolveSupport ? { display: "none" } : undefined}
                        disabled={!canResolveSupport || !tk.organization_id || aiActivateBusyOrg === tk.organization_id}
                        onClick={async () => {
                          if (!tk.organization_id) return;
                          setAiActivateBusyOrg(tk.organization_id);
                          const r = await internalOpsActivateAiStockAssistant(tk.organization_id, 14);
                          setAiActivateBusyOrg(null);
                          if (r.ok) void loadAll();
                        }}
                        className="rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"
                      >
                        {aiActivateBusyOrg === tk.organization_id ? "…" : t(lang, "internalAiQueueActivate")}
                      </button>
                      <button
                        type="button"
                        style={!canResolveSupport ? { display: "none" } : undefined}
                        disabled={!canResolveSupport || ticketBusyId === `${tk.id}-ai-rej`}
                        onClick={async () => {
                          setTicketBusyId(`${tk.id}-ai-rej`);
                          const r = await updateSupportTicketStatus(tk.id, "closed");
                          setTicketBusyId(null);
                          if (r.ok) void loadAll();
                        }}
                        className="rounded-xl border-2 border-stone-300 bg-white px-4 py-2.5 text-xs font-black text-stone-900 disabled:opacity-40"
                      >
                        {ticketBusyId === `${tk.id}-ai-rej` ? "…" : t(lang, "internalAiQueueReject")}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50/30 to-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "internalAnnualQueueTitle")}</h2>
            <p className="mt-1 text-xs font-semibold text-stone-600">{t(lang, "internalAnnualQueueSub")}</p>
            <ul className="mt-4 space-y-3">
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
                      <p className="mt-1 line-clamp-3 text-xs text-stone-600">{tk.body ?? tk.subject}</p>
                      <p className="mt-1 font-mono text-[11px] text-stone-400">{new Date(tk.created_at).toLocaleString("en-GB")}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
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
                        className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"
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
                        className="rounded-xl border-2 border-stone-300 bg-white px-4 py-2.5 text-xs font-black text-stone-900 disabled:opacity-40"
                      >
                        {annualBusyId === `${tk.id}-cl` ? "…" : t(lang, "internalAnnualQueueClose")}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* Recent shops */}
          <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "internalRecentTitle")}</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl ring-1 ring-stone-100">
              <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50/80 text-[11px] font-black uppercase tracking-wider text-stone-500">
                    <th className="px-4 py-3">{t(lang, "internalRecentColName")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColOwner")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColEmail")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColDistrict")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColType")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColPlan")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColJoined")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColGps")}</th>
                    <th className="px-4 py-3">{t(lang, "internalRecentColStatus")}</th>
                    <th className="px-4 py-3 text-right">{t(lang, "internalRecentColTrial")}</th>
                  </tr>
                </thead>
                <tbody>
                  {opsLoading && !recent.length ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i} className="border-b border-stone-50">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="h-4 animate-pulse rounded bg-stone-100" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    recent.map((row) => (
                      <tr key={row.id} className="border-b border-stone-50 transition hover:bg-orange-50/30">
                        <td className="px-4 py-3 font-bold text-stone-900">
                          <Link
                            to={`/internal/waka/shop/${row.id}`}
                            className="text-orange-900 underline decoration-orange-300 underline-offset-2 hover:text-orange-700"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="max-w-[120px] truncate px-4 py-3 text-stone-700" title={row.owner_label ?? undefined}>
                          {row.owner_label ?? "—"}
                        </td>
                        <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-stone-600" title={row.owner_email ?? undefined}>
                          {row.owner_email ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-stone-600">{[row.district, row.city].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="max-w-[100px] truncate px-4 py-3 text-xs font-semibold capitalize text-stone-700" title={row.business_type ?? undefined}>
                          {row.business_type
                            ? (() => {
                                const k = `businessType_${row.business_type}`;
                                const lbl = t(lang, k);
                                return lbl === k ? row.business_type.replace(/_/g, " ") : lbl;
                              })()
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-lg bg-stone-100 px-2 py-1 text-xs font-black uppercase text-stone-700">
                            {row.plan_code ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-600">
                          {row.created_at ? new Date(row.created_at).toLocaleDateString("en-GB") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              "rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
                              row.gps_missing === false ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950",
                            )}
                          >
                            {row.gps_missing === false ? t(lang, "internalGpsOk") : t(lang, "internalGpsMissing")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              "rounded-full px-2.5 py-1 text-xs font-black",
                              row.is_active ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700",
                            )}
                          >
                            {row.is_active ? t(lang, "internalStatusActive") : t(lang, "internalStatusInactive")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-stone-800">{row.trial_days_left ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Support */}
          <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-stone-900">{t(lang, "internalSupportTitle")}</h2>
              <Headphones className="h-5 w-5 text-violet-500" />
            </div>
            <p className="mt-1 text-xs font-semibold text-stone-500">{t(lang, "internalSupportSub")}</p>
            <ul className="mt-4 space-y-3">
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
                              to={`/internal/waka/shop/${tk.shop_id}`}
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
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        </div>

        {/* Sidebar: map + insights */}
        <div className="space-y-8">
          <section className="relative overflow-hidden rounded-3xl border border-orange-100 bg-gradient-to-b from-stone-900 to-stone-800 p-5 text-white shadow-xl sm:p-6">
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
              <Suspense
                fallback={
                  <div className="mt-4 h-[min(22rem,55vh)] min-h-[220px] animate-pulse rounded-2xl bg-stone-800/80 ring-1 ring-white/10" />
                }
              >
                <InternalFieldOpsMap lang={lang} pins={mapPins} accessToken={mapboxAccessToken} />
              </Suspense>
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-[0_12px_40px_rgb(28_25_23/0.04)] sm:p-6">
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
      <div className="grid gap-8 lg:grid-cols-2">
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
