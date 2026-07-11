import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminShopDeviceSetActive,
  adminShopDeviceSetTrusted,
  adminShopResetSync,
} from "../../../../lib/wakaInternalAdmin";
import { internalAdminShopHref } from "../../../../lib/internalAdminPreview";
import { executeInternalAdminAction } from "../../../../lib/internalAdminActionRunner";
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
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "offline" | "risk">("all");

  const list = data.fleetDevices.filter((d) => {
    if (filter === "offline") return !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 15 * 60 * 1000;
    if (filter === "risk") return d.suspicious_flag || !d.trusted || d.pending_sync > 10;
    return true;
  });

  const runDeviceAction = async (deviceId: string, shopId: string, action: string) => {
    if (action !== "trust" && action !== "deactivate" && action !== "reset_sync") return;
    const actionName =
      action === "trust"
        ? "admin_device_trust"
        : action === "deactivate"
          ? "admin_device_deactivate"
          : "admin_force_sync";
    const fn = () => {
      if (action === "trust") return adminShopDeviceSetTrusted(deviceId, true);
      if (action === "deactivate") return adminShopDeviceSetActive(deviceId, false);
      return adminShopResetSync(shopId);
    };

    setBusyId(deviceId);
    await executeInternalAdminAction(
      {
        previewMode,
        previewBlockedMessage: "Preview mode — action blocked.",
        permitted: perms.canShopSupport,
        permissionDeniedMessage: "You do not have permission for device actions.",
        setBusy: () => {},
        onSuccess: () => setToast({ kind: "ok", text: "Device updated." }),
        onError: (msg) => setToast({ kind: "err", text: msg }),
        refresh: () => data.loadAll({ silent: true }),
        audit: { action: actionName, shopId, metadata: { deviceId } },
      },
      fn,
    );
    setBusyId(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-foreground">Devices</h1>
        <p className="text-sm text-muted-foreground">{list.length} devices · fleet diagnostics</p>
      </div>

      {toast ? (
        <p
          className={`rounded-xl px-3 py-2 text-sm font-bold ${
            toast.kind === "ok" ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"
          }`}
        >
          {toast.text}
        </p>
      ) : null}

      <AdminDeviceForensicsPanel previewMode={previewMode} />

      <AppVersionPanel versions={data.appVersions} />

      <div className="flex gap-2 overflow-x-auto">
        {(["all", "offline", "risk"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-black uppercase ${
              filter === f ? "bg-waka-600 text-white" : "bg-card ring-1 ring-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {data.opsLoading && !list.length ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />
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
              {busyId === d.id ? <p className="text-center text-xs font-bold text-muted-foreground">Updating…</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
