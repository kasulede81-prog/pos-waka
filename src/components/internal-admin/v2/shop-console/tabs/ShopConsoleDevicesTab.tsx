import { useEffect } from "react";
import {
  RescueActionButton,
} from "../../../rescue/RescuePrimitives";
import {
  adminShopDeviceSetActive,
  adminShopDeviceSetTrusted,
  adminShopForceLogoutDevices,
  adminShopResetSync,
  type ShopDeviceRow,
} from "../../../../../lib/wakaInternalAdmin";
import { filterActiveRescueDevices, isRescueDeviceOnline } from "../../../../../lib/rescueDeviceList";
import { t } from "../../../../../lib/i18n";
import { runShopConsoleRescueAction } from "../rescueRun";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB");
}

export function ShopConsoleDevicesTab({ ctx }: Props) {
  const { lang, detail, canSupport, busy, executeAction, loadRescueData, loadShop, rescue, setRescueField } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  if (!detail) return null;

  const registered = detail.devices.length;
  const active = filterActiveRescueDevices(detail.devices);
  const showAllDevices = rescue.showAllDevices;
  const devicesToShow = showAllDevices ? detail.devices : active.length > 0 ? active : detail.devices;

  const refreshAfterDeviceAction = async () => {
    await loadShop();
    await loadRescueData();
  };

  const refreshDiagnostics = () => {
    void runShopConsoleRescueAction(ctx, "admin_refresh_device_diagnostics", async () => {
      await loadRescueData();
      return { ok: true };
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-stone-600">
        {active.length} logged in · {registered} registered
      </p>

      {registered === 0 ? (
        <p className="text-sm font-semibold text-stone-500">{t(lang, "internalShopProfileDevicesEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {devicesToShow.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              busy={busy}
              canSupport={canSupport}
              lang={lang}
              onActivate={() =>
                void executeAction(
                  d.is_active ? "admin_device_deactivate" : "admin_device_activate",
                  () => adminShopDeviceSetActive(d.id, !d.is_active),
                  { permitted: canSupport, skipRefresh: true },
                ).then((r) => {
                  if (r.ok) void refreshAfterDeviceAction();
                })
              }
              onTrust={() =>
                void executeAction(
                  d.trusted ? "admin_device_untrust" : "admin_device_trust",
                  () => adminShopDeviceSetTrusted(d.id, !d.trusted),
                  { permitted: canSupport, skipRefresh: true },
                ).then((r) => {
                  if (r.ok) void refreshAfterDeviceAction();
                })
              }
              onForceLogout={() =>
                void executeAction(
                  "admin_force_logout",
                  () => adminShopForceLogoutDevices(detail.shop.id),
                  {
                    permitted: canSupport,
                    confirm: t(lang, "internalShopActionConfirmLogout"),
                    skipRefresh: true,
                  },
                ).then((r) => {
                  if (r.ok) void refreshAfterDeviceAction();
                })
              }
              onRevokeTrust={() =>
                void executeAction(
                  "admin_device_untrust",
                  () => adminShopDeviceSetTrusted(d.id, false),
                  { permitted: canSupport, skipRefresh: true },
                ).then((r) => {
                  if (r.ok) void refreshAfterDeviceAction();
                })
              }
              onResetSync={() =>
                void executeAction("admin_force_sync", () => adminShopResetSync(detail.shop.id), {
                  permitted: canSupport,
                  skipRefresh: true,
                }).then((r) => {
                  if (r.ok) void refreshAfterDeviceAction();
                })
              }
              onRefresh={() => void refreshDiagnostics()}
            />
          ))}
        </ul>
      )}

      {registered > active.length && active.length > 0 ? (
        <button
          type="button"
          className="text-xs font-bold text-waka-700 underline"
          onClick={() => setRescueField("showAllDevices", !showAllDevices)}
        >
          {showAllDevices
            ? "Show logged-in devices only"
            : `Show all ${registered} registered devices`}
        </button>
      ) : null}
    </div>
  );
}

function DeviceRow({
  device,
  busy,
  canSupport,
  lang,
  onActivate,
  onTrust,
  onForceLogout,
  onRevokeTrust,
  onResetSync,
  onRefresh,
}: {
  device: ShopDeviceRow;
  busy: boolean;
  canSupport: boolean;
  lang: ShopConsoleState["lang"];
  onActivate: () => void;
  onTrust: () => void;
  onForceLogout: () => void;
  onRevokeTrust: () => void;
  onResetSync: () => void;
  onRefresh: () => void;
}) {
  const online = isRescueDeviceOnline(device.last_seen_at);

  return (
    <li className="rounded-xl border border-stone-100 bg-stone-50/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-stone-900">
            {device.label || device.device_fingerprint.slice(0, 18)}
          </p>
          <p className="text-[10px] font-semibold text-stone-500">
            {[device.platform, device.app_version ? `v${device.app_version}` : null].filter(Boolean).join(" · ") || "—"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-black uppercase">
            <span
              className={
                online
                  ? "rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-900"
                  : "rounded-md bg-stone-200 px-1.5 py-0.5 text-stone-700"
              }
            >
              {online ? t(lang, "internalShopProfileDeviceOnline") : t(lang, "internalShopProfileDeviceOffline")}
            </span>
            {device.trusted ? (
              <span className="rounded-md bg-waka-100 px-1.5 py-0.5 text-waka-900">
                {t(lang, "internalShopProfileDeviceTrusted")}
              </span>
            ) : (
              <span className="rounded-md bg-stone-200 px-1.5 py-0.5">Untrusted</span>
            )}
            {device.suspicious_flag ? (
              <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-900">Suspicious</span>
            ) : null}
          </div>
          <p className="mt-1 text-[10px] text-stone-600">Last online: {fmtTime(device.last_seen_at)}</p>
        </div>
        {canSupport ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-stone-300 px-2 py-1 text-[10px] font-black text-stone-900 disabled:opacity-40"
              onClick={onActivate}
            >
              {device.is_active
                ? t(lang, "internalShopProfileDeviceDeactivate")
                : t(lang, "internalShopProfileDeviceActivate")}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-waka-100 px-2 py-1 text-[10px] font-black text-waka-950 disabled:opacity-40"
              onClick={onTrust}
            >
              {device.trusted ? t(lang, "internalShopProfileDeviceUntrust") : t(lang, "internalShopProfileDeviceTrust")}
            </button>
            <RescueActionButton variant="secondary" disabled={busy} onClick={onForceLogout}>
              Force logout
            </RescueActionButton>
            {device.trusted ? (
              <RescueActionButton variant="secondary" disabled={busy} onClick={onRevokeTrust}>
                Revoke trust
              </RescueActionButton>
            ) : null}
            <RescueActionButton variant="secondary" disabled={busy} onClick={onResetSync}>
              Reset sync
            </RescueActionButton>
            <RescueActionButton variant="secondary" disabled={busy} onClick={onRefresh}>
              Refresh
            </RescueActionButton>
          </div>
        ) : null}
      </div>
    </li>
  );
}
