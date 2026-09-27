import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { BottomSheet } from "../primitives";
import {
  fetchLoyaltyAdminShopStates,
  fetchLoyaltyPlanImpact,
  type LoyaltyAdminPlan,
  type LoyaltyAdminShopDetail,
  type LoyaltyAdminShopState,
  type LoyaltyPlanImpact,
} from "../../../../lib/loyaltyAdmin";
import {
  LOYALTY_ADMIN_REASON_MAX,
  createLoyaltyPlan,
  describeLoyaltyAdminError,
  isImpactCurrent,
  setLoyaltyPlanActive,
  setShopLoyaltyEntitlement,
  shopsOverProposedLimit,
  updateLoyaltyPlan,
  validateAdminReason,
  validatePlanDraft,
  type LoyaltyAdminMutationResult,
  type LoyaltyPlanDraft,
} from "../../../../lib/loyaltyAdminActions";

/**
 * Phase 6C — the confirmation dialogs behind every Loyalty control-plane action.
 *
 * Each dialog walks the same path: show the current state, show the proposed state and its
 * measured impact, require a reason, then call ONE Phase 6A RPC. The RPC is the authority
 * (authorization, validation, mutation, audit, atomicity); these dialogs only make sure an
 * admin never applies a change without seeing what it does. On success the parent reloads
 * every figure from the server rather than patching local state.
 */

const nf = (n: number) => n.toLocaleString();

const inputCls =
  "min-h-[42px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground disabled:opacity-60";
const primaryBtn =
  "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-black text-background disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtn =
  "inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn =
  "inline-flex min-h-[42px] items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-black text-foreground disabled:opacity-50";

export type LoyaltyActionDone = (message: string) => void;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <span className="mt-1 block text-xs font-bold text-rose-700">{error}</span> : null}
    </label>
  );
}

function ReasonField({
  value,
  onChange,
  disabled,
  touched,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  touched: boolean;
}) {
  const error = validateAdminReason(value);
  return (
    <Field label="Reason (required — recorded in the internal audit log)" error={touched ? error ?? undefined : undefined}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={LOYALTY_ADMIN_REASON_MAX}
        rows={3}
        placeholder="e.g. Merchant upgraded to the Business plan — ticket #1234"
        className={`${inputCls} py-2`}
      />
      <span className="mt-1 block text-right text-[11px] font-semibold text-muted-foreground">
        {value.trim().length}/{LOYALTY_ADMIN_REASON_MAX}
      </span>
    </Field>
  );
}

/** The invariant every Loyalty control-plane change keeps. Shown on every confirmation. */
export function DataSafetyNotice() {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-bold text-emerald-900">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4" aria-hidden />
        Existing data is preserved
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 font-semibold">
        <li>Existing members are NOT automatically removed, even if they exceed a limit.</li>
        <li>Existing points, rewards and transaction history are unchanged.</li>
        <li>Wallet passes, Wallet IDs and QR identities are preserved.</li>
        <li>Only the plan / entitlement (control-plane) state changes.</li>
      </ul>
    </div>
  );
}

function ServerError({ error }: { error: { code: string; details?: Record<string, unknown> } | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        {describeLoyaltyAdminError(error.code, error.details)}
        <span className="ml-1 text-[11px] font-semibold text-rose-700">({error.code})</span>
      </span>
    </div>
  );
}

