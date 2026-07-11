import { useEffect, useMemo, useState } from "react";
import { Plus, Shield } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchDistricts, type DistrictRow } from "../../lib/shopDistricts";
import {
  fetchInternalAdmins,
  internalAdminCreateByEmail,
  internalAdminSetActive,
  internalAdminUpdateRoleAndDistricts,
  type InternalAdminRow,
} from "../../lib/wakaInternalAdmin";
import { PREVIEW_INTERNAL_ADMINS } from "../../lib/internalAdminPreview";
import { AdminCollapsible } from "./adminUi";
import { AdminRightDrawer } from "./v2/AdminRightDrawer";

type Props = { lang: Language; lovableUi?: boolean; previewMode?: boolean };

type RoleCode = "super_admin" | "operations_admin" | "support_admin" | "field_agent";

const ROLE_OPTIONS: { code: RoleCode; label: string }[] = [
  { code: "super_admin", label: "SUPER ADMIN" },
  { code: "operations_admin", label: "OPERATIONS" },
  { code: "support_admin", label: "SUPPORT" },
  { code: "field_agent", label: "FIELD AGENT" },
];

function normalizeRoleForUi(role: string): RoleCode {
  const r = (role ?? "").toLowerCase();
  if (r === "super_admin") return "super_admin";
  if (r === "support_admin") return "support_admin";
  if (r === "field_agent") return "field_agent";
  if (r === "operations_admin") return "operations_admin";
  // legacy roles map into operations_admin
  if (r === "finance_admin" || r === "subscriptions_admin") return "operations_admin";
  return "field_agent";
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "orange" | "slate" | "emerald" | "rose" }) {
  const cls =
    tone === "orange"
      ? "bg-waka-50 text-waka-950 ring-waka-200/80"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-900 ring-emerald-200/80"
        : tone === "rose"
          ? "bg-rose-50 text-rose-900 ring-rose-200/80"
          : "bg-muted text-foreground ring-border/80";
  return (
    <span className={clsx("inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black uppercase ring-1", cls)}>
      {children}
    </span>
  );
}

