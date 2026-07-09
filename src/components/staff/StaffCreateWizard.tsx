import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { BusinessType, Language, UserRole } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { PinInput } from "../ui/PinInput";
import {
  WIZARD_STEPS,
  generateStaffPin,
  roleAccentClasses,
  roleIconClasses,
  staffCreateRolesForBusiness,
  staffInitials,
  staffRoleCard,
  stepIndex,
  stepLabelKey,
  type StaffCreateRole,
  type StaffWizardStep,
} from "../../lib/staffRoleCatalog";
import { defaultRoleTemplateForIndustry, resolveRoleIndustry } from "../../lib/enterpriseRoles";
import { WakaSwitch } from "../enterprise/WakaSwitch";

export type CreatedStaffResult = {
  name: string;
  role: UserRole;
  roleTemplateId: string;
  pin: string;
};

type Props = {
  lang: Language;
  businessType: BusinessType;
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    role: StaffCreateRole;
    roleTemplateId: string;
    pin: string;
    phone?: string;
    password?: string;
    username?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onDone: () => void;
  staffCanRecordCashExpenses: boolean;
  requireCashierExpenseApproval: boolean;
  onExpensePrefsChange: (patch: {
    staffCanRecordCashExpenses?: boolean;
    requireCashierExpenseApproval?: boolean;
  }) => void;
};

const fieldClass =
  "w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3.5 text-base font-semibold text-stone-900 placeholder:text-stone-400 focus:border-waka-400 focus:outline-none focus:ring-2 focus:ring-waka-200";