function DiffTable({ rows }: { rows: Array<{ label: string; current: string; proposed: string }> }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="py-1.5 pr-3 font-black" />
          <th className="py-1.5 pr-3 font-black">Current</th>
          <th className="py-1.5 font-black">Proposed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const changed = r.current !== r.proposed;
          return (
            <tr key={r.label} className="border-b border-border/60">
              <td className="py-1.5 pr-3 text-[11px] font-black uppercase text-muted-foreground">{r.label}</td>
              <td className="py-1.5 pr-3 text-muted-foreground">{r.current}</td>
              <td className={`py-1.5 ${changed ? "font-black text-foreground" : "text-muted-foreground"}`}>{r.proposed}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Acknowledge({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

type ServerErr = { code: string; details?: Record<string, unknown> } | null;

/**
 * One in-flight guard + result handling for every dialog, so a double-click cannot send a
 * mutation twice and a refused call never looks like a success.
 */
function useMutation() {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<ServerErr>(null);
  const run = async <T,>(call: () => Promise<LoyaltyAdminMutationResult<T>>, onOk: (data: T) => void) => {
    if (submitting) return;
    setSubmitting(true);
    setServerError(null);
    const r = await call();
    setSubmitting(false);
    if (r.ok) onOk(r.data);
    else setServerError({ code: r.error, details: r.details });
  };
  return { submitting, serverError, setServerError, run };
}

// ---------------------------------------------------------------------------
// Plan create / edit
// ---------------------------------------------------------------------------

function draftFromPlan(plan: LoyaltyAdminPlan | null, nextSort: number): LoyaltyPlanDraft {
  return plan
    ? {
        code: plan.code,
        name: plan.name,
        memberLimit: plan.memberLimit,
        monthlyPriceUgx: plan.monthlyPriceUgx,
        annualPriceUgx: plan.annualPriceUgx,
        sortOrder: plan.sortOrder,
      }
    : { code: "", name: "", memberLimit: 50, monthlyPriceUgx: 0, annualPriceUgx: 0, sortOrder: nextSort };
}

function toInt(v: string): number {
  if (v.trim() === "") return Number.NaN;
  return Number(v);
}

export function PlanEditorSheet({
  open,
  plan,
  nextSortOrder,
  onClose,
  onDone,
}: {
  open: boolean;
  /** null = create a new plan. */
  plan: LoyaltyAdminPlan | null;
  nextSortOrder: number;
  onClose: () => void;
  onDone: LoyaltyActionDone;
}) {
  const mode = plan ? "edit" : "create";
  const [draft, setDraft] = useState<LoyaltyPlanDraft>(() => draftFromPlan(plan, nextSortOrder));
  const [step, setStep] = useState<"form" | "review">("form");
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [formTouched, setFormTouched] = useState(false);
  const [impact, setImpact] = useState<LoyaltyPlanImpact | null>(null);
  const [overShops, setOverShops] = useState<Array<LoyaltyAdminShopState & { overBy: number }>>([]);
  const [overShopsTruncated, setOverShopsTruncated] = useState(false);
  const [impactState, setImpactState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [ack, setAck] = useState(false);
  const impactRequest = useRef(0);
  const { submitting, serverError, setServerError, run } = useMutation();

  useEffect(() => {
    if (!open) return;
    impactRequest.current += 1;
    setDraft(draftFromPlan(plan, nextSortOrder));
    setStep("form");
    setReason("");
    setReasonTouched(false);
    setFormTouched(false);
    setImpact(null);
    setOverShops([]);
    setImpactState("idle");
    setAck(false);
    setServerError(null);
  }, [open, plan, nextSortOrder, setServerError]);

  const errors = validatePlanDraft(draft, mode);
  const hasErrors = Object.keys(errors).length > 0;
  const limitChanged = plan != null && draft.memberLimit !== plan.memberLimit;
  const limitReduced = plan != null && draft.memberLimit < plan.memberLimit;
  const unchanged =
    plan != null &&
    draft.name.trim() === plan.name &&
    draft.memberLimit === plan.memberLimit &&
    draft.monthlyPriceUgx === plan.monthlyPriceUgx &&
    draft.annualPriceUgx === plan.annualPriceUgx &&
    draft.sortOrder === plan.sortOrder;

  const goReview = async () => {
    setFormTouched(true);
    if (hasErrors || unchanged) return;
    setStep("review");
    setAck(false);
    setServerError(null);
    if (!plan || !limitChanged) {
      setImpactState("idle");
      return;
    }
    // Measure the blast radius of the proposed limit before anything can be applied.
    setImpactState("loading");
    setImpact(null);
    const token = ++impactRequest.current;
    const [imp, states] = await Promise.all([
      fetchLoyaltyPlanImpact(plan.code, draft.memberLimit),
      fetchLoyaltyAdminShopStates("", "enabled", 100),
    ]);
    // A slower response for an earlier draft must never overwrite the current measurement.
    if (token !== impactRequest.current) return;
    if (!imp.ok) {
      setImpactState("failed");
      return;
    }
    setImpact(imp.data);
    const list = states.ok ? states.data : [];
    setOverShops(shopsOverProposedLimit(list, plan, draft.memberLimit));
    setOverShopsTruncated(!states.ok || list.length >= 100);
    setImpactState("ready");
  };

  const needsAck = impactState === "ready" && (impact?.shopsOverLimit ?? 0) > 0;
  // A limit reduction whose impact could not be measured is never applied blind.
  const impactBlocks =
    limitChanged && (impactState !== "ready" || !isImpactCurrent(impact, plan!.code, draft.memberLimit));
  const reasonError = validateAdminReason(reason);
  const canConfirm = !submitting && !reasonError && !impactBlocks && (!needsAck || ack);

  const confirm = () => {
    setReasonTouched(true);
    if (!canConfirm) return;
    void run(
      () => (mode === "create" ? createLoyaltyPlan(draft, reason) : updateLoyaltyPlan(draft, reason)),
      (data) => {
        onDone(
          mode === "create"
            ? `Plan "${data.code}" created. It is active and can now be assigned.`
            : `Plan "${data.code}" updated${data.memberLimitChanged ? " — the new member limit now applies" : ""}.`,
        );
      },
    );
  };

  const set = <K extends keyof LoyaltyPlanDraft>(k: K, v: LoyaltyPlanDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const shownErr = (k: keyof LoyaltyPlanDraft) => (formTouched ? errors[k] : undefined);

  return (
    <BottomSheet
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={mode === "create" ? "Create Loyalty plan" : `Edit plan — ${plan?.name ?? ""}`}
      subtitle="Internal control plane · changes are audited"
      wide
    >
      {step === "form" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" error={shownErr("code")}>
              <input
                className={inputCls}
                value={draft.code}
                onChange={(e) => set("code", e.target.value)}
                disabled={mode === "edit"}
                placeholder="e.g. enterprise"
              />
            </Field>
            <Field label="Name" error={shownErr("name")}>
              <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Member limit" error={shownErr("memberLimit")}>
              <input
                className={inputCls}
                inputMode="numeric"
                value={Number.isNaN(draft.memberLimit) ? "" : String(draft.memberLimit)}
                onChange={(e) => set("memberLimit", toInt(e.target.value))}
              />
            </Field>
            <Field label="Sort order" error={shownErr("sortOrder")}>
              <input
                className={inputCls}
                inputMode="numeric"
                value={Number.isNaN(draft.sortOrder) ? "" : String(draft.sortOrder)}
                onChange={(e) => set("sortOrder", toInt(e.target.value))}
              />
            </Field>
            <Field label="Monthly price (UGX)" error={shownErr("monthlyPriceUgx")}>
              <input
                className={inputCls}
                inputMode="numeric"
                value={Number.isNaN(draft.monthlyPriceUgx) ? "" : String(draft.monthlyPriceUgx)}
                onChange={(e) => set("monthlyPriceUgx", toInt(e.target.value))}
              />
            </Field>
            <Field label="Annual price (UGX)" error={shownErr("annualPriceUgx")}>
              <input
                className={inputCls}
                inputMode="numeric"
                value={Number.isNaN(draft.annualPriceUgx) ? "" : String(draft.annualPriceUgx)}
                onChange={(e) => set("annualPriceUgx", toInt(e.target.value))}
              />
            </Field>
          </div>
          {mode === "edit" && limitReduced ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
              You are lowering a GLOBAL limit. Every organization on this plan is affected; the impact is measured on the
              next step before anything is saved.
            </p>
          ) : null}
          {formTouched && unchanged ? (
            <p className="text-xs font-bold text-muted-foreground">Nothing has changed yet.</p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={secondaryBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={primaryBtn} onClick={() => void goReview()}>
              Review change
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <DiffTable
            rows={[
              ...(mode === "create" ? [{ label: "Code", current: "—", proposed: draft.code.trim().toLowerCase() }] : []),
              { label: "Name", current: plan?.name ?? "—", proposed: draft.name.trim() },
              { label: "Member limit", current: plan ? nf(plan.memberLimit) : "—", proposed: nf(draft.memberLimit) },
              { label: "Monthly", current: plan ? nf(plan.monthlyPriceUgx) : "—", proposed: nf(draft.monthlyPriceUgx) },
              { label: "Annual", current: plan ? nf(plan.annualPriceUgx) : "—", proposed: nf(draft.annualPriceUgx) },
              { label: "Sort", current: plan ? String(plan.sortOrder) : "—", proposed: String(draft.sortOrder) },
              ...(mode === "create" ? [{ label: "State", current: "—", proposed: "active (not default)" }] : []),
            ]}
          />

          {plan ? (
            <p className="text-xs font-semibold text-muted-foreground">
              Currently used by {nf(plan.organizations)} organization(s) · {nf(plan.shops)} shop(s)
              {plan.isDefault ? " — including organizations with no explicit plan (this is the default plan)" : ""}.
            </p>
          ) : null}

          {limitChanged ? (
            impactState === "loading" ? (
              <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Measuring the impact of a limit of {nf(draft.memberLimit)}…
              </div>
            ) : impactState === "failed" ? (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">
                The impact of this limit change could not be measured, so it cannot be applied. Go back and try again.
              </div>
            ) : impact ? (
              <div className="space-y-2">
                <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                  Impact at the proposed limit of {nf(impact.proposedMemberLimit)}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { l: "Organizations", v: impact.organizations, warn: false },
                    { l: "Shops", v: impact.shops, warn: false },
                    { l: "Shops over limit", v: impact.shopsOverLimit, warn: impact.shopsOverLimit > 0 },
                    { l: "Members over limit", v: impact.membersOverLimit, warn: impact.membersOverLimit > 0 },
                  ].map((m) => (
                    <div
                      key={m.l}
                      className={`rounded-xl border p-2 ${m.warn ? "border-rose-200 bg-rose-50/60" : "border-border bg-card"}`}
                    >
                      <p className={`text-[10px] font-black uppercase ${m.warn ? "text-rose-800" : "text-muted-foreground"}`}>{m.l}</p>
                      <p className={`text-lg font-black ${m.warn ? "text-rose-900" : "text-foreground"}`}>{nf(m.v)}</p>
                    </div>
                  ))}
                </div>
                {overShops.length > 0 ? (
                  <div className="rounded-xl border border-rose-200 bg-card p-2">
                    <p className="text-[11px] font-black uppercase tracking-wide text-rose-800">Shops over the proposed limit</p>
                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                      {overShops.map((s) => (
                        <li key={s.shopId} className="flex justify-between gap-2">
                          <span className="font-bold text-foreground">
                            {s.shopName} <span className="font-semibold text-muted-foreground">· {s.organizationName}</span>
                          </span>
                          <span className="tabular-nums font-black text-rose-700">
                            {nf(s.activeMembers)} / {nf(draft.memberLimit)} (+{nf(s.overBy)})
                          </span>
                        </li>
                      ))}
                    </ul>
                    {overShopsTruncated ? (
                      <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                        List drawn from the first 100 enabled shops; the totals above are authoritative.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {needsAck ? (
                  <Acknowledge checked={ack} onChange={setAck}>
                    I understand {nf(impact.shopsOverLimit)} shop(s) will be over this limit. Their existing{" "}
                    {nf(impact.membersOverLimit)} extra member(s) stay enrolled, but those shops cannot add new members
                    until they are under the limit.
                  </Acknowledge>
                ) : null}
              </div>
            ) : null
          ) : null}

          <DataSafetyNotice />
          <ReasonField value={reason} onChange={setReason} disabled={submitting} touched={reasonTouched} />
          <ServerError error={serverError} />

          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryBtn} onClick={() => setStep("form")} disabled={submitting}>
              Back
            </button>
            <button type="button" className={primaryBtn} onClick={confirm} disabled={!canConfirm && reasonTouched}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {mode === "create" ? "Create plan" : "Save plan"}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Plan activate / deactivate
// ---------------------------------------------------------------------------

export function PlanActiveSheet({
  plan,
  onClose,
  onDone,
}: {
  plan: LoyaltyAdminPlan | null;
  onClose: () => void;
  onDone: LoyaltyActionDone;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const { submitting, serverError, setServerError, run } = useMutation();

  useEffect(() => {
    setReason("");
    setTouched(false);
    setServerError(null);
  }, [plan, setServerError]);

  if (!plan) return null;
  const activating = !plan.isActive;
  // The default plan can never be deactivated (server: tier_is_default); say so up front.
  const blocked = !activating && plan.isDefault;
  const canConfirm = !submitting && !blocked && !validateAdminReason(reason);

  const confirm = () => {
    setTouched(true);
    if (!canConfirm) return;
    void run(
      () => setLoyaltyPlanActive(plan.code, activating, reason),
      () =>
        onDone(
          activating
            ? `Plan "${plan.code}" activated. It can now be assigned to organizations.`
            : `Plan "${plan.code}" deactivated. It can no longer be assigned.`,
        ),
    );
  };

  return (
    <BottomSheet
      open
      onClose={submitting ? () => undefined : onClose}
      title={`${activating ? "Activate" : "Deactivate"} plan — ${plan.name}`}
      subtitle="Internal control plane · changes are audited"
    >
      <div className="space-y-4">
        <DiffTable rows={[{ label: "State", current: plan.isActive ? "active" : "inactive", proposed: activating ? "active" : "inactive" }]} />
        <p className="text-xs font-semibold text-muted-foreground">
          {activating
            ? "An active plan can be assigned to organizations. Activating changes no organization's current plan."
            : `Deactivation is refused by the server while any organization is assigned to this plan, for the default plan, and for the last active plan. Currently reaches ${nf(plan.organizations)} organization(s) · ${nf(plan.shops)} shop(s).`}
        </p>
        {blocked ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">
            {describeLoyaltyAdminError("tier_is_default")}
          </div>
        ) : null}
        <DataSafetyNotice />
        <ReasonField value={reason} onChange={setReason} disabled={submitting || blocked} touched={touched} />
        <ServerError error={serverError} />
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={activating ? primaryBtn : dangerBtn}
            onClick={confirm}
            disabled={blocked || (touched && !canConfirm)}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {activating ? "Activate plan" : "Deactivate plan"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Shop entitlement: enable / change plan / disable
// ---------------------------------------------------------------------------

export function ShopEntitlementSheet({
  shop,
  detail,
  plans,
  intent,
  onClose,
  onDone,
}: {
  shop: LoyaltyAdminShopState | null;
  detail: LoyaltyAdminShopDetail | null;
  plans: LoyaltyAdminPlan[];
  intent: "enable" | "disable";
  onClose: () => void;
  onDone: LoyaltyActionDone;
}) {
  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);
  const defaultPlan = plans.find((p) => p.isDefault) ?? null;
  const currentPlanCode = shop?.tierCode ?? defaultPlan?.code ?? null;
  const currentPlan = plans.find((p) => p.code === currentPlanCode) ?? null;

  const [planCode, setPlanCode] = useState<string>("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [ack, setAck] = useState(false);
  const [siblings, setSiblings] = useState<LoyaltyAdminShopState[] | null>(null);
  const [siblingsFailed, setSiblingsFailed] = useState(false);
  const [siblingsTruncated, setSiblingsTruncated] = useState(false);
  const { submitting, serverError, setServerError, run } = useMutation();

  useEffect(() => {
    if (!shop) return;
    const preferred = activePlans.find((p) => p.code === currentPlanCode) ?? activePlans.find((p) => p.isDefault) ?? activePlans[0];
    setPlanCode(preferred?.code ?? "");
    setReason("");
    setTouched(false);
    setAck(false);
    setServerError(null);
    setSiblings(null);
    setSiblingsFailed(false);
    setSiblingsTruncated(false);
    // The entitlement is ORGANIZATION-wide: load every shop of this organization so the
    // admin sees the whole blast radius, not just the row they clicked.
    let cancelled = false;
    void fetchLoyaltyAdminShopStates(shop.organizationName, "all", 100).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setSiblingsFailed(true);
        setSiblings([shop]);
        return;
      }
      const mine = r.data.filter((s) => s.organizationId === shop.organizationId);
      setSiblings(mine.length > 0 ? mine : [shop]);
      // The search is capped at 100 rows (and matches other organizations' names too), so a
      // full page means this organization's list may be incomplete — say so, never imply "all".
      setSiblingsTruncated(r.data.length >= 100);
    });
    return () => {
      cancelled = true;
    };
  }, [shop, activePlans, currentPlanCode, setServerError]);

  if (!shop) return null;

  const enabling = intent === "enable";
  const targetPlan = activePlans.find((p) => p.code === planCode) ?? null;
  const isNoop = enabling && shop.loyaltyEnabled && shop.entitlementStatus === "active" && planCode === currentPlanCode;
  const orgShops = siblings ?? [shop];
  const overTarget = enabling && targetPlan ? orgShops.filter((s) => s.activeMembers > targetPlan.memberLimit) : [];
  const needsAck = overTarget.length > 0;
  const reasonError = validateAdminReason(reason);
  const canConfirm =
    !submitting && !reasonError && siblings != null && !isNoop && (!enabling || targetPlan != null) && (!needsAck || ack);

  const confirm = () => {
    setTouched(true);
    if (!canConfirm) return;
    void run(
      () =>
        setShopLoyaltyEntitlement(
          shop.shopId,
          enabling ? { enabled: true, planCode: targetPlan!.code } : { enabled: false },
          reason,
        ),
      (data) =>
        onDone(
          data.loyaltyEnabled
            ? `Loyalty enabled for ${shop.organizationName} on plan "${data.tierCode ?? targetPlan?.code}" (limit ${nf(data.memberLimit)}).`
            : `Loyalty disabled for ${shop.organizationName}. Members, points and Wallet passes were kept.`,
        ),
    );
  };

  const currentState = shop.loyaltyEnabled ? "enabled" : `disabled (${shop.entitlementStatus})`;
  const currentLimit = shop.loyaltyEnabled ? nf(shop.memberLimit) : "—";

  return (
    <BottomSheet
      open
      onClose={submitting ? () => undefined : onClose}
      title={
        enabling
          ? shop.loyaltyEnabled
            ? `Change Loyalty plan — ${shop.shopName}`
            : `Enable Loyalty — ${shop.shopName}`
          : `Disable Loyalty — ${shop.shopName}`
      }
      subtitle="Internal control plane · changes are audited"
      wide
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-bold text-muted-foreground">
          Loyalty entitlements are organization-wide. This applies to <span className="text-foreground">{shop.organizationName}</span>{" "}
          and all of its shops{siblings ? ` (${nf(orgShops.length)} shop${orgShops.length === 1 ? "" : "s"})` : ""}.
        </p>

        {enabling ? (
          <Field label="Plan (active plans only)">
            <select className={inputCls} value={planCode} onChange={(e) => setPlanCode(e.target.value)} disabled={submitting}>
              {activePlans.length === 0 ? <option value="">No active plan available</option> : null}
              {activePlans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} ({p.code}) — {nf(p.memberLimit)} members{p.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <DiffTable
          rows={[
            { label: "Loyalty", current: currentState, proposed: enabling ? "enabled" : "disabled" },
            {
              label: "Plan",
              current: currentPlan ? `${currentPlan.name} (${currentPlan.code})` : shop.tierCode ?? "—",
              proposed: enabling
                ? targetPlan
                  ? `${targetPlan.name} (${targetPlan.code})`
                  : "—"
                : `${currentPlan?.code ?? "—"} (kept for re-enable)`,
            },
            { label: "Member limit", current: currentLimit, proposed: enabling && targetPlan ? nf(targetPlan.memberLimit) : "—" },
          ]}
        />

        {siblings == null ? (
          <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading the organization's shops…
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Affected shops</p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
              {orgShops.map((s) => {
                const over = enabling && targetPlan != null && s.activeMembers > targetPlan.memberLimit;
                return (
                  <li key={s.shopId} className="flex justify-between gap-2">
                    <span className="font-bold text-foreground">{s.shopName}</span>
                    <span className={`tabular-nums ${over ? "font-black text-rose-700" : "text-muted-foreground"}`}>
                      {nf(s.activeMembers)} member(s)
                      {enabling && targetPlan ? ` / ${nf(targetPlan.memberLimit)}${over ? ` (+${nf(s.activeMembers - targetPlan.memberLimit)})` : ""}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            {siblingsFailed ? (
              <p className="mt-1 text-[11px] font-semibold text-rose-700">
                Other shops of this organization could not be listed; only this shop is shown.
              </p>
            ) : null}
            {siblingsTruncated ? (
              <p className="mt-1 text-[11px] font-semibold text-amber-800">
                The shop search returned its 100-row maximum, so this organization may have more shops than listed.
              </p>
            ) : null}
          </div>
        )}

        {detail && detail.shopId === shop.shopId ? (
          <p className="text-xs font-semibold text-muted-foreground">
            This shop right now: {nf(detail.activeMembers)} active member(s), {nf(detail.pendingRequests)} pending request(s).
          </p>
        ) : null}

        {!enabling ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
            While disabled, the organization cannot enroll new Loyalty members. The assigned plan is kept, so re-enabling restores
            it.
          </p>
        ) : null}
        {isNoop ? (
          <p className="text-xs font-bold text-muted-foreground">Loyalty is already enabled on this plan. Pick a different plan.</p>
        ) : null}
        {needsAck ? (
          <Acknowledge checked={ack} onChange={setAck}>
            I understand {nf(overTarget.length)} shop(s) will be over the {targetPlan ? nf(targetPlan.memberLimit) : ""}-member limit.
            Their existing members stay enrolled, but they cannot add new members until they are under the limit.
          </Acknowledge>
        ) : null}

        <DataSafetyNotice />
        <ReasonField value={reason} onChange={setReason} disabled={submitting} touched={touched} />
        <ServerError error={serverError} />

        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={enabling ? primaryBtn : dangerBtn}
            onClick={confirm}
            disabled={isNoop || siblings == null || (touched && !canConfirm)}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {enabling ? (shop.loyaltyEnabled ? "Change plan" : "Enable Loyalty") : "Disable Loyalty"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
