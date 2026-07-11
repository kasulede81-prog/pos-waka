import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Package,
  Pill,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Shield,
  ShoppingCart,
  Truck,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Language, Product, ShiftRecord } from "../../../types";
import type { PharmacyComplianceDashboardStats } from "../../../lib/pharmacyComplianceStats";
import type { PharmacyPatientDashboardStats } from "../../../lib/pharmacyPatientDashboardStats";
import type { PharmacyPrescriptionDashboardStats } from "../../../lib/pharmacyPrescriptionStats";
import type { PharmacyDashboardStats } from "../../../lib/pharmacyStats";
import type { SyncStatusApi } from "../../../hooks/useSyncStatus";
import type { DashboardCenterContext } from "../../command-center/registry/dashboardWidgetTypes";
import { t, tTemplate } from "../../../lib/i18n";
import { formatUgx } from "../../../lib/formatUgx";
import { PHARMACY_DISPENSE_ROUTE } from "../../../lib/pharmacyNav";
import { HomeTrustBanner } from "../../trust/HomeTrustBanner";
import { PharmacyExpiredWriteOffPanel } from "../PharmacyExpiredWriteOffPanel";
import {
  formatPharmacyBusinessDate,
  formatShiftTimeLabel,
  formatSyncAgoLabel,
  greetingKeyForHour,
  presentCount,
  type ActivityTimelineItem,
} from "./pharmacyDashboardPresentation";

export type PharmacyOpsDashboardProps = {
  lang: Language;
  actorName: string;
  todayKey: string;
  dayClosed: boolean;
  activeShift: ShiftRecord | null;
  sync: SyncStatusApi;
  failedPrints: number;
  stats: PharmacyDashboardStats;
  rxStats: PharmacyPrescriptionDashboardStats;
  patientStats: PharmacyPatientDashboardStats;
  complianceStats: PharmacyComplianceDashboardStats;
  purchaseStats: { todayCount: number; pendingDeliveries: number };
  allergyAlertCount: number;
  activityItems: ActivityTimelineItem[];
  products: Product[];
  canSell: boolean;
  canStock: boolean;
  canReports: boolean;
  canPurchases: boolean;
  canPatients: boolean;
  canReceipts: boolean;
  canWriteOff: boolean;
  canProfit: boolean;
  showRevenue: boolean;
  showActivityFeed: boolean;
};

const PANEL =
  "rounded-[22px] border border-border/90 bg-card shadow-[0_2px_16px_rgba(15,23,42,0.05)]";
const SECTION_TITLE = "text-xl font-black tracking-tight text-foreground sm:text-[1.35rem]";

type WorkflowCardProps = {
  title: string;
  presentation: ReturnType<typeof presentCount>;
  to: string;
  actionLabel: string;
  Icon: LucideIcon;
  tone: "sky" | "amber" | "emerald" | "violet" | "rose";
};

const WORKFLOW_TONES = {
  sky: {
    wrap: "border-sky-200/90 bg-gradient-to-br from-sky-50 to-card",
    icon: "bg-sky-100 text-sky-700",
    metric: "text-sky-950",
    sub: "text-sky-800/80",
    link: "text-sky-800 hover:text-sky-950",
  },
  amber: {
    wrap: "border-amber-200/90 bg-gradient-to-br from-amber-50 to-card",
    icon: "bg-amber-100 text-amber-800",
    metric: "text-amber-950",
    sub: "text-amber-900/75",
    link: "text-amber-900 hover:text-amber-950",
  },
  emerald: {
    wrap: "border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-card",
    icon: "bg-emerald-100 text-emerald-700",
    metric: "text-emerald-950",
    sub: "text-emerald-900/75",
    link: "text-emerald-900 hover:text-emerald-950",
  },
  violet: {
    wrap: "border-violet-200/90 bg-gradient-to-br from-violet-50 to-card",
    icon: "bg-violet-100 text-violet-700",
    metric: "text-violet-950",
    sub: "text-violet-900/75",
    link: "text-violet-800 hover:text-violet-950",
  },
  rose: {
    wrap: "border-rose-200/90 bg-gradient-to-br from-rose-50 to-card",
    icon: "bg-rose-100 text-rose-700",
    metric: "text-rose-950",
    sub: "text-rose-900/75",
    link: "text-rose-800 hover:text-rose-950",
  },
} as const;

