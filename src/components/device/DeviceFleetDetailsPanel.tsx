import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import type { ShopDeviceRow } from "../../lib/shopDevices";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
} from "../../lib/devicePresenceFormat";
import { buildDeviceTimeline, presenceLabelKey } from "../../lib/deviceFleetCatalog";
import { resolveDevicePresence, shortDeviceFingerprint } from "../../lib/deviceFleetPresence";
import { readDeviceDisplayAlias, writeDeviceDisplayAlias } from "../../lib/deviceFleetLabels";

type Props = {
  lang: Language;
  open: boolean;
  device: ShopDeviceRow | null;
  shopId: string | null;
  displayName?: string;
  staffLabel?: string | null;
  isCurrent: boolean;
  onClose: () => void;
  onAliasSaved?: () => void;
};

function fmt(iso: string | null | undefined, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG");
  } catch {
    return "—";
  }
}

export function DeviceFleetDetailsPanel({
  lang,
  open,
  device,
  shopId,
  displayName,
  staffLabel,
  isCurrent,
  onClose,
  onAliasSaved,
}: Props) {
  const [aliasDraft, setAliasDraft] = useState("");

  useEffect(() => {
    if (!device || !shopId) {
      setAliasDraft("");
      return;
    }
    setAliasDraft(readDeviceDisplayAlias(shopId, device.id) ?? device.label ?? "");
  }, [device, shopId]);

  if (!open || !device) return null;

  const name = displayName ?? formatDeviceDisplayName(device.label, device.platform);
  const presence = resolveDevicePresence(device);
  const timeline = buildDeviceTimeline(device);

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[70]"
      clearNav={false}
      title={t(lang, "deviceFleetDetailsTitle")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          {shopId ? (
            <button
              type="button"
              onClick={() => {
                writeDeviceDisplayAlias(shopId, device.id, aliasDraft);
                onAliasSaved?.();
                onClose();
              }}
              className="min-h-[48px] rounded-2xl bg-waka-600 font-black text-white"
            >
              {t(lang, "deviceFleetSaveAlias")}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl bg-muted p-4">
          <p className="text-lg font-black text-foreground">{name}</p>
          <p className="text-sm font-semibold text-muted-foreground">{formatDevicePlatformLabel(device.platform)}</p>
          {isCurrent ? (
            <p className="mt-2 text-xs font-bold text-sky-800">{t(lang, "deviceFleetThisDevice")}</p>
          ) : null}
        </div>

        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-muted-foreground">{t(lang, "deviceFleetPresence")}</dt>
            <dd className="font-bold text-foreground">{t(lang, presenceLabelKey(presence))}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-muted-foreground">{t(lang, "deviceFleetDeviceId")}</dt>
            <dd className="font-mono text-xs font-bold text-foreground">{shortDeviceFingerprint(device.device_fingerprint)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-muted-foreground">{t(lang, "deviceMgmtVersion")}</dt>
            <dd className="font-bold text-foreground">{device.app_version ?? "—"}</dd>
          </div>
          {staffLabel ? (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-muted-foreground">{t(lang, "deviceFleetStaff")}</dt>
              <dd className="font-bold text-foreground">{staffLabel}</dd>
            </div>
          ) : null}
        </dl>

        <label className="block text-sm font-bold text-foreground">
          {t(lang, "deviceFleetRename")}
          <input
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value.slice(0, 64))}
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-waka-200 px-4 font-semibold outline-none ring-waka-300 focus:ring"
            placeholder={t(lang, "deviceFleetRenamePlaceholder")}
          />
          <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "deviceFleetRenameHint")}</p>
        </label>

        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
            {t(lang, "deviceFleetTimelineTitle")}
          </h3>
          <ul className="mt-2 space-y-2">
            {timeline.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                <span className="font-semibold text-muted-foreground">{t(lang, entry.labelKey)}</span>
                <span className="font-bold text-foreground">{fmt(entry.at, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ModalSheet>
  );
}
