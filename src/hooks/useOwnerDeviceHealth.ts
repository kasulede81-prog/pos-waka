import { useEffect, useState } from "react";
import { useSubscription } from "../context/SubscriptionContext";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import { fetchOwnerShopDevices } from "../lib/shopDevices";
import { buildMultiDeviceHealthSnapshot } from "../lib/multiDeviceHealth";

export type OwnerDeviceHealth = {
  devicesOnline: number;
  devicesStale: number;
  loading: boolean;
};

export function useOwnerDeviceHealth(): OwnerDeviceHealth {
  const { userId, authMode } = useSubscription();
  const [devicesOnline, setDevicesOnline] = useState(0);
  const [devicesStale, setDevicesStale] = useState(0);
  const [loading, setLoading] = useState(authMode !== "local");

  useEffect(() => {
    if (!userId || authMode === "local") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const org = await resolvePrimaryOrganizationForUser(userId);
        if (!org?.shopId) return;
        const devices = await fetchOwnerShopDevices(org.shopId);
        const snap = await buildMultiDeviceHealthSnapshot(devices);
        if (!cancelled) {
          setDevicesOnline(snap.activeDevices);
          setDevicesStale(snap.staleDeviceCount);
        }
      } catch {
        /* offline / no shop */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [userId, authMode]);

  return { devicesOnline, devicesStale, loading };
}