const WorkflowCard = memo(function WorkflowCard({
  title,
  presentation,
  to,
  actionLabel,
  Icon,
  tone,
}: WorkflowCardProps) {
  const styles = WORKFLOW_TONES[tone];
  return (
    <Link
      to={to}
      className={clsx(
        "group flex min-h-[148px] min-w-[min(100%,14rem)] flex-col justify-between rounded-[22px] border p-5 transition-waka hover:shadow-[0_8px_28px_rgba(15,23,42,0.08)] active:scale-[0.99] motion-reduce:active:scale-100 sm:min-h-[156px] sm:p-6",
        styles.wrap,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-black leading-snug text-foreground sm:text-lg">{title}</p>
        <span className={clsx("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", styles.icon)}>
          <Icon className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </span>
      </div>
      <div className="mt-4">
        <p
          className={clsx(
            "font-black leading-none tracking-tight",
            presentation.isEmpty ? "text-lg sm:text-xl" : "text-4xl sm:text-[2.65rem]",
            styles.metric,
          )}
        >
          {presentation.primary}
        </p>
        <p className={clsx("mt-1.5 text-sm font-semibold", styles.sub)}>{presentation.secondary}</p>
        <p className={clsx("mt-3 inline-flex min-h-[48px] items-center gap-1 text-sm font-black", styles.link)}>
          {actionLabel}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </p>
      </div>
    </Link>
  );
});

function AlertRow({
  icon: Icon,
  label,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-800"
      : tone === "warn"
        ? "text-amber-900"
        : "text-foreground";
  const iconClass =
    tone === "danger" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-teal-600";
  return (
    <li className={clsx("flex min-h-[48px] items-center gap-3 text-sm font-bold", toneClass)}>
      <Icon className={clsx("h-5 w-5 shrink-0", iconClass)} aria-hidden />
      <span>{label}</span>
    </li>
  );
}

function PerformanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-black text-foreground">{value}</span>
    </div>
  );
}

const TAG_TONES: Record<ActivityTimelineItem["tagTone"], string> = {
  teal: "bg-teal-100 text-teal-900",
  blue: "bg-sky-100 text-sky-900",
  amber: "bg-amber-100 text-amber-950",
  rose: "bg-rose-100 text-rose-900",
  violet: "bg-violet-100 text-violet-900",
  stone: "bg-muted text-foreground",
};

function usePharmacyDerived(ctx: DashboardCenterContext) {
  const lang = ctx.lang;
  const stats = ctx.stats!;
  const rxStats = ctx.rxStats!;
  const patientStats = ctx.patientStats!;
  const complianceStats = ctx.complianceStats!;
  const purchaseStats = ctx.purchaseStats!;
  const canSell = ctx.canSell ?? false;

  const expireThisWeek = stats.expiryCounts.d30;
  const grossMarginPct =
    ctx.showRevenue && stats.todayDispensingTotalUgx > 0
      ? Math.round((stats.todayProfitUgx / stats.todayDispensingTotalUgx) * 100)
      : null;

  const workflowCards: WorkflowCardProps[] = canSell
    ? [
        {
          title: t(lang, "pharmacyDashRxWaiting"),
          presentation: presentCount(
            lang,
            rxStats.waitingVerification,
            "pharmacyDashUnitPrescriptions",
            "pharmacyDashNoRxWaiting",
            "pharmacyDashAllVerified",
          ),
          to: PHARMACY_DISPENSE_ROUTE,
          actionLabel: t(lang, "pharmacyDashViewQueue"),
          Icon: ClipboardList,
          tone: "sky",
        },
        {
          title: t(lang, "pharmacyDashRxReady"),
          presentation: presentCount(
            lang,
            rxStats.readyToDispense,
            "pharmacyDashUnitPrescriptions",
            "pharmacyDashNoRxReady",
            "pharmacyDashQueueClear",
          ),
          to: PHARMACY_DISPENSE_ROUTE,
          actionLabel: t(lang, "pharmacyDashViewQueue"),
          Icon: Pill,
          tone: "amber",
        },
        {
          title: t(lang, "pharmacyDashRxDispensedToday"),
          presentation: presentCount(
            lang,
            rxStats.dispensedToday,
            "pharmacyDashUnitPrescriptions",
            "pharmacyDashNoDispensedYet",
            "pharmacyDashStartDispensing",
          ),
          to: PHARMACY_DISPENSE_ROUTE,
          actionLabel: t(lang, "pharmacyDashViewDetails"),
          Icon: CheckCircle2,
          tone: "emerald",
        },
        {
          title: t(lang, "pharmacyDashRxRefillsDue"),
          presentation: presentCount(
            lang,
            rxStats.refillsDue,
            "pharmacyDashUnitPatients",
            "pharmacyDashNoRefillsDue",
            "pharmacyDashRefillsOnTrack",
          ),
          to: "/pharmacy/patients",
          actionLabel: t(lang, "pharmacyDashViewRefills"),
          Icon: RefreshCw,
          tone: "violet",
        },
        {
          title: t(lang, "pharmacyDashRxControlledToday"),
          presentation: presentCount(
            lang,
            rxStats.controlledToday,
            "pharmacyDashUnitDispensed",
            "pharmacyDashNoControlledToday",
            "pharmacyDashControlledClear",
          ),
          to: "/pharmacy/compliance/register",
          actionLabel: t(lang, "pharmacyDashViewRegister"),
          Icon: Shield,
          tone: "rose",
        },
      ]
    : [];

  const quickActions = [
    canSell ? { to: PHARMACY_DISPENSE_ROUTE, labelKey: "pharmacyDashNewPrescription", Icon: Plus } : null,
    ctx.canPatients ? { to: "/pharmacy/patients", labelKey: "pharmacyDashAddPatient", Icon: UserPlus } : null,
    ctx.canPurchases
      ? { to: "/pharmacy/inventory?tab=purchases&new=1", labelKey: "pharmacyQuickReceiveStock", Icon: Truck }
      : null,
    ctx.canWriteOff && stats.expiryCounts.expired > 0
      ? { to: "#pharmacy-write-off", labelKey: "pharmacyWriteOffCta", Icon: AlertTriangle }
      : null,
    ctx.canReports ? { to: "/pharmacy/compliance/register", labelKey: "pharmacyDashOpenRegister", Icon: Shield } : null,
    canSell ? { to: PHARMACY_DISPENSE_ROUTE, labelKey: "pharmacyDashCloseShift", Icon: Clock } : null,
  ].filter(Boolean) as { to: string; labelKey: string; Icon: LucideIcon }[];

  return {
    workflowCards,
    quickActions,
    expireThisWeek,
    grossMarginPct,
    rxStats,
    patientStats,
    complianceStats,
    purchaseStats,
    stats,
  };
}

export function PharmacyOpsHeaderSection({ ctx }: { ctx: DashboardCenterContext }) {
  const firstName = (ctx.actorName ?? "").trim().split(/\s+/)[0] || ctx.actorName || "";
  const greetingKey = useMemo(() => greetingKeyForHour(new Date().getHours()), []);

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-black leading-tight tracking-tight text-foreground sm:text-[2rem] lg:text-[2.35rem]">
          {t(ctx.lang, greetingKey).replace("{name}", firstName)} 👋
        </h1>
        <p className="mt-1 max-w-2xl text-base font-medium text-muted-foreground sm:text-lg">
          {t(ctx.lang, "pharmacyDashGreetingSub")}
        </p>
      </div>
      <div className="flex flex-wrap items-stretch gap-2 lg:max-w-md lg:justify-end">
        <div className={clsx(PANEL, "min-h-[48px] px-4 py-3")}>
          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(ctx.lang, "pharmacyDashBusinessDate")}</p>
          <p className="mt-0.5 text-sm font-black text-foreground">{formatPharmacyBusinessDate(ctx.todayKey ?? "")}</p>
        </div>
        <div className={clsx(PANEL, "min-h-[48px] px-4 py-3")}>
          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(ctx.lang, "pharmacyDashShiftLabel")}</p>
          <p className="mt-0.5 text-sm font-black text-foreground">
            {ctx.activeShift ? formatShiftTimeLabel(ctx.activeShift.startAt) : t(ctx.lang, "shiftClosed")}
          </p>
        </div>
        <div className={clsx(PANEL, "min-h-[48px] px-4 py-3")}>
          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(ctx.lang, "pharmacyDashPharmacist")}</p>
          <p className="mt-0.5 truncate text-sm font-black text-foreground">{ctx.actorName}</p>
        </div>
      </div>
    </header>
  );
}