export function InternalAdminsManagement({ lang, lovableUi = false, previewMode = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [admins, setAdmins] = useState<InternalAdminRow[]>([]);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtLoadErr, setDistrictLoadErr] = useState(false);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleCode | "all">("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");

  const [createBusy, setCreateBusy] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createFullName, setCreateFullName] = useState("");
  const [createRole, setCreateRole] = useState<RoleCode>("field_agent");
  const [createDistrictIds, setCreateDistrictIds] = useState<string[]>([]);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const [editBusyId, setEditBusyId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<RoleCode>("field_agent");
  const [editFullName, setEditFullName] = useState("");
  const [editDistrictIds, setEditDistrictIds] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDistrictLoadErr(false);
    if (previewMode) {
      setAdmins(PREVIEW_INTERNAL_ADMINS);
      setDistricts([]);
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const [dr, list] = await Promise.all([fetchDistricts(), fetchInternalAdmins()]);
        if (cancelled) return;
        setDistricts(dr.districts);
        if (dr.error) setDistrictLoadErr(true);
        setAdmins(list);
      } catch {
        if (!cancelled) setDistrictLoadErr(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewMode]);

  const refresh = async () => {
    const list = await fetchInternalAdmins();
    setAdmins(list);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return admins.filter((a) => {
      const roleNorm = normalizeRoleForUi(a.role);
      const matchesRole = roleFilter === "all" ? true : roleNorm === roleFilter;
      const matchesActive = activeFilter === "all" ? true : activeFilter === "active" ? a.active : !a.active;
      const matchesSearch = !q ? true : (a.full_name ?? "").toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
      return matchesRole && matchesActive && matchesSearch;
    });
  }, [admins, search, roleFilter, activeFilter]);

  const toggleDistrict = (id: string, set: (next: string[]) => void, current: string[]) => {
    if (current.includes(id)) set(current.filter((x) => x !== id));
    else set([...current, id]);
  };

  const beginEdit = (a: InternalAdminRow) => {
    setEditTargetId(a.id);
    setEditRole(normalizeRoleForUi(a.role));
    setEditFullName(a.full_name ?? "");
    setEditDistrictIds(a.assigned_district_ids ?? []);
    setEditActive(a.active);
    setEditMsg(null);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditTargetId(null);
    setEditMsg(null);
  };

  const submitCreate = async () => {
    if (previewMode) {
      setCreateMsg(t(lang, "internalAdminPreviewActionBlocked"));
      return;
    }
    setCreateMsg(null);
    if (!createEmail.trim()) {
      setCreateMsg(t(lang, "internalAdminsCreateEmailRequired"));
      return;
    }
    setCreateBusy(true);
    try {
      const r = await internalAdminCreateByEmail({
        email: createEmail,
        fullName: createFullName || null,
        role: createRole,
        assignedDistrictIds: createDistrictIds,
      });
      if (!r.ok) {
        setCreateMsg(r.message ?? t(lang, "internalAdminsCreateFail"));
        return;
      }
      setCreateEmail("");
      setCreateFullName("");
      setCreateRole("field_agent");
      setCreateDistrictIds([]);
      await refresh();
      setCreateMsg(t(lang, "internalAdminsCreateOk"));
    } finally {
      setCreateBusy(false);
    }
  };

  const submitEdit = async () => {
    if (previewMode) {
      setEditMsg(t(lang, "internalAdminPreviewActionBlocked"));
      return;
    }
    if (!editTargetId) return;
    setEditBusyId(editTargetId);
    setEditMsg(null);
    try {
      const r1 = await internalAdminUpdateRoleAndDistricts({
        internalAdminId: editTargetId,
        role: editRole,
        fullName: editFullName || null,
        assignedDistrictIds: editDistrictIds,
      });
      if (!r1.ok) {
        setEditMsg(r1.message ?? t(lang, "internalAdminsEditFail"));
        return;
      }
      const r2 = await internalAdminSetActive({ internalAdminId: editTargetId, active: editActive });
      if (!r2.ok) {
        setEditMsg(r2.message ?? t(lang, "internalAdminsEditFail"));
        return;
      }
      await refresh();
      closeEdit();
    } finally {
      setEditBusyId(null);
    }
  };

  return (
    <div className={lovableUi ? "space-y-6 pb-6" : "space-y-6 pb-12 pt-2"}>
      {previewMode ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          {t(lang, "internalAdminPreviewShellHint")}
        </p>
      ) : null}
      {!lovableUi ? (
      <header className="rounded-3xl border border-waka-100 bg-gradient-to-br from-white via-waka-50/40 to-card p-6 shadow-[0_20px_60px_rgb(251_146_60/0.10)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-waka-900 ring-1 ring-waka-200/60">
              <Shield className="h-4 w-4 text-waka-600" />
              {t(lang, "internalAdminsHeaderTitle")}
            </div>
            <h1 className="mt-3 text-2xl font-black text-foreground">{t(lang, "internalAdminsHeaderH1")}</h1>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "internalAdminsHeaderSub")}</p>
          </div>
          <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-border sm:min-w-[12rem]">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsCountLabel")}</p>
            <p className="mt-1 text-2xl font-black text-foreground">{admins.length}</p>
          </div>
        </div>
      </header>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{t(lang, "internalAdminsHeaderTitle")}</p>
          <h1 className="mt-1 text-xl font-black text-foreground">{t(lang, "internalAdminsHeaderH1")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "internalAdminsHeaderSub")}</p>
          <p className="mt-2 text-xs font-bold text-muted-foreground">
            {t(lang, "internalAdminsCountLabel")}: {admins.length}
          </p>
        </div>
      )}

      <section className="grid gap-3 lg:grid-cols-3 lg:gap-5">
        <div className="lg:col-span-1">
          <AdminCollapsible title={t(lang, "internalAdminsCreateTitle")} summary={t(lang, "internalAdminsCreateSub")}>
          <div className="space-y-3">
              <label className="block">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsEmailLabel")}</p>
                <input
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
                  placeholder="email@example.com"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsFullNameLabel")}</p>
                <input
                  value={createFullName}
                  onChange={(e) => setCreateFullName(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
                  placeholder="Kasule Denis"
                />
              </label>

              <label className="block">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsRoleLabel")}</p>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as RoleCode)}
                  className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsDistrictsLabel")}</p>
                <div className="mt-2 max-h-44 overflow-y-auto rounded-2xl border border-border bg-muted p-2">
                  {districts.length === 0 ? (
                    <p className="px-2 py-3 text-sm font-semibold text-muted-foreground">{districtLoadErr ? t(lang, "internalAdminsDistrictsLoadFail") : t(lang, "internalAdminsDistrictsLoading")}</p>
                  ) : (
                    districts.map((d) => {
                      const on = createDistrictIds.includes(d.id as string);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleDistrict(d.id as string, setCreateDistrictIds, createDistrictIds)}
                          className={clsx(
                            "m-1 inline-flex min-h-[36px] items-center rounded-xl border px-3 py-1 text-xs font-black",
                            on ? "border-waka-300 bg-waka-50 text-waka-900" : "border-border bg-card text-muted-foreground",
                          )}
                        >
                          {d.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {createMsg ? (
                <p className={clsx("rounded-2xl px-4 py-3 text-sm font-bold", createMsg.includes("Ok") ? "bg-emerald-50 text-emerald-900" : "bg-muted text-muted-foreground")}>
                  {createMsg}
                </p>
              ) : null}

              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate()}
                className="mt-1 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 px-4 py-3 text-base font-black text-white shadow-waka-sm disabled:opacity-40"
              >
                <Plus className="h-5 w-5" />
                {createBusy ? "…" : t(lang, "internalAdminsCreateCta")}
              </button>

              <p className="text-xs font-semibold text-muted-foreground">{t(lang, "internalAdminsCreateHint")}</p>
            </div>
          </AdminCollapsible>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-3xl border border-border/80 bg-card p-4 shadow-waka-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsSearchLabel")}</p>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
                  placeholder={t(lang, "internalAdminsSearchPlaceholder")}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="block">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsRoleFilterLabel")}</p>
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as RoleCode | "all")}
                    className="mt-1 min-w-[160px] rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
                  >
                    <option value="all">{t(lang, "internalAdminsFilterAll")}</option>
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsActiveFilterLabel")}</p>
                  <select
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
                    className="mt-1 min-w-[160px] rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
                  >
                    <option value="all">{t(lang, "internalAdminsFilterAll")}</option>
                    <option value="active">{t(lang, "internalAdminsActiveOnly")}</option>
                    <option value="inactive">{t(lang, "internalAdminsInactiveOnly")}</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-muted-foreground">
                {t(lang, "internalAdminsShowing")} {filtered.length}
              </p>
              <button type="button" onClick={() => void refresh()} className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-black text-muted-foreground">
                {t(lang, "internalAdminsRefresh")}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-border/80 bg-card p-4 shadow-waka-sm">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-10 text-center">
                <p className="text-sm font-black text-muted-foreground">{t(lang, "internalAdminsEmptyTitle")}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">{t(lang, "internalAdminsEmptySub")}</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((a) => (
                  <div key={a.id} className="rounded-3xl border border-border bg-muted/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-black text-foreground">{a.full_name ?? a.email.split("@")[0]}</p>
                        <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">{a.email}</p>
                      </div>
                      <Chip tone={a.active ? "emerald" : "rose"}>{a.active ? t(lang, "internalAdminsActive") : t(lang, "internalAdminsInactive")}</Chip>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Chip tone="orange">
                        {normalizeRoleForUi(a.role).replace(/_/g, " ").toUpperCase()}
                      </Chip>
                      {a.assigned_district_ids?.length ? (
                        <>
                          <Chip tone="slate">
                            {a.assigned_district_ids.length} {t(lang, "internalAdminsDistrictCount")}
                          </Chip>
                          {a.assigned_district_ids
                            .slice(0, 3)
                            .map((id) => districts.find((d) => d.id === id)?.name)
                            .filter(Boolean)
                            .map((name) => (
                              <Chip key={name as string} tone="slate">
                                {name}
                              </Chip>
                            ))}
                          {a.assigned_district_ids.length > 3 ? (
                            <Chip tone="slate">+{a.assigned_district_ids.length - 3}</Chip>
                          ) : null}
                        </>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditTargetId(a.id);
                          beginEdit(a);
                        }}
                        className="rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-black text-foreground"
                      >
                        {t(lang, "internalAdminsEdit")}
                      </button>
                      <button
                        type="button"
                        disabled={editBusyId === a.id}
                        onClick={async () => {
                          setEditBusyId(a.id);
                          const r = await internalAdminSetActive({ internalAdminId: a.id, active: !a.active });
                          setEditBusyId(null);
                          if (!r.ok) return;
                          await refresh();
                        }}
                        className="rounded-2xl bg-foreground px-4 py-2.5 text-sm font-black text-background disabled:opacity-40"
                      >
                        {editBusyId === a.id ? "…" : a.active ? t(lang, "internalAdminsDeactivate") : t(lang, "internalAdminsReactivate")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <AdminRightDrawer
        title={t(lang, "internalAdminsEditModalTitle")}
        open={editOpen}
        onClose={closeEdit}
      >
        {editTargetId ? (
          <div className="space-y-3">
            <label className="block">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsRoleLabel")}</p>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as RoleCode)}
                className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsFullNameLabel")}</p>
              <input
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
              />
            </label>

            <label className="block">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsActiveToggleLabel")}</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditActive(true)}
                  className={clsx("min-h-[44px] flex-1 rounded-2xl border px-4 py-2.5 text-sm font-black", editActive ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-border bg-card text-muted-foreground")}
                >
                  {t(lang, "internalAdminsActive")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditActive(false)}
                  className={clsx("min-h-[44px] flex-1 rounded-2xl border px-4 py-2.5 text-sm font-black", !editActive ? "border-rose-300 bg-rose-50 text-rose-900" : "border-border bg-card text-muted-foreground")}
                >
                  {t(lang, "internalAdminsInactive")}
                </button>
              </div>
            </label>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "internalAdminsDistrictsLabel")}</p>
              <div className="mt-2 max-h-44 overflow-y-auto rounded-2xl border border-border bg-muted p-2">
                {districts.map((d) => {
                  const on = editDistrictIds.includes(d.id as string);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDistrict(d.id as string, setEditDistrictIds, editDistrictIds)}
                      className={clsx(
                        "m-1 inline-flex min-h-[36px] items-center rounded-xl border px-3 py-1 text-xs font-black",
                        on ? "border-waka-300 bg-waka-50 text-waka-900" : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {editMsg ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{editMsg}</p> : null}

            <button
              type="button"
              disabled={!editTargetId || editBusyId === editTargetId}
              onClick={() => void submitEdit()}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-waka-600 px-4 py-3 text-base font-black text-white shadow-waka-sm disabled:opacity-40"
            >
              {editBusyId === editTargetId ? "…" : t(lang, "internalAdminsSaveChanges")}
            </button>
          </div>
        ) : null}
      </AdminRightDrawer>
    </div>
  );
}

