import { useMemo, useState } from "react";
import clsx from "clsx";
import { Copy, Pencil, Plus, Search, Shield, Trash2, Users } from "lucide-react";
import type { BusinessType, CustomStaffRole, CustomStaffRoleStatus, Language, Permission, UserRole } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  countStaffWithCustomRole,
  findRoleTemplate,
  isCustomRoleAssignable,
  permissionsFromTemplate,
  roleTemplatesForBusinessType,
} from "../../lib/enterpriseRoles";
import { CustomRolePermissionEditor, CustomRolePermissionPreview } from "./CustomRolePermissionEditor";

type EditorMode =
  | { kind: "create"; templateId?: string; cloneRoleId?: string }
  | { kind: "edit"; roleId: string };

type Props = {
  lang: Language;
  businessType: BusinessType;
  customRoles: CustomStaffRole[];
  staffCountByRole: (roleId: string) => number;
  onCreate: (input: {
    name: string;
    inheritsFrom: UserRole;
    permissions: Permission[];
    sourceTemplateId?: string | null;
    clonedFromRoleId?: string | null;
  }) => { ok: boolean; errorKey?: string };
  onUpdate: (
    id: string,
    patch: { name?: string; inheritsFrom?: UserRole; permissions?: Permission[]; status?: CustomStaffRoleStatus },
  ) => { ok: boolean; errorKey?: string };
  onRemove: (id: string) => { ok: boolean; errorKey?: string };
  onCloneTemplate: (templateId: string, name: string) => { ok: boolean; errorKey?: string };
  onCloneRole: (roleId: string, name: string) => { ok: boolean; errorKey?: string };
};

