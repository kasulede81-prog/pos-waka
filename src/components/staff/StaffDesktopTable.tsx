import { useMemo } from "react";
import type { CustomStaffRole, Language, StaffAccount } from "../../types";
import { t } from "../../lib/i18n";
import { findRoleTemplate } from "../../lib/enterpriseRoles";
import { isStaffLoginLocked } from "../../lib/staffSecret";
import { statusTokens } from "../../lib/statusTokens";
import { EnterpriseDataTable, type EnterpriseDataColumn } from "../enterprise/data-table";

type Props = {
  lang: Language;
  staff: StaffAccount[];
  customStaffRoles?: CustomStaffRole[];
  onManage: (staff: StaffAccount) => void;
};

function roleName(lang: Language, s: StaffAccount, customStaffRoles?: CustomStaffRole[]): string {
  if (s.customRoleId && customStaffRoles?.length) {
    const custom = customStaffRoles.find((r) => r.id === s.customRoleId);
    if (custom?.name) return custom.name;
  }
  const tpl = findRoleTemplate(s.roleTemplateId);
  if (tpl) return t(lang, tpl.labelKey);
  return t(lang, `role_${s.role}`);
}

function formatWhen(iso: string | null | undefined, lang: Language): string {
  if (!iso) return t(lang, "staffSecurityNever");
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return t(lang, "staffSecurityNever");
  return new Date(ms).toLocaleString();
}

export function StaffDesktopTable({ lang, staff, customStaffRoles, onManage }: Props) {
  const columns: EnterpriseDataColumn<StaffAccount>[] = useMemo(
    () => [
      {
        id: "name",
        header: t(lang, "staffYourTeam"),
        width: "minmax(140px,2fr)",
        cell: (s) => s.name,
        className: "text-foreground",
      },
      {
        id: "role",
        header: "Role",
        width: "minmax(120px,1.2fr)",
        cell: (s) => roleName(lang, s, customStaffRoles),
      },
      {
        id: "device",
        header: t(lang, "connectedDevicesTitle"),
        width: "minmax(100px,1fr)",
        hideBelow: "lg",
        cell: (s) => (s.lastDeviceFingerprint ? `${s.lastDeviceFingerprint.slice(0, 8)}…` : "—"),
      },
      {
        id: "login",
        header: t(lang, "staffSecurityLastLogin"),
        width: "minmax(140px,1.2fr)",
        hideBelow: "xl",
        cell: (s) => formatWhen(s.lastLoginAt, lang),
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(96px,0.9fr)",
        cell: (s) => {
          if (isStaffLoginLocked(s)) return <span className={statusTokens.danger.badge}>{t(lang, "staffSecurityLocked")}</span>;
          if (!s.active) return <span className={statusTokens.draft.badge}>{t(lang, "staffInactive")}</span>;
          return <span className={statusTokens.success.badge}>{t(lang, "staffActive")}</span>;
        },
      },
    ],
    [lang, customStaffRoles],
  );

  return (
    <EnterpriseDataTable
      rows={staff}
      columns={columns}
      rowKey={(s) => s.id}
      onRowActivate={onManage}
      minWidthPx={880}
      ariaLabel={t(lang, "staffYourTeam")}
      rowActions={(s) => (
        <button
          type="button"
          onClick={() => onManage(s)}
          className="rounded-lg px-2 py-1 text-[11px] font-bold text-waka-700 hover:bg-muted"
        >
          {t(lang, "staffManage")}
        </button>
      )}
    />
  );
}
