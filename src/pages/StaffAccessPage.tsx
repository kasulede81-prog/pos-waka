import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import type { Language, UserRole } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";

const ROLE_OPTIONS: UserRole[] = ["cashier", "manager", "stock_keeper"];

const fieldClass =
  "w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-lg font-semibold text-slate-900 placeholder:text-slate-400 focus:border-waka-400 focus:outline-none focus:ring-2 focus:ring-waka-200";

type CreatedStaff = { name: string; role: UserRole; pin: string };

export function StaffAccessPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canManage = hasPermission(actor.role, "settings.shop");
  const staff = usePosStore((s) => s.preferences.staffAccounts ?? []);
  const addStaffAccount = usePosStore((s) => s.addStaffAccount);
  const updateStaffAccount = usePosStore((s) => s.updateStaffAccount);
  const resetStaffSecret = usePosStore((s) => s.resetStaffSecret);

  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("cashier");
  const [pin, setPin] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advPhone, setAdvPhone] = useState("");
  const [advPassword, setAdvPassword] = useState("");
  const [advUsername, setAdvUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedStaff | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);

  const ordered = useMemo(() => [...staff].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [staff]);

  const resetForm = () => {
    setName("");
    setRole("cashier");
    setPin("");
    setAdvPhone("");
    setAdvPassword("");
    setAdvUsername("");
    setAdvancedOpen(false);
    setMsg(null);
  };

  const handleCreate = () => {
    setMsg(null);
    const res = addStaffAccount({
      name,
      role,
      pin,
      phone: advancedOpen ? advPhone : undefined,
      password: advancedOpen && advPassword.trim() ? advPassword : undefined,
      username: advancedOpen && advUsername.trim() ? advUsername : undefined,
    });
    if (!res.ok) {
      const errKey = res.errorKey ?? "staffCreateFail";
      setMsg(t(lang, errKey as "staffCreateFail"));
      return;
    }
    setCreated({ name: name.trim(), role, pin });
    resetForm();
  };

  if (!canManage) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "staffAccessTitle")}
        subtitle={t(lang, "staffAccessSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      {created ? (
        <section className="rounded-3xl border-2 border-emerald-100 bg-emerald-50/80 p-5 shadow-waka-sm">
          <p className="text-center text-2xl">✅</p>
          <p className="mt-2 text-center text-xl font-black text-slate-900">{t(lang, "staffSuccessTitle")}</p>
          <dl className="mt-4 space-y-3 rounded-2xl bg-white p-4">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "staffNameLabel")}</dt>
              <dd className="text-lg font-black text-slate-900">{created.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "staffRoleLabel")}</dt>
              <dd className="text-lg font-black text-slate-900">{t(lang, `role_${created.role}`)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "staffSuccessPinReminder")}</dt>
              <dd className="font-mono text-3xl font-black tracking-[0.35em] text-waka-700">{created.pin}</dd>
            </div>
          </dl>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="min-h-[52px] rounded-2xl border-2 border-waka-200 bg-white py-3 text-base font-black text-waka-800"
              onClick={() => {
                setCreated(null);
              }}
            >
              {t(lang, "staffSuccessAddAnother")}
            </button>
            <button
              type="button"
              className="min-h-[52px] rounded-2xl bg-waka-600 py-3 text-base font-black text-white shadow-waka-sm"
              onClick={() => setCreated(null)}
            >
              {t(lang, "staffSuccessDone")}
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border-2 border-waka-100 bg-white p-4 shadow-waka-sm sm:p-5">
          <p className="text-lg font-black text-slate-900">{t(lang, "staffCreateTitle")}</p>

          <label className="mt-4 block">
            <span className="text-sm font-bold text-slate-600">{t(lang, "staffNameLabel")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "staffNamePh")}
              className={`${fieldClass} mt-1`}
              autoComplete="name"
            />
          </label>

          <div className="mt-4">
            <span className="text-sm font-bold text-slate-600">{t(lang, "staffRoleLabel")}</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {ROLE_OPTIONS.map((r) => {
                const on = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`min-h-[48px] rounded-2xl border-2 px-2 py-2.5 text-sm font-black leading-tight transition ${
                      on
                        ? "border-waka-500 bg-waka-50 text-waka-900 shadow-sm"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {t(lang, `role_${r}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-bold text-slate-600">{t(lang, "staffPinLabel")}</span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder={t(lang, "staffPinPh")}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              className={`${fieldClass} mt-1 text-center font-mono text-2xl tracking-[0.4em]`}
              autoComplete="off"
            />
            <p className="mt-1 text-xs font-semibold text-slate-500">{t(lang, "staffPinHint")}</p>
          </label>

          <details
            className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/80"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-600 marker:hidden [&::-webkit-details-marker]:hidden">
              {t(lang, "staffAdvancedTitle")}
            </summary>
            <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
              <input
                value={advPhone}
                onChange={(e) => setAdvPhone(e.target.value)}
                placeholder={t(lang, "staffAdvancedPhone")}
                className={fieldClass}
                inputMode="tel"
              />
              <input
                value={advPassword}
                onChange={(e) => setAdvPassword(e.target.value)}
                placeholder={t(lang, "staffPasswordPh")}
                type="password"
                className={fieldClass}
                autoComplete="new-password"
              />
              <input
                value={advUsername}
                onChange={(e) => setAdvUsername(e.target.value.replace(/\s+/g, "").toLowerCase())}
                placeholder={t(lang, "staffAdvancedUsername")}
                className={fieldClass}
              />
              <p className="text-xs font-semibold text-slate-500">{t(lang, "staffAdvancedPermissions")}</p>
              <p className="text-xs font-semibold text-slate-400">{t(lang, "staffAdvancedDevices")}</p>
            </div>
          </details>

          {msg ? <p className="mt-3 text-sm font-bold text-red-700">{msg}</p> : null}

          <button
            type="button"
            disabled={!name.trim() || pin.length !== 4}
            className="mt-4 min-h-[56px] w-full rounded-2xl bg-waka-600 py-4 text-lg font-black text-white shadow-waka-sm disabled:opacity-40"
            onClick={handleCreate}
          >
            {t(lang, "staffCreateCta")}
          </button>
        </section>
      )}

      {ordered.length > 0 ? (
        <section className="space-y-2">
          <p className="px-1 text-sm font-black uppercase tracking-wide text-slate-500">{t(lang, "staffYourTeam")}</p>
          {ordered.map((s) => (
            <article key={s.id} className="rounded-3xl border-2 border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-black text-slate-900">{s.name}</p>
                  <p className="text-sm font-semibold text-slate-500">{t(lang, `role_${s.role}`)}</p>
                </div>
                <label className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => updateStaffAccount(s.id, { active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  {s.active ? t(lang, "staffActive") : t(lang, "staffInactive")}
                </label>
              </div>
              <button
                type="button"
                className="mt-2 text-sm font-bold text-waka-700"
                onClick={() => setManageId(manageId === s.id ? null : s.id)}
              >
                {t(lang, "staffManage")}
              </button>
              {manageId === s.id ? (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <select
                    value={s.role}
                    onChange={(e) => updateStaffAccount(s.id, { role: e.target.value as UserRole })}
                    className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-semibold"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {t(lang, `role_${r}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-bold"
                    onClick={() => {
                      const nextPin = window.prompt(t(lang, "staffPinResetPrompt")) ?? "";
                      if (nextPin.replace(/\D/g, "").length < 4) return;
                      resetStaffSecret(s.id, { pin: nextPin.replace(/\D/g, "").slice(0, 4), password: null });
                    }}
                  >
                    {t(lang, "staffResetPin")}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-bold"
                    onClick={() => {
                      const nextPass = window.prompt(t(lang, "staffPasswordResetPrompt")) ?? "";
                      if (!nextPass) return;
                      resetStaffSecret(s.id, { password: nextPass });
                    }}
                  >
                    {t(lang, "staffResetPassword")}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
