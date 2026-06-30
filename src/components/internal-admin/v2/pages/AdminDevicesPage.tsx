import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminShopDeviceSetActive,
  adminShopDeviceSetTrusted,
  adminShopResetSync,
} from "../../../../lib/wakaInternalAdmin";
import { internalAdminShopHref } from "../../../../lib/internalAdminPreview";
import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import { adminPermissions } from "../adminRoles";
import { AppVersionPanel, DeviceFleetCard } from "../ops/OpsWidgets";
import { EmptyState } from "../primitives";
import { AdminDeviceForensicsPanel } from "../../ops/AdminDeviceForensicsPanel";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminDevicesPage({ adminRow, previewMode }: Props) {
  const navigate = useNavigate();
  const perms = adminPermissions(adminRow);
  const data = useInternalOpsData(adminRow, previewMode, "devices");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "offline" | "risk">("all");

  const list = data.fleetDevices.filter((d) => {
    if (filter === "offline") return !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 15 * 60 * 1000;
    if (filter === "risk") return d.suspicious_flag || !d.trusted || d.pending_sync > 10;
    return true;
  });

  const runDeviceAction = async (deviceId: string, shopId: string, action: string) => {
    if (previewMode) return;
    setBusyId(deviceId);
    if (action === "trust") await adminShopDeviceSetTrusted(deviceId, true);
    if (action === "deactivate") await adminShopDeviceSetActive(deviceId, false);
    if (action === "reset_sync") await adminShopResetSync(shopId);
    setBusyId(null);
    void data.loadAll();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-stone-900">Devices</h1>
        <p className="text-sm text-stone-500">{list.length} devices · fleet diagnostics</p>
      </div>

      <AdminDeviceForensicsPanel previewMode={previewMode} />

      <AppVersionPanel versions={data.appVersions} />

      <div className="flex gap-2 overflow-x-auto">
        {(["all", "offline", "risk"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-black uppercase ${
              filter === f ? "bg-waka-600 text-white" : "bg-white ring-1 ring-stone-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {data.opsLoading && !list.length ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-200" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState>No devices match.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((d) => (
            <li key={d.id}>
              <DeviceFleetCard
                device={d}
                canManage={perms.canShopSupport && !previewMode}
                onOpenShop={() => navigate(internalAdminShopHref(d.shop_id, previewMode))}
                onAction={(action) => void runDeviceAction(d.id, d.shop_id, action)}
              />
              {busyId === d.id ? <p className="text-center text-xs font-bold text-stone-500">Updating…</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
