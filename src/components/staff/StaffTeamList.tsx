import { useMemo, useState } from "react";
import { AlertTriangle, Search, Shield, UserPlus } from "lucide-react";
import clsx from "clsx";
import type { BusinessType, CustomStaffRole, Language, StaffAccount, UserRole } from "../../types";
import { t } from "../../lib/i18n";
import { staffInitials } from "../../lib/staffRoleCatalog";
import { findRoleTemplate, isCustomRoleAssignable, roleTemplatesForBusinessType } from "../../lib/enterpriseRoles";
import { isStaffLoginLocked } from "../../lib/staffSecret";
import { getDeviceOnline } from "../../lib/deviceOnline";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

type Props = {
  lang: Language;
  businessType: BusinessType;
  customStaffRoles?: CustomStaffRole[];
  staff: StaffAccount[];
  maxStaff: number;
  onAddStaff: () => void;
  onToggleActive: (id: string, active: boolean) => void;
  onUpdateRoleTemplate: (id: string, roleTemplateId: string, role: UserRole) => void;
  onAssignCustomRole: (id: string, customRoleId: string) => void;
  onResetPin: (id: string) => void;
  onResetPassword: (id: string) => void;
  onUnlock: (id: string) => void;
  onForceLogout: (id: string) => void;
  onDelete: (id: string) => void;
  activeStaffId?: string | null;
};

function staffRoleDisplayName(
  lang: Language,
  staff: StaffAccount,
  customStaffRoles: CustomStaffRole[] | undefined,
): string {
  if (staff.customRoleId && customStaffRoles?.length) {
    const custom = customStaffRoles.find((r) => r.id === staff.customRoleId);
    if (custom?.name) return custom.name;
  }
  const tpl = findRoleTemplate(staff.roleTemplateId);
  if (tpl) return t(lang, tpl.labelKey);
  return t(lang, `role_${staff.role}`);
}

function formatWhen(iso: string | null | undefined, lang: Language): string {
  if (!iso) return t(lang, "staffSecurityNever");
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return t(lang, "staffSecurityNever");
  return new Date(ms).toLocaleString();
}

function lastSecretChange(staff: StaffAccount): string | null {
  const pin = staff.pinChangedAt ? Date.parse(staff.pinChangedAt) : 0;
  const pass = staff.passwordChangedAt ? Date.parse(staff.passwordChangedAt) : 0;
  if (!pin && !pass) return null;
  if (pin >= pass) return staff.pinChangedAt ?? null;
  return staff.passwordChangedAt ?? null;
}

