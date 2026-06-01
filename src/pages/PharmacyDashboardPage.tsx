import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { dateKeyKampala } from "../lib/datesUg";
import { formatUgxShort } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { computePharmacyDashboardStats, expiryBucketLabelKey } from "../lib/pharmacyStats";
import { formatMedicineFullLabel } from "../lib/pharmacyMedicine";
import { expiryTilePresentation } from "../lib/pharmacyExpiry";
import { ExpiryStatusBadge } from "../components/pharmacy/ExpiryStatusBadge";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { useShallow } from "zustand/react/shallow";

export function PharmacyDashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const sync = useSyncStatus();
  const sales = useDeferredReportingSales(false);
  const { preferences, products } = usePosStore(
    useShallow((s) => ({
      preferences: s.preferences,
      products: s.products,
    })),
  );

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const todayKey = dateKeyKampala(new Date());

  const canSell = hasEffectivePermission(actor.role, "pos.sell", snapshot, authMode);
  const canStock = hasEffectivePermission(actor.role, "stock.view", snapshot, authMode);
  const canReports = hasEffectivePermission(actor.role, "reports.view", snapshot, authMode);

  const stats = useMemo(
    () => computePharmacyDashboardStats(products, sales, todayKey),
    [products, sales, todayKey],
  );

  if (!pharmacy) return null;

  const expiryTiles = [
    { key: "d90" as const, count: stats.expiryCounts.d90 },
    { key: "d60" as const, count: stats.expiryCounts.d60 },
    { key: "d30" as const, count: stats.expiryCounts.d30 },
    { key: "expired" as const, count: stats.expiryCounts.expired },
  ];

  const tileStyles = (key: (typeof expiryTiles)[number]["key"]) => expiryTilePresentation(key);

  return (
    <div className="space-y-4">
      {!preferences.onboardingWizardDone && !preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-stone-950">{t(lang, "pharmacyDashTitle")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyDashSub")}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {canSell ? (
            <Link
              to="/pos"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-waka-600 px-5 py-3 text-base font-black text-white shadow-waka-sm"
            >
              {t(lang, "pharmacyDashGoDispense")}
            </Link>
          ) : null}
          {canStock ? (
            <Link
              to="/stock"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-black text-stone-800 shadow-sm"
            >
              {t(lang, "pharmacyDashGoStock")}
            </Link>
          ) : null}
          {canReports ? (
            <Link
              to="/office/reports"
              className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-base font-black text-teal-950 shadow-sm"
            >
              {t(lang, "pharmacyDashGoReports")}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="rounded-3xl border border-stone-200 bg-white p-3.5 shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "dashboardSyncTitle")}</p>
        <p className="mt-1 text-sm font-semibold text-stone-800">
          {sync.syncing
            ? t(lang, "syncingShort")
            : !sync.isOnline
              ? t(lang, "workingOfflineLabel")
              : sync.pendingCount > 0
                ? `${t(lang, "willSyncLater")} (${sync.pendingCount})`
                : t(lang, "allSavedShort")}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase text-amber-800">{t(lang, "pharmacyDashTodayDispensings")}</p>
          <p className="mt-1 text-3xl font-black text-amber-950">{stats.todayDispensingCount}</p>
          <p className="text-sm font-bold text-amber-900">{formatUgxShort(stats.todayDispensingTotalUgx)}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-black uppercase text-rose-800">{t(lang, "pharmacyDashLowStock")}</p>
          <p className="mt-1 text-3xl font-black text-rose-950">{stats.lowStockCount}</p>
        </div>
        {expiryTiles.map((tile) => {
          const styles = tileStyles(tile.key);
          return (
          <div
            key={tile.key}
            className={`rounded-2xl border p-4 ${styles.borderClass} ${styles.bgClass}`}
          >
            <p className={`text-xs font-black uppercase ${styles.labelClass}`}>
              {t(lang, expiryBucketLabelKey(tile.key))}
            </p>
            <p className={`mt-1 text-3xl font-black ${styles.valueClass}`}>
              {tile.count}
            </p>
          </div>
        );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashExpiring")}</h2>
          {stats.expiringSoon.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "pharmacyDashNoExpiring")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.expiringSoon.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-stone-900">{formatMedicineFullLabel(p)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ExpiryStatusBadge lang={lang} product={p} compact />
                    <span className="font-black text-orange-700">{p.expiryDate}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-red-200 bg-red-50/50 p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-red-950">{t(lang, "pharmacyDashExpired")}</h2>
          {stats.expiredMedicines.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-red-800/80">{t(lang, "pharmacyDashNoExpired")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.expiredMedicines.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-red-950">{formatMedicineFullLabel(p)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ExpiryStatusBadge lang={lang} product={p} compact />
                    <span className="font-black text-red-700">{p.expiryDate}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashLowStock")}</h2>
          {stats.lowStockMedicines.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "pharmacyDashNoLowStock")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.lowStockMedicines.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-stone-900">{p.name}</span>
                  <span className="shrink-0 font-bold text-rose-700">
                    {p.stockOnHand} {p.baseUnit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashTopMedicines")}</h2>
          {stats.topMedicines.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "pharmacyDashNoDispensings")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.topMedicines.map((m) => (
                <li key={m.productId || m.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-bold text-stone-900">{m.name}</span>
                  <span className="shrink-0 font-bold text-waka-800">{formatUgxShort(m.revenueUgx)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