export function PharmacyOpsStatusStripSection({ ctx }: { ctx: DashboardCenterContext }) {
  const sync = ctx.sync!;
  const syncAgo = formatSyncAgoLabel(ctx.lang, sync.health.lastSuccessAt ?? sync.health.lastPushAt);

  return (
    <section className="flex flex-wrap items-center gap-2">
      <span
        className={clsx(
          "inline-flex min-h-[40px] items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black",
          ctx.dayClosed ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-900",
        )}
      >
        <span className={clsx("h-2 w-2 rounded-full", ctx.dayClosed ? "bg-amber-600" : "bg-emerald-600")} aria-hidden />
        {ctx.dayClosed ? t(ctx.lang, "pharmacyOpsDayClosed") : t(ctx.lang, "pharmacyOpsPharmacyOpen")}
      </span>
      <span
        className={clsx(
          "inline-flex min-h-[40px] items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black",
          sync.isOnline ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950",
        )}
      >
        {sync.isOnline ? <Wifi className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
        {sync.isOnline ? t(ctx.lang, "hospitalityOpsOnline") : t(ctx.lang, "hospitalityOpsOffline")}
      </span>
      <span
        className={clsx(
          "inline-flex min-h-[40px] items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black",
          (ctx.failedPrints ?? 0) > 0 ? "bg-rose-100 text-rose-900" : "bg-muted text-foreground",
        )}
      >
        <Printer className="h-3.5 w-3.5" aria-hidden />
        {(ctx.failedPrints ?? 0) > 0
          ? tTemplate(ctx.lang, "hospitalityOpsPrinterFailed", { count: ctx.failedPrints ?? 0 })
          : t(ctx.lang, "hospitalityOpsPrinterReady")}
      </span>
      <span
        className={clsx(
          "inline-flex min-h-[40px] items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black",
          ctx.activeShift ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-950",
        )}
      >
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {ctx.activeShift ? t(ctx.lang, "pharmacyOpsShiftOpen") : t(ctx.lang, "pharmacyOpsShiftClosed")}
      </span>
      <span className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-teal-100 px-3.5 py-2 text-xs font-black text-teal-900">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        {t(ctx.lang, "pharmacyOpsLastSync")}: {syncAgo}
      </span>
    </section>
  );
}

export function PharmacyOpsTrustBannerSection({ ctx }: { ctx: DashboardCenterContext }) {
  return <HomeTrustBanner lang={ctx.lang} />;
}

export function PharmacyOpsWorkflowSection({ ctx }: { ctx: DashboardCenterContext }) {
  const { workflowCards } = usePharmacyDerived(ctx);
  if (!ctx.canSell || workflowCards.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashWorkflowTitle")}</h2>
        <Link
          to={PHARMACY_DISPENSE_ROUTE}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-waka-600 px-5 py-3 text-sm font-black text-white shadow-[0_6px_20px_rgba(249,115,22,0.28)] transition-waka hover:bg-waka-700 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t(ctx.lang, "pharmacyDashNewPrescription")}
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {workflowCards.map((card) => (
          <WorkflowCard key={card.title} {...card} />
        ))}
      </div>
    </section>
  );
}