function formatDate(iso: string, lang: Language): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function StaffRolesCenter({
  lang,
  businessType,
  customRoles,
  staffCountByRole,
  onCreate,
  onUpdate,
  onRemove,
  onCloneTemplate,
  onCloneRole,
}: Props) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const systemTemplates = useMemo(() => roleTemplatesForBusinessType(businessType), [businessType]);

  const filteredCustom = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customRoles;
    return customRoles.filter((role) => {
      if (role.name.toLowerCase().includes(q)) return true;
      return role.permissions.some((p) => p.toLowerCase().includes(q));
    });
  }, [customRoles, query]);

  const filteredSystem = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return systemTemplates;
    return systemTemplates.filter((tpl) => t(lang, tpl.labelKey).toLowerCase().includes(q));
  }, [systemTemplates, query, lang]);

  if (editor) {
    return (
      <RoleEditorPanel
        lang={lang}
        businessType={businessType}
        mode={editor}
        customRoles={customRoles}
        systemTemplates={systemTemplates}
        onCancel={() => {
          setEditor(null);
          setError(null);
        }}
        onSave={(payload) => {
          setError(null);
          if (editor.kind === "create") {
            const res = onCreate({
              name: payload.name,
              inheritsFrom: payload.inheritsFrom,
              permissions: payload.permissions,
              sourceTemplateId: payload.sourceTemplateId,
              clonedFromRoleId: payload.clonedFromRoleId,
            });
            if (!res.ok) {
              setError(t(lang, (res.errorKey ?? "saleError") as "saleError"));
              return;
            }
          } else {
            const res = onUpdate(editor.roleId, {
              name: payload.name,
              inheritsFrom: payload.inheritsFrom,
              permissions: payload.permissions,
              status: payload.status,
            });
            if (!res.ok) {
              setError(t(lang, (res.errorKey ?? "saleError") as "saleError"));
              return;
            }
          }
          setEditor(null);
        }}
        error={error}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(lang, "enterpriseRolesSearchPh")}
            className="w-full rounded-2xl border-2 border-stone-200 bg-white py-3 pl-10 pr-4 text-sm font-semibold dark:border-stone-700 dark:bg-stone-900"
          />
        </label>
        <button
          type="button"
          onClick={() => setEditor({ kind: "create" })}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-waka-600 px-4 text-sm font-black text-white"
        >
          <Plus className="h-4 w-4" />
          {t(lang, "enterpriseRolesCreateCustom")}
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-stone-500">{t(lang, "enterpriseRolesSystemSection")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {filteredSystem.map((tpl) => (
            <li key={tpl.id} className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-black text-stone-950 dark:text-stone-50">{t(lang, tpl.labelKey)}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {t(lang, `role_${tpl.baseRole}`)}
                  </p>
                </div>
                <Shield className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
              </div>
              <p className="mt-2 text-sm font-medium text-stone-600 dark:text-stone-400">
                {permissionsFromTemplate(tpl).length} {t(lang, "enterpriseRolesPermissionsLabel")}
              </p>
              <button
                type="button"
                onClick={() => {
                  const defaultName = `${t(lang, tpl.labelKey)} Copy`;
                  const name = window.prompt(t(lang, "enterpriseRolesClonePrompt"), defaultName)?.trim();
                  if (!name) return;
                  const res = onCloneTemplate(tpl.id, name);
                  if (!res.ok) window.alert(t(lang, (res.errorKey ?? "saleError") as "saleError"));
                }}
                className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-xl border-2 border-stone-200 px-3 text-xs font-black dark:border-stone-700"
              >
                <Copy className="h-3.5 w-3.5" />
                {t(lang, "enterpriseRolesClone")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-stone-500">{t(lang, "enterpriseRolesCustomSection")}</h2>
        {filteredCustom.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-semibold text-stone-500">
            {t(lang, "enterpriseRolesEmpty")}
          </p>
        ) : (
          <ul className="grid gap-3">
            {filteredCustom.map((role) => {
              const users = staffCountByRole(role.id);
              const status = role.status ?? "active";
              return (
                <li
                  key={role.id}
                  className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-stone-950 dark:text-stone-50">{role.name}</p>
                      <p className="mt-1 text-sm font-semibold text-stone-500">
                        {role.permissions.length} {t(lang, "enterpriseRolesPermissionsLabel")} · {t(lang, `role_${role.inheritsFrom}`)}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                        status === "active" && "bg-emerald-100 text-emerald-800",
                        status === "disabled" && "bg-amber-100 text-amber-900",
                        status === "archived" && "bg-stone-200 text-stone-700",
                      )}
                    >
                      {t(lang, `enterpriseRolesStatus_${status}` as "enterpriseRolesStatus_active")}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-stone-600 dark:text-stone-400">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {tTemplate(lang, "enterpriseRolesUsersCount", { count: String(users) })}
                    </span>
                    <span>{t(lang, "enterpriseRolesCreated")}: {formatDate(role.createdAt, lang)}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditor({ kind: "edit", roleId: role.id })}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border-2 border-stone-200 px-3 text-xs font-black dark:border-stone-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t(lang, "enterpriseRolesEditPermissions")}
                    </button>
                    <button
                      type="button"
                      disabled={!isCustomRoleAssignable(role)}
                      onClick={() => {
                        const name = window.prompt(t(lang, "enterpriseRolesClonePrompt"), `${role.name} Copy`)?.trim();
                        if (!name) return;
                        const res = onCloneRole(role.id, name);
                        if (!res.ok) window.alert(t(lang, (res.errorKey ?? "saleError") as "saleError"));
                      }}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border-2 border-stone-200 px-3 text-xs font-black disabled:opacity-50 dark:border-stone-700"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t(lang, "enterpriseRolesClone")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(t(lang, "enterpriseRolesDeleteConfirm"))) return;
                        const res = onRemove(role.id);
                        if (!res.ok) window.alert(t(lang, (res.errorKey ?? "saleError") as "saleError"));
                      }}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border-2 border-rose-200 px-3 text-xs font-black text-rose-800 dark:border-rose-900 dark:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t(lang, "delete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoleEditorPanel({
  lang,
  businessType,
  mode,
  customRoles,
  systemTemplates,
  onCancel,
  onSave,
  error,
}: {
  lang: Language;
  businessType: BusinessType;
  mode: EditorMode;
  customRoles: CustomStaffRole[];
  systemTemplates: ReturnType<typeof roleTemplatesForBusinessType>;
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    inheritsFrom: UserRole;
    permissions: Permission[];
    sourceTemplateId?: string | null;
    clonedFromRoleId?: string | null;
    status?: CustomStaffRoleStatus;
  }) => void;
  error: string | null;
}) {
  const existing = mode.kind === "edit" ? customRoles.find((r) => r.id === mode.roleId) : null;
  const initialTemplate =
    mode.kind === "create" && mode.templateId
      ? findRoleTemplate(mode.templateId)
      : mode.kind === "create" && mode.cloneRoleId
        ? null
        : systemTemplates[0] ?? null;
  const cloneSource = mode.kind === "create" && mode.cloneRoleId
    ? customRoles.find((r) => r.id === mode.cloneRoleId)
    : null;

  const [name, setName] = useState(existing?.name ?? cloneSource?.name ?? "");
  const [templateId, setTemplateId] = useState(
    existing?.sourceTemplateId ?? initialTemplate?.id ?? systemTemplates[0]?.id ?? "",
  );
  const [permissions, setPermissions] = useState<Permission[]>(
    existing?.permissions ??
      cloneSource?.permissions ??
      (initialTemplate ? permissionsFromTemplate(initialTemplate) : []),
  );
  const [status, setStatus] = useState<CustomStaffRoleStatus>(existing?.status ?? "active");

  const selectedTemplate = findRoleTemplate(templateId) ?? systemTemplates[0];

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black text-stone-950 dark:text-stone-50">
          {mode.kind === "create" ? t(lang, "enterpriseRolesCreateCustom") : t(lang, "enterpriseRolesEditPermissions")}
        </h2>
        <button type="button" onClick={onCancel} className="min-h-[40px] rounded-xl border-2 px-4 text-sm font-bold">
          {t(lang, "cancel")}
        </button>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}

      <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
        {t(lang, "enterpriseRolesNameLabel")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
        />
      </label>

      {mode.kind === "create" ? (
        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "enterpriseRolesBaseTemplate")}
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const tpl = findRoleTemplate(e.target.value);
              if (tpl) setPermissions(permissionsFromTemplate(tpl));
            }}
            className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
          >
            {systemTemplates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {t(lang, tpl.labelKey)} ({t(lang, `role_${tpl.baseRole}`)})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block text-sm font-bold text-stone-800 dark:text-stone-200">
          {t(lang, "enterpriseRolesStatusLabel")}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CustomStaffRoleStatus)}
            className="mt-1.5 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 dark:border-stone-700 dark:bg-stone-950"
          >
            <option value="active">{t(lang, "enterpriseRolesStatus_active")}</option>
            <option value="disabled">{t(lang, "enterpriseRolesStatus_disabled")}</option>
            <option value="archived">{t(lang, "enterpriseRolesStatus_archived")}</option>
          </select>
        </label>
      )}

      <CustomRolePermissionPreview lang={lang} businessType={businessType} permissions={permissions} />
      <CustomRolePermissionEditor lang={lang} businessType={businessType} selected={permissions} onChange={setPermissions} />

      <button
        type="button"
        onClick={() => {
          if (!name.trim() || !selectedTemplate) return;
          onSave({
            name: name.trim(),
            inheritsFrom: existing?.inheritsFrom ?? selectedTemplate.baseRole,
            permissions,
            sourceTemplateId: mode.kind === "create" ? selectedTemplate.id : existing?.sourceTemplateId ?? null,
            clonedFromRoleId: cloneSource?.id ?? existing?.clonedFromRoleId ?? null,
            status: mode.kind === "edit" ? status : "active",
          });
        }}
        className="min-h-[52px] w-full rounded-2xl bg-waka-600 text-base font-black text-white"
      >
        {t(lang, "save")}
      </button>
    </div>
  );
}

export { countStaffWithCustomRole };