export function StaffTeamList({
  lang,
  businessType,
  customStaffRoles,
  staff,
  maxStaff,
  onAddStaff,
  onToggleActive,
  onUpdateRoleTemplate,
  onAssignCustomRole,
  onResetPin,
  onResetPassword,
  onUnlock,
  onForceLogout,
  onDelete,
  activeStaffId,
}: Props) {
  const [query, setQuery] = useState("");
  const [manageId, setManageId] = useState<string | null>(null);
  const online = getDeviceOnline();

  const roleOptions = useMemo(() => roleTemplatesForBusinessType(businessType), [businessType]);
  const assignableCustomRoles = useMemo(
    () => (customStaffRoles ?? []).filter((r) => isCustomRoleAssignable(r)),
    [customStaffRoles],
  );

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...staff]
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          staffRoleDisplayName(lang, s, customStaffRoles).toLowerCase().includes(q),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [lang, query, staff, customStaffRoles]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "staffYourTeam")}</p>
        <button
          type="button"
          onClick={onAddStaff}
          disabled={maxStaff > 0 && staff.length >= maxStaff}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          {t(lang, "staffWizardAddStaff")}
        </button>
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "staffTeamSearch")}
          className="w-full rounded-2xl border-2 border-border bg-card py-3 pl-10 pr-4 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-waka-400 focus:outline-none"
        />
      </label>

      {ordered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-muted px-4 py-8 text-center text-sm font-semibold text-muted-foreground">
          {t(lang, "staffTeamEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((s) => {
            const open = manageId === s.id;
            const locked = isStaffLoginLocked(s);
            const isActiveSession = activeStaffId === s.id;
            const selectedTemplateId =
              s.customRoleId
                ? `custom:${s.customRoleId}`
                : s.roleTemplateId && roleOptions.some((o) => o.id === s.roleTemplateId)
                  ? s.roleTemplateId
                  : roleOptions.find((o) => o.baseRole === s.role)?.id ?? roleOptions[0]?.id ?? "";

            return (
              <li key={s.id} className="rounded-3xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-sm font-black text-muted-foreground">
                    {staffInitials(s.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-foreground">{s.name}</p>
                    <p className="text-sm font-semibold text-muted-foreground">{staffRoleDisplayName(lang, s, customStaffRoles)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={clsx(
                        "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                        s.active ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800",
                      )}
                    >
                      {s.active ? t(lang, "staffActive") : t(lang, "staffInactive")}
                    </span>
                    {locked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-900">
                        <AlertTriangle className="h-3 w-3" />
                        {t(lang, "staffSecurityLocked")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 rounded-2xl bg-muted px-3 py-3 text-xs font-medium text-muted-foreground sm:grid-cols-2">
                  <p>
                    <span className="font-black text-muted-foreground">{t(lang, "staffSecurityLastLogin")}: </span>
                    {formatWhen(s.lastLoginAt, lang)}
                  </p>
                  <p>
                    <span className="font-black text-muted-foreground">{t(lang, "staffSecurityDevice")}: </span>
                    {s.lastDeviceFingerprint ? `${s.lastDeviceFingerprint.slice(0, 8)}…` : t(lang, "staffSecurityNever")}
                  </p>
                  <p>
                    <span className="font-black text-muted-foreground">{t(lang, "staffSecurityFailedAttempts")}: </span>
                    {s.failedPinAttempts ?? 0}
                  </p>
                  <p>
                    <span className="font-black text-muted-foreground">{t(lang, "staffSecurityPinChanged")}: </span>
                    {formatWhen(lastSecretChange(s), lang)}
                  </p>
                  <p>
                    <span className="font-black text-muted-foreground">{t(lang, "staffSecurityStatus")}: </span>
                    {isActiveSession ? t(lang, "staffSecuritySignedIn") : t(lang, "staffSecuritySignedOut")}
                  </p>
                  <p>
                    <span className="font-black text-muted-foreground">{t(lang, "staffSecurityConnectivity")}: </span>
                    {online ? t(lang, "staffSecurityOnline") : t(lang, "staffSecurityOffline")}
                  </p>
                  {locked && s.lockedUntil ? (
                    <p className="sm:col-span-2">
                      <span className="font-black text-muted-foreground">{t(lang, "staffSecurityLockedUntil")}: </span>
                      {formatWhen(s.lockedUntil, lang)}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <WakaCheckbox
                    checked={s.active}
                    onCheckedChange={(checked) => onToggleActive(s.id, checked)}
                    label={s.active ? t(lang, "staffActive") : t(lang, "staffInactive")}
                    className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-muted-foreground"
                  />
                  <button
                    type="button"
                    className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-waka-700"
                    onClick={() => setManageId(open ? null : s.id)}
                  >
                    {open ? t(lang, "staffManageClose") : t(lang, "staffManage")}
                  </button>
                </div>

                {open ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith("custom:")) {
                          const customRoleId = value.slice("custom:".length);
                          const custom = assignableCustomRoles.find((r) => r.id === customRoleId);
                          if (!custom) return;
                          onAssignCustomRole(s.id, customRoleId);
                          return;
                        }
                        const tpl = findRoleTemplate(value);
                        if (!tpl) return;
                        onUpdateRoleTemplate(s.id, tpl.id, tpl.baseRole);
                      }}
                      className="rounded-xl border-2 border-border px-3 py-2 text-sm font-semibold"
                    >
                      <optgroup label={t(lang, "enterpriseRolesSystemSection")}>
                        {roleOptions.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {t(lang, tpl.labelKey)}
                          </option>
                        ))}
                      </optgroup>
                      {assignableCustomRoles.length > 0 ? (
                        <optgroup label={t(lang, "enterpriseRolesCustomSection")}>
                          {assignableCustomRoles.map((role) => (
                            <option key={role.id} value={`custom:${role.id}`}>
                              {role.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    <button type="button" className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold" onClick={() => onResetPin(s.id)}>
                      {t(lang, "staffResetPin")}
                    </button>
                    <button type="button" className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold" onClick={() => onResetPassword(s.id)}>
                      {t(lang, "staffResetPassword")}
                    </button>
                    {locked ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900"
                        onClick={() => onUnlock(s.id)}
                      >
                        <Shield className="h-4 w-4" />
                        {t(lang, "staffSecurityUnlock")}
                      </button>
                    ) : null}
                    {isActiveSession ? (
                      <button
                        type="button"
                        className="rounded-xl border-2 border-border px-3 py-2 text-sm font-bold"
                        onClick={() => onForceLogout(s.id)}
                      >
                        {t(lang, "staffSecurityForceLogout")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-xl border-2 border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700"
                      onClick={() => onDelete(s.id)}
                    >
                      {t(lang, "staffDelete")}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
