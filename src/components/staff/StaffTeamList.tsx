import { useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import clsx from "clsx";
import type { Language, StaffAccount, UserRole } from "../../types";
import { t } from "../../lib/i18n";
import { staffInitials } from "../../lib/staffRoleCatalog";

const ROLE_OPTIONS: UserRole[] = ["cashier", "manager", "stock_keeper"];

type Props = {
  lang: Language;
  staff: StaffAccount[];
  maxStaff: number;
  onAddStaff: () => void;
  onToggleActive: (id: string, active: boolean) => void;
  onUpdateRole: (id: string, role: UserRole) => void;
  onResetPin: (id: string) => void;
  onResetPassword: (id: string) => void;
  onDelete: (id: string) => void;
};

export function StaffTeamList({
  lang,
  staff,
  maxStaff,
  onAddStaff,
  onToggleActive,
  onUpdateRole,
  onResetPin,
  onResetPassword,
  onDelete,
}: Props) {
  const [query, setQuery] = useState("");
  const [manageId, setManageId] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...staff]
      .filter((s) => !q || s.name.toLowerCase().includes(q) || t(lang, `role_${s.role}`).toLowerCase().includes(q))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [lang, query, staff]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "staffYourTeam")}</p>
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
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "staffTeamSearch")}
          className="w-full rounded-2xl border-2 border-stone-200 bg-white py-3 pl-10 pr-4 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-waka-400 focus:outline-none"
        />
      </label>

      {ordered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-semibold text-stone-500">
          {t(lang, "staffTeamEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((s) => {
            const open = manageId === s.id;
            return (
              <li key={s.id} className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-sm font-black text-stone-700">
                    {staffInitials(s.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-stone-950">{s.name}</p>
                    <p className="text-sm font-semibold text-stone-500">{t(lang, `role_${s.role}`)}</p>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
                      s.active ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800",
                    )}
                  >
                    {s.active ? t(lang, "staffActive") : t(lang, "staffInactive")}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-700">
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) => onToggleActive(s.id, e.target.checked)}
                      className="h-4 w-4"
                    />
                    {s.active ? t(lang, "staffActive") : t(lang, "staffInactive")}
                  </label>
                  <button
                    type="button"
                    className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-waka-700"
                    onClick={() => setManageId(open ? null : s.id)}
                  >
                    {open ? t(lang, "staffManageClose") : t(lang, "staffManage")}
                  </button>
                </div>

                {open ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                    <select
                      value={s.role}
                      onChange={(e) => onUpdateRole(s.id, e.target.value as UserRole)}
                      className="rounded-xl border-2 border-stone-200 px-3 py-2 text-sm font-semibold"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {t(lang, `role_${r}`)}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="rounded-xl border-2 border-stone-200 px-3 py-2 text-sm font-bold" onClick={() => onResetPin(s.id)}>
                      {t(lang, "staffResetPin")}
                    </button>
                    <button type="button" className="rounded-xl border-2 border-stone-200 px-3 py-2 text-sm font-bold" onClick={() => onResetPassword(s.id)}>
                      {t(lang, "staffResetPassword")}
                    </button>
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
