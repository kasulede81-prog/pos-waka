import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { buildMultiDeviceHealthSnapshot, type MultiDeviceHealthSnapshot } from "../../lib/multiDeviceHealth";
import { fetchOwnerShopDevices } from "../../lib/shopDevices";
import { resolvePrimaryOrganizationForUser } from "../../lib/fetchShopSubscription";
import { useSubscription } from "../../context/SubscriptionContext";
import { Link } from "react-router-dom";

export function MultiDeviceHealthCard({ lang }: { lang: Language }) {
  const { userId, authMode } = useSubscription();
  const [snapshot, setSnapshot] = useState<MultiDeviceHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || authMode === "local") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const org = await resolvePrimaryOrganizationForUser(userId);
        if (!org?.shopId) {
          if (!cancelled) setSnapshot(null);
          return;
        }
        const devices = await fetchOwnerShopDevices(org.shopId);
        const snap = await buildMultiDeviceHealthSnapshot(devices);
        if (!cancelled) setSnapshot(snap);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t(lang, "multiDeviceHealthLoadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, authMode, lang]);

  if (authMode === "local") {
    return (
      <p className="text-sm font-medium text-stone-500">{t(lang, "multiDeviceHealthLocalOnly")}</p>
    );
  }

  if (loading) {
    return <p className="text-sm font-medium text-stone-500">{t(lang, "multiDeviceHealthLoading")}</p>;
  }

  if (error) {
    return <p className="text-sm font-bold text-red-800">{error}</p>;
  }

  if (!snapshot) {
    return <p className="text-sm font-medium text-stone-500">{t(lang, "multiDeviceHealthNoShop")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <p className="text-xs font-bold text-stone-500">{t(lang, "multiDeviceHealthActiveDevices")}</p>
          <p className="text-lg font-black text-stone-900">{snapshot.activeDevices}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <p className="text-xs font-bold text-stone-500">{t(lang, "multiDeviceHealthPendingUploads")}</p>
          <p className="text-lg font-black text-stone-900">{snapshot.pendingQueueOps}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <p className="text-xs font-bold text-stone-500">{t(lang, "multiDeviceHealthConflicts")}</p>
          <p className="text-lg font-black text-stone-900">{snapshot.unacknowledgedConflicts}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
          <p className="text-xs font-bold text-stone-500">{t(lang, "multiDeviceHealthStaleDevices")}</p>
          <p className="text-lg font-black text-stone-900">{snapshot.staleDeviceCount}</p>
        </div>
      </div>
      <p className="text-xs font-medium text-stone-500">
        {t(lang, "multiDeviceHealthLastSalesSync")}: {snapshot.lastSalesSyncAt ?? t(lang, "multiDeviceHealthNever")}
      </p>
      <p className="text-xs font-medium text-stone-500">
        {t(lang, "multiDeviceHealthLastProductsSync")}: {snapshot.lastProductsSyncAt ?? t(lang, "multiDeviceHealthNever")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/settings/devices"
          className="inline-flex min-h-[40px] items-center rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold text-stone-800"
        >
          {t(lang, "multiDeviceHealthDevicesLink")}
        </Link>
        <Link
          to="/settings/sync-conflicts"
          className="inline-flex min-h-[40px] items-center rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold text-stone-800"
        >
          {t(lang, "multiDeviceHealthConflictsLink")}
        </Link>
      </div>
    </div>
  );
}