export function StaffCreateWizard({
  lang,
  businessType,
  onCancel,
  onCreate,
  onDone,
  staffCanRecordCashExpenses,
  requireCashierExpenseApproval,
  onExpensePrefsChange,
}: Props) {
  const industry = resolveRoleIndustry(businessType);
  const roleOptions = useMemo(() => staffCreateRolesForBusiness(businessType), [businessType]);
  const defaultTemplate = useMemo(() => defaultRoleTemplateForIndustry(industry), [industry]);

  const [step, setStep] = useState<StaffWizardStep>("details");
  const [name, setName] = useState("");
  const [roleTemplateId, setRoleTemplateId] = useState(defaultTemplate.id);
  const [pin, setPin] = useState("");
  const [autoPin, setAutoPin] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advPhone, setAdvPhone] = useState("");
  const [advPassword, setAdvPassword] = useState("");
  const [advUsername, setAdvUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedStaffResult | null>(null);
  const [copied, setCopied] = useState(false);

  const roleDef = useMemo(() => staffRoleCard(roleTemplateId, businessType), [roleTemplateId, businessType]);
  const role = roleDef.baseRole;
  const displayPin = pin.length === 4 ? pin : autoPin ? "····" : "";

  const regenPin = useCallback(() => {
    const next = generateStaffPin();
    setPin(next);
    setAutoPin(true);
  }, []);

  useEffect(() => {
    setPin(generateStaffPin());
  }, []);

  const goDetails = () => setStep("details");
  const goPermissions = () => {
    if (!name.trim()) {
      setError(t(lang, "staffNameRequired"));
      return;
    }
    if (!autoPin && pin.length !== 4) {
      setError(t(lang, "staffPinMust4"));
      return;
    }
    if (autoPin && pin.length !== 4) regenPin();
    setError(null);
    setStep("permissions");
  };
  const goReview = () => {
    setError(null);
    setStep("review");
  };

  const handleCreate = async () => {
    const finalPin = pin.length === 4 ? pin : generateStaffPin();
    setBusy(true);
    setError(null);
    const res = await onCreate({
      name: name.trim(),
      role,
      roleTemplateId,
      pin: finalPin,
      phone: advancedOpen && advPhone.trim() ? advPhone.trim() : undefined,
      password: advancedOpen && advPassword.trim() ? advPassword.trim() : undefined,
      username: advancedOpen && advUsername.trim() ? advUsername.trim() : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? t(lang, "staffCreateFail"));
      return;
    }
    setCreated({ name: name.trim(), role, roleTemplateId, pin: finalPin });
  };

  const copyPin = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.pin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-lg space-y-5 pb-8">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" aria-hidden />
          </div>
          <h2 className="mt-4 text-2xl font-black text-stone-950">{t(lang, "staffSuccessTitle")}</h2>
          <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "staffWizardSuccessSub")}</p>
        </div>

        <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-waka-100 text-lg font-black text-waka-800">
              {staffInitials(created.name)}
            </div>
            <div>
              <p className="text-lg font-black text-stone-950">{created.name}</p>
              <span className="mt-0.5 inline-block rounded-full bg-waka-100 px-2.5 py-0.5 text-xs font-black uppercase tracking-wide text-waka-800">
                {t(lang, roleDef.labelKey)}
              </span>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-800">{t(lang, "staffSuccessPinReminder")}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="font-mono text-4xl font-black tracking-[0.35em] text-emerald-900">{created.pin}</span>
              <button
                type="button"
                onClick={() => void copyPin()}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-300 bg-white text-emerald-700"
                aria-label={t(lang, "staffWizardCopyPin")}
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {copied ? <p className="mt-1 text-xs font-bold text-emerald-700">{t(lang, "staffWizardCopied")}</p> : null}
          </div>
          <p className="mt-3 text-center text-sm font-medium text-stone-600">{t(lang, "staffWizardSharePinHint")}</p>
        </article>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setName("");
              setRoleTemplateId(defaultTemplate.id);
              setPin("");
              setAutoPin(true);
              setStep("details");
            }}
            className="min-h-[52px] rounded-2xl border-2 border-stone-200 bg-white text-sm font-black text-stone-800"
          >
            {t(lang, "staffSuccessAddAnother")}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="min-h-[52px] rounded-2xl bg-waka-600 text-sm font-black text-white shadow-waka-sm"
          >
            {t(lang, "staffSuccessDone")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-8">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={step === "details" ? onCancel : step === "permissions" ? goDetails : () => setStep("permissions")}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-700"
          aria-label={t(lang, "pageBack")}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black text-stone-950">{t(lang, "staffWizardTitle")}</h1>
          <p className="text-xs font-semibold text-stone-500">{t(lang, stepLabelKey(step))}</p>
        </div>
      </header>

      <nav aria-label={t(lang, "staffWizardProgress")} className="flex gap-2">
        {WIZARD_STEPS.map((s, i) => {
          const active = stepIndex(step) >= i;
          const current = step === s;
          return (
            <div key={s} className="flex-1">
              <div
                className={clsx(
                  "h-1.5 rounded-full transition",
                  active ? "bg-waka-500" : "bg-stone-200",
                  current && "ring-2 ring-waka-200",
                )}
              />
              <p className={clsx("mt-1 text-center text-[10px] font-black uppercase tracking-wide", active ? "text-waka-700" : "text-stone-400")}>
                {i + 1}. {t(lang, stepLabelKey(s))}
              </p>
            </div>
          );
        })}
      </nav>

      {step === "details" ? (
        <section className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <label className="block">
            <span className="text-sm font-bold text-stone-700">{t(lang, "staffNameLabel")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "staffNamePh")}
              className={`${fieldClass} mt-1.5`}
              autoComplete="name"
              autoFocus
            />
          </label>

          <div>
            <span className="text-sm font-bold text-stone-700">{t(lang, "staffRoleLabel")}</span>
            <div className="mt-2 space-y-2">
              {roleOptions.map((card) => {
                const selected = roleTemplateId === card.id;
                const Icon = card.Icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setRoleTemplateId(card.id)}
                    className={clsx(
                      "flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition",
                      roleAccentClasses(card.accent, selected),
                    )}
                  >
                    <div className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", roleIconClasses(card.accent, selected))}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-black text-stone-950">{t(lang, card.labelKey)}</p>
                      <p className="mt-0.5 text-sm font-medium text-stone-600">{t(lang, card.descriptionKey)}</p>
                    </div>
                    {selected ? <Check className="ml-auto h-5 w-5 shrink-0 text-waka-600" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-sm font-bold text-stone-700">{t(lang, "staffPinLabel")}</span>
            <div className="mt-1.5 flex gap-2">
              <PinInput
                value={autoPin ? pin : pin}
                onChange={(e) => {
                  setAutoPin(false);
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                }}
                placeholder={autoPin ? t(lang, "staffWizardAutoPinPlaceholder") : t(lang, "staffPinPh")}
                maxLength={4}
                autoComplete="off"
                disabled={autoPin}
                className={clsx(fieldClass, "flex-1 text-center font-mono text-2xl tracking-[0.35em]", autoPin && "bg-stone-50 text-stone-400")}
              />
              <button
                type="button"
                onClick={regenPin}
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border-2 border-stone-200 bg-stone-50 text-stone-700"
                aria-label={t(lang, "staffWizardRegenPin")}
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            </div>
            <WakaSwitch
              checked={autoPin}
              onCheckedChange={(on) => {
                setAutoPin(on);
                if (on) regenPin();
              }}
              label={t(lang, "staffWizardAutoPin")}
              className="mt-2 text-sm font-semibold text-stone-700"
            />
          </div>

          <details
            className="rounded-2xl border border-stone-100 bg-stone-50/80"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-stone-600 marker:hidden [&::-webkit-details-marker]:hidden">
              {t(lang, "staffAdvancedTitle")}
            </summary>
            <div className="space-y-3 border-t border-stone-100 px-4 pb-4 pt-3">
              <input value={advPhone} onChange={(e) => setAdvPhone(e.target.value)} placeholder={t(lang, "staffAdvancedPhone")} className={fieldClass} inputMode="tel" />
              <input value={advPassword} onChange={(e) => setAdvPassword(e.target.value)} placeholder={t(lang, "staffPasswordPh")} type="password" className={fieldClass} autoComplete="new-password" />
              <input
                value={advUsername}
                onChange={(e) => setAdvUsername(e.target.value.replace(/\s+/g, "").toLowerCase())}
                placeholder={t(lang, "staffAdvancedUsername")}
                className={fieldClass}
              />
            </div>
          </details>

          {error ? <p className="text-sm font-bold text-rose-700">{error}</p> : null}

          <button
            type="button"
            onClick={goPermissions}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 text-base font-black text-white shadow-waka-sm"
          >
            {t(lang, "staffWizardNextPermissions")}
            <ArrowRight className="h-5 w-5" />
          </button>
        </section>
      ) : null}

      {step === "permissions" ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-bold text-emerald-900">
              {tTemplate(lang, "staffWizardRoleSelected", { role: t(lang, `role_${role}`) })}
            </p>
          </div>

          <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "staffWizardCanDo")}</h2>
            <ul className="mt-3 space-y-2">
              {roleDef.allowedPermKeys.map((key) => (
                <li key={key} className="flex items-start gap-2 text-sm font-semibold text-stone-800">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  {t(lang, key)}
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "staffWizardCannotDo")}</h2>
            <ul className="mt-3 space-y-2">
              {roleDef.restrictedPermKeys.map((key) => (
                <li key={key} className="flex items-start gap-2 text-sm font-semibold text-stone-600">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                  {t(lang, key)}
                </li>
              ))}
            </ul>
          </article>

          {role === "cashier" ? (
            <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "staffWizardExtraPerms")}</h2>
              <WakaSwitch
                checked={staffCanRecordCashExpenses}
                onCheckedChange={(checked) => onExpensePrefsChange({ staffCanRecordCashExpenses: checked })}
                label={t(lang, "staffAllowCashierExpenses")}
                description={t(lang, "staffAllowCashierExpensesSub")}
                className="mt-3 rounded-2xl bg-stone-50 px-3 py-3"
              />
              <WakaSwitch
                checked={requireCashierExpenseApproval}
                disabled={!staffCanRecordCashExpenses}
                onCheckedChange={(checked) => onExpensePrefsChange({ requireCashierExpenseApproval: checked })}
                label={t(lang, "staffRequireExpenseApproval")}
                description={t(lang, "staffRequireExpenseApprovalSub")}
                className="mt-2 rounded-2xl bg-stone-50 px-3 py-3"
              />
            </article>
          ) : null}

          <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t(lang, "staffDeviceLocalTrust")}
          </p>

          <button
            type="button"
            onClick={goReview}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 text-base font-black text-white shadow-waka-sm"
          >
            {t(lang, "staffWizardNextReview")}
            <ArrowRight className="h-5 w-5" />
          </button>
        </section>
      ) : null}

      {step === "review" ? (
        <section className="space-y-4">
          <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "staffWizardReviewInfo")}</h2>
            <dl className="mt-3 space-y-3">
              <div className="flex justify-between gap-3 border-b border-stone-100 pb-2">
                <dt className="text-sm font-semibold text-stone-500">{t(lang, "staffNameLabel")}</dt>
                <dd className="text-sm font-black text-stone-950">{name.trim()}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-stone-100 pb-2">
                <dt className="text-sm font-semibold text-stone-500">{t(lang, "staffRoleLabel")}</dt>
                <dd className="text-sm font-black text-stone-950">{t(lang, `role_${role}`)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-sm font-semibold text-stone-500">{t(lang, "staffPinLabel")}</dt>
                <dd className="font-mono text-sm font-black tracking-widest text-stone-950">
                  {displayPin || (autoPin ? t(lang, "staffWizardAutoPin") : "—")}
                </dd>
              </div>
            </dl>
          </article>

          <article className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "staffWizardThisStaffCan")}</h2>
            <ul className="mt-3 space-y-1.5">
              {roleDef.allowedPermKeys.slice(0, 4).map((key) => (
                <li key={key} className="flex items-center gap-2 text-sm font-semibold text-stone-800">
                  <Check className="h-4 w-4 text-emerald-600" />
                  {t(lang, key)}
                </li>
              ))}
            </ul>
          </article>

          {error ? <p className="text-sm font-bold text-rose-700">{error}</p> : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
          >
            <UserPlus className="h-5 w-5" />
            {busy ? t(lang, "saving") : t(lang, "staffCreateCta")}
          </button>
        </section>
      ) : null}
    </div>
  );
}
