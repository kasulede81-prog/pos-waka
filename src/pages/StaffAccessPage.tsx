import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import type { Language, UserRole } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";

const ROLE_OPTIONS: UserRole[] = ["owner", "manager", "cashier", "stock_keeper"];

export function StaffAccessPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canManage = hasPermission(actor.role, "settings.shop");
  const staff = usePosStore((s) => s.preferences.staffAccounts ?? []);
  const addStaffAccount = usePosStore((s) => s.addStaffAccount);
  const updateStaffAccount = usePosStore((s) => s.updateStaffAccount);
  const resetStaffSecret = usePosStore((s) => s.resetStaffSecret);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole>("cashier");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const ordered = useMemo(() => [...staff].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [staff]);

  if (!canManage) return <Navigate to="/" replace />;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "staffAccessTitle")}
        subtitle={t(lang, "staffAccessSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <section className="rounded-3xl border-2 border-waka-100 bg-white p-5 shadow-waka-sm">
        <p className="text-lg font-black text-slate-900">{t(lang, "staffCreateTitle")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(lang, "staffNamePh")} className="rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg" />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "").toLowerCase())}
            placeholder="username (e.g cashier01)"
            className="rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
          />
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-semibold">
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {t(lang, `role_${r}`)}
              </option>
            ))}
          </select>
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t(lang, "staffPinPh")} className="rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t(lang, "staffPasswordPh")} className="rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t(lang, "personPhonePh")} className="rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg sm:col-span-2" />
        </div>
        {msg ? <p className="mt-2 text-sm font-bold text-waka-900">{msg}</p> : null}
        <button
          type="button"
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
          onClick={() => {
            const res = addStaffAccount({ name, username, role, pin, password, phone });
            if (!res.ok) {
              setMsg(t(lang, "staffCreateFail"));
              return;
            }
            setName("");
            setUsername("");
            setPin("");
            setPassword("");
            setPhone("");
            setRole("cashier");
            setMsg(t(lang, "staffCreateOk"));
          }}
        >
          {t(lang, "staffCreateCta")}
        </button>
      </section>

      <section className="space-y-3">
        {ordered.map((s) => (
          <article key={s.id} className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xl font-black text-slate-900">{s.name}</p>
                <p className="text-sm font-semibold text-slate-500">{t(lang, `role_${s.role}`)}</p>
                {s.username ? <p className="text-xs font-semibold text-slate-400">@{s.username}</p> : null}
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={(e) => updateStaffAccount(s.id, { active: e.target.checked })}
                  className="h-5 w-5"
                />
                {s.active ? t(lang, "staffActive") : t(lang, "staffInactive")}
              </label>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <select value={s.role} onChange={(e) => updateStaffAccount(s.id, { role: e.target.value as UserRole })} className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-semibold">
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
                  if (!nextPin) return;
                  resetStaffSecret(s.id, { pin: nextPin, password: null });
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
          </article>
        ))}
      </section>
    </div>
  );
}

