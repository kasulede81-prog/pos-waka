import { useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ShopDeviceRow } from "../../lib/shopDevices";
import { statusTokens } from "../../lib/statusTokens";
import { EnterpriseDataTable, type EnterpriseDataColumn } from "../enterprise/data-table";

type Props = {
  lang: Language;
  devices: ShopDeviceRow[];
  displayNameFor: (device: ShopDeviceRow) => string;
  staffLabelFor: (device: ShopDeviceRow) => string;
  onSelect: (device: ShopDeviceRow) => void;
};

function formatSeen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString();
}

export function DevicesDesktopTable({ lang, devices, displayNameFor, staffLabelFor, onSelect }: Props) {
  const columns: EnterpriseDataColumn<ShopDeviceRow>[] = useMemo(
    () => [
      {
        id: "device",
        header: t(lang, "connectedDevicesTitle"),
        width: "minmax(140px,2fr)",
        cell: (d) => displayNameFor(d),
        className: "text-foreground",
      },
      {
        id: "platform",
        header: "Platform",
        width: "minmax(88px,0.9fr)",
        hideBelow: "lg",
        cell: (d) => d.platform?.trim() || d.form_factor || "—",
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(100px,1fr)",
        cell: (d) => {
          if (d.approval_status === "pending") return <span className={statusTokens.warning.badge}>{t(lang, "deviceFleetSectionPending")}</span>;
          if (d.approval_status === "approved" && d.status === "active") {
            return <span className={statusTokens.success.badge}>{t(lang, "staffActive")}</span>;
          }
          return <span className={statusTokens.draft.badge}>{d.approval_status}</span>;
        },
      },
      {
        id: "seen",
        header: "Last seen",
        width: "minmax(140px,1.2fr)",
        hideBelow: "lg",
        cell: (d) => formatSeen(d.last_seen_at),
      },
      {
        id: "staff",
        header: t(lang, "staffYourTeam"),
        width: "minmax(110px,1fr)",
        hideBelow: "xl",
        cell: (d) => staffLabelFor(d) || "—",
      },
      {
        id: "version",
        header: "Version",
        width: "minmax(72px,0.7fr)",
        hideBelow: "xl",
        cell: (d) => d.app_version?.trim() || "—",
      },
    ],
    [lang, displayNameFor, staffLabelFor],
  );

  return (
    <EnterpriseDataTable
      rows={devices}
      columns={columns}
      rowKey={(d) => d.id}
      onRowActivate={onSelect}
      minWidthPx={920}
      ariaLabel={t(lang, "connectedDevicesTitle")}
    />
  );
}