export function PharmacyOpsInventoryAlertsSection({ ctx }: { ctx: DashboardCenterContext }) {
  const { stats, expireThisWeek } = usePharmacyDerived(ctx);
  if (!ctx.canStock) return null;

  return (
    <section className={clsx(PANEL, "p-5 sm:p-6")}>
      <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashInventoryAlertsTitle")}</h2>
      <ul className="mt-4 space-y-1">
        <AlertRow
          icon={Package}
          label={
            stats.lowStockCount > 0
              ? tTemplate(ctx.lang, "pharmacyDashLowStockCount", { count: String(stats.lowStockCount) })
              : t(ctx.lang, "pharmacyDashNoLowStock")
          }
          tone={stats.lowStockCount > 0 ? "warn" : "default"}
        />
        <AlertRow
          icon={CalendarClock}
          label={
            expireThisWeek > 0
              ? tTemplate(ctx.lang, "pharmacyDashExpireThisWeek", { count: String(expireThisWeek) })
              : t(ctx.lang, "pharmacyDashNoExpireThisWeek")
          }
          tone={expireThisWeek > 0 ? "warn" : "default"}
        />
        <AlertRow
          icon={AlertTriangle}
          label={
            stats.expiryCounts.expired > 0
              ? tTemplate(ctx.lang, "pharmacyAlertExpired", { count: String(stats.expiryCounts.expired) })
              : t(ctx.lang, "pharmacyDashNoExpired")
          }
          tone={stats.expiryCounts.expired > 0 ? "danger" : "default"}
        />
      </ul>
      <Link
        to="/pharmacy/expiry"
        className="mt-4 inline-flex min-h-[48px] items-center gap-1 text-sm font-black text-teal-800 hover:text-teal-950"
      >
        {t(ctx.lang, "pharmacyDashOpenExpiryCenter")}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}

export function PharmacyOpsPatientsSection({ ctx }: { ctx: DashboardCenterContext }) {
  const { patientStats } = usePharmacyDerived(ctx);
  if (!ctx.canPatients) return null;

  return (
    <section className={clsx(PANEL, "p-5 sm:p-6")}>
      <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashPatientsGlanceTitle")}</h2>
      <ul className="mt-4 space-y-1">
        <AlertRow
          icon={Users}
          label={
            patientStats.patientsWaiting > 0
              ? tTemplate(ctx.lang, "pharmacyDashPatientsWaitingCount", { count: String(patientStats.patientsWaiting) })
              : t(ctx.lang, "pharmacyDashNoPatientsWaiting")
          }
        />
        <AlertRow
          icon={RefreshCw}
          label={
            patientStats.refillsDue > 0
              ? tTemplate(ctx.lang, "pharmacyDashRefillsDueCount", { count: String(patientStats.refillsDue) })
              : t(ctx.lang, "pharmacyDashNoRefillsDue")
          }
        />
        <AlertRow
          icon={AlertTriangle}
          label={
            (ctx.allergyAlertCount ?? 0) > 0
              ? tTemplate(ctx.lang, "pharmacyDashAllergyAlertsCount", { count: String(ctx.allergyAlertCount) })
              : t(ctx.lang, "pharmacyDashNoAllergyAlerts")
          }
          tone={(ctx.allergyAlertCount ?? 0) > 0 ? "danger" : "default"}
        />
      </ul>
      {patientStats.topChronicPatients.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{t(ctx.lang, "pharmacyDashTopChronic")}</p>
          <ul className="mt-2 space-y-1.5">
            {patientStats.topChronicPatients.slice(0, 3).map((p) => (
              <li key={p.patientId} className="flex justify-between gap-2 text-sm font-bold text-foreground">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">{p.chronicCount}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Link
        to="/pharmacy/patients"
        className="mt-4 inline-flex min-h-[48px] items-center gap-1 text-sm font-black text-teal-800 hover:text-teal-950"
      >
        {t(ctx.lang, "pharmacyDashManagePatients")}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}

export function PharmacyOpsPerformanceSection({ ctx }: { ctx: DashboardCenterContext }) {
  const { stats, rxStats, grossMarginPct } = usePharmacyDerived(ctx);
  if (!ctx.showRevenue && !ctx.canProfit) return null;

  return (
    <section className={clsx(PANEL, "p-5 sm:p-6")}>
      <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashPerformanceTitle")}</h2>
      <div className="mt-3">
        {ctx.showRevenue ? (
          <PerformanceRow label={t(ctx.lang, "pharmacyDashTodayRevenue")} value={formatUgx(stats.todayDispensingTotalUgx)} />
        ) : null}
        {ctx.canProfit ? (
          <PerformanceRow label={t(ctx.lang, "pharmacyDashTodayProfit")} value={formatUgx(stats.todayProfitUgx)} />
        ) : null}
        {ctx.canSell ? (
          <PerformanceRow
            label={t(ctx.lang, "pharmacyDashPrescriptionsDispensed")}
            value={String(rxStats.dispensedToday)}
          />
        ) : null}
        {ctx.canSell ? (
          <PerformanceRow
            label={t(ctx.lang, "pharmacyDashRxAvgDispense")}
            value={
              rxStats.avgDispenseMinutes != null
                ? tTemplate(ctx.lang, "pharmacyDashRxAvgDispenseMin", { minutes: String(rxStats.avgDispenseMinutes) })
                : "—"
            }
          />
        ) : null}
        {ctx.canProfit && grossMarginPct != null ? (
          <PerformanceRow label={t(ctx.lang, "pharmacyDashGrossMargin")} value={`${grossMarginPct}%`} />
        ) : null}
      </div>
      {ctx.canReports ? (
        <Link
          to="/pharmacy/reports"
          className="mt-4 inline-flex min-h-[48px] items-center gap-1 text-sm font-black text-teal-800 hover:text-teal-950"
        >
          {t(ctx.lang, "pharmacyDashViewFullReport")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}

export function PharmacyOpsActivitySection({ ctx }: { ctx: DashboardCenterContext }) {
  const activityItems = ctx.activityItems ?? [];
  if (!ctx.showActivityFeed) return null;

  return (
    <section className={clsx(PANEL, "p-5 sm:p-6 xl:col-span-2")}>
      <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashRecentActivity")}</h2>
      {activityItems.length === 0 ? (
        <p className="mt-4 text-sm font-medium text-muted-foreground">{t(ctx.lang, "pharmacyDashNoActivity")}</p>
      ) : (
        <ol className="relative mt-5 space-y-0">
          {activityItems.map((item, idx) => (
            <li key={item.id} className="relative flex gap-4 pb-6 last:pb-0">
              {idx < activityItems.length - 1 ? (
                <span className="absolute left-[1.15rem] top-10 h-[calc(100%-1.5rem)] w-px bg-muted" aria-hidden />
              ) : null}
              <div className="relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white bg-muted text-xs font-black text-muted-foreground shadow-sm">
                {item.timeLabel.replace(/\s/g, "").slice(0, 5)}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-black text-foreground">{item.title}</p>
                  <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide", TAG_TONES[item.tagTone])}>
                    {t(ctx.lang, item.tagKey)}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">{item.subtitle}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function PharmacyOpsUpcomingSection({ ctx }: { ctx: DashboardCenterContext }) {
  const { rxStats, complianceStats, purchaseStats } = usePharmacyDerived(ctx);

  return (
    <section className={clsx(PANEL, "p-5 sm:p-6")}>
      <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashUpcomingTitle")}</h2>
      <ul className="mt-4 space-y-1">
        <AlertRow
          icon={Truck}
          label={
            purchaseStats.pendingDeliveries > 0
              ? tTemplate(ctx.lang, "pharmacyDashPendingDeliveries", { count: String(purchaseStats.pendingDeliveries) })
              : t(ctx.lang, "pharmacyDashNoPendingDeliveries")
          }
        />
        <AlertRow
          icon={ShoppingCart}
          label={
            purchaseStats.todayCount > 0
              ? tTemplate(ctx.lang, "pharmacyDashPurchasesToday", { count: String(purchaseStats.todayCount) })
              : t(ctx.lang, "pharmacyDashNoPurchasesToday")
          }
        />
        {ctx.canSell ? (
          <AlertRow
            icon={ClipboardList}
            label={
              rxStats.waitingVerification > 0
                ? tTemplate(ctx.lang, "pharmacyDashRxAwaitingVerification", {
                    count: String(rxStats.waitingVerification),
                  })
                : t(ctx.lang, "pharmacyDashNoRxAwaitingVerification")
            }
          />
        ) : null}
        {ctx.canReports ? (
          <AlertRow
            icon={Shield}
            label={
              complianceStats.regulatoryAlerts > 0
                ? tTemplate(ctx.lang, "pharmacyDashComplianceAlertsCount", {
                    count: String(complianceStats.regulatoryAlerts),
                  })
                : t(ctx.lang, "pharmacyDashNoComplianceAlerts")
            }
            tone={complianceStats.regulatoryAlerts > 0 ? "warn" : "default"}
          />
        ) : null}
        {ctx.canReceipts ? (
          <AlertRow icon={RotateCcw} label={t(ctx.lang, "pharmacyDashControlledReturnsHint")} />
        ) : null}
      </ul>
    </section>
  );
}

export function PharmacyOpsQuickActionsSection({ ctx }: { ctx: DashboardCenterContext }) {
  const { quickActions } = usePharmacyDerived(ctx);
  if (quickActions.length === 0) return null;

  return (
    <section className={clsx(PANEL, "p-5 sm:p-6")}>
      <h2 className={SECTION_TITLE}>{t(ctx.lang, "pharmacyDashQuickActionsTitle")}</h2>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {quickActions.map((action) =>
          action.to.startsWith("#") ? (
            <a
              key={action.labelKey}
              href={action.to}
              className="inline-flex min-h-[52px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-muted px-2 py-3 text-center text-xs font-black text-foreground transition-waka hover:border-teal-200 hover:bg-teal-50/60"
            >
              <action.Icon className="h-5 w-5 text-teal-700" aria-hidden />
              {t(ctx.lang, action.labelKey)}
            </a>
          ) : (
            <Link
              key={action.labelKey}
              to={action.to}
              className="inline-flex min-h-[52px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-muted px-2 py-3 text-center text-xs font-black text-foreground transition-waka hover:border-teal-200 hover:bg-teal-50/60"
            >
              <action.Icon className="h-5 w-5 text-teal-700" aria-hidden />
              {t(ctx.lang, action.labelKey)}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}

export function PharmacyOpsWriteOffSection({ ctx }: { ctx: DashboardCenterContext }) {
  return (
    <div id="pharmacy-write-off">
      <PharmacyExpiredWriteOffPanel lang={ctx.lang} products={ctx.products ?? []} canWriteOff={ctx.canWriteOff ?? false} />
    </div>
  );
}

export function PharmacyOpsFooterSection({ ctx }: { ctx: DashboardCenterContext }) {
  const sync = ctx.sync;
  return (
    <>
      <p className="rounded-2xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-center text-sm font-semibold text-sky-950">
        {t(ctx.lang, "pharmacyDashTip")}
      </p>
      {sync && !sync.isOnline ? (
        <p className="text-center text-xs font-semibold text-muted-foreground">{t(ctx.lang, "pharmacyDashOfflineNote")}</p>
      ) : null}
    </>
  );
}
