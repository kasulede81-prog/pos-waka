import { actorHasPermission } from "../lib/actorAuthorization";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Cloud, Lock, ShieldCheck, Zap } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";

import { useSubscription } from "../context/SubscriptionContext";
import { maxStaffAccountsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { usePosStore } from "../store/usePosStore";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
import { syncStaffAccountsWithCloud } from "../lib/shopStaffCloud";
import { supabase } from "../lib/supabase";
import { StaffCreateWizard } from "../components/staff/StaffCreateWizard";
import { StaffTeamList } from "../components/staff/StaffTeamList";
import { StaffPinResetDialog, StaffPasswordResetDialog } from "../components/auth/StaffCredentialResetDialog";
import { DeviceApprovedGate } from "../components/device/DeviceApprovedGate";
import type { StaffCreateRole } from "../lib/staffRoleCatalog";

export function StaffAccessPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const canManage = actorHasPermission(actor, "settings.shop");
  const planTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const maxStaff = maxStaffAccountsForTier(planTier);
  const preferences = usePosStore((s) => s.preferences);
  const staff = usePosStore((s) => s.preferences.staffAccounts ?? []);
  const addStaffAccount = usePosStore((s) => s.addStaffAccount);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const updateStaffAccount = usePosStore((s) => s.updateStaffAccount);
  const removeStaffAccount = usePosStore((s) => s.removeStaffAccount);
  const resetStaffSecret = usePosStore((s) => s.resetStaffSecret);
  const unlockStaffAccount = usePosStore((s) => s.unlockStaffAccount);
  const switchStaffAccount = usePosStore((s) => s.switchStaffAccount);
  const activeStaffId = usePosStore((s) => s.preferences.activeStaffId);

  const [creating, setCreating] = useState(false);
  const [resetPinStaffId, setResetPinStaffId] = useState<string | null>(null);
  const [resetPasswordStaffId, setResetPasswordStaffId] = useState<string | null>(null);

  useEffect(() => {
    if (authMode !== "supabase" || !supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user || !isSupabaseEmailVerified(data.user)) return;
      void syncStaffAccountsWithCloud(data.user, staff).then(async (merged) => {
        if (!merged) return;
        const { applyStaffAccountsMergeToStore } = await import("../lib/staffSyncApply");
        await applyStaffAccountsMergeToStore(merged, { source: "staff_page_hydrate", sanitize: false });
      });
    });
  }, [authMode, setPreferences, staff.length]);

  if (!canManage) return <Navigate to="/" replace />;

  if (maxStaff <= 0) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader lang={lang} title={t(lang, "staffAccessTitle")} subtitle={t(lang, "staffAccessSub")} backFallback="/settings" />
        <p className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-4 text-sm font-semibold text-waka-950">
          {t(lang, "upgradeWhyStaff")} → {t(lang, "upgradeWhyStaffPlan")}
        </p>
        <Link to="/upgrade" className="inline-flex min-h-[48px] items-center rounded-2xl bg-waka-600 px-5 py-3 text-sm font-black text-white">
          {t(lang, "officePremiumUpgrade")} →
        </Link>
      </div>
    );
  }

  if (creating) {
    return (
      <DeviceApprovedGate lang={lang}>
        <div className="pb-8">
          <StaffCreateWizard
          lang={lang}
          businessType={preferences.businessType}
          onCancel={() => setCreating(false)}
          onDone={() => setCreating(false)}
          staffCanRecordCashExpenses={preferences.staffCanRecordCashExpenses === true}
          requireCashierExpenseApproval={preferences.requireCashierExpenseApproval === true}
          onExpensePrefsChange={(patch) => setPreferences(patch)}
          onCreate={async (input) => {
            if (authMode === "supabase" && supabase) {
              const { data } = await supabase.auth.getUser();
              if (data.user && !isSupabaseEmailVerified(data.user)) {
                return { ok: false, error: t(lang, "verifyActivateLead") };
              }
            }
            if (maxStaff > 0 && staff.length >= maxStaff) {
              return { ok: false, error: tTemplate(lang, "staffLimitPlan", { max: String(maxStaff) }) };
            }
            const res = await addStaffAccount({
              name: input.name,
              role: input.role as StaffCreateRole,
              roleTemplateId: input.roleTemplateId,
              pin: input.pin,
              phone: input.phone,
              password: input.password,
              username: input.username,
            });
            if (!res.ok) {
              const errKey = res.errorKey ?? "staffCreateFail";
              return { ok: false, error: t(lang, errKey as "staffCreateFail") };
            }
            if (authMode === "supabase" && supabase) {
              const { data } = await supabase.auth.getUser();
              if (data.user) {
                const merged = await syncStaffAccountsWithCloud(
                  data.user,
                  usePosStore.getState().preferences.staffAccounts ?? [],
                );
                if (merged) {
                  const { applyStaffAccountsMergeToStore } = await import("../lib/staffSyncApply");
                  await applyStaffAccountsMergeToStore(merged, { source: "staff_page_post_create", sanitize: false });
                }
              }
            }
            return { ok: true };
          }}
        />
        </div>
      </DeviceApprovedGate>
    );
  }

  return (
    <DeviceApprovedGate lang={lang}>
      <div className="space-y-5 pb-8">
      <PageHeader lang={lang} title={t(lang, "staffAccessTitle")} subtitle={t(lang, "staffAccessSub")} backFallback="/settings" />

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { key: "staffHighlightSecure", Icon: Lock },
          { key: "staffHighlightSync", Icon: Cloud },
          { key: "staffHighlightRoles", Icon: ShieldCheck },
          { key: "staffHighlightFast", Icon: Zap },
        ].map(({ key, Icon }) => (
          <article key={key} className="flex gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-waka-50 text-waka-700">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <p className="text-sm font-bold text-foreground">{t(lang, key)}</p>
          </article>
        ))}
      </div>

      <StaffTeamList
        lang={lang}
        businessType={preferences.businessType}
        customStaffRoles={preferences.customStaffRoles}
        staff={staff}
        maxStaff={maxStaff}
        activeStaffId={activeStaffId}
        onAddStaff={() => setCreating(true)}
        onToggleActive={(id, active) => updateStaffAccount(id, { active })}
        onUpdateRoleTemplate={(id, roleTemplateId, role) => updateStaffAccount(id, { role, roleTemplateId, customRoleId: null })}
        onAssignCustomRole={(id, customRoleId) => {
          const custom = (preferences.customStaffRoles ?? []).find((r) => r.id === customRoleId);
          if (!custom) return;
          updateStaffAccount(id, { role: custom.inheritsFrom, customRoleId, roleTemplateId: null });
        }}
        onResetPin={(id) => setResetPinStaffId(id)}
        onResetPassword={(id) => setResetPasswordStaffId(id)}
        onUnlock={(id) => {
          void unlockStaffAccount(id);
        }}
        onForceLogout={(id) => {
          switchStaffAccount(null, { force: true });
          if (activeStaffId === id) {
            void import("../lib/staffSecurityAudit").then(({ logStaffSecurityAudit }) => {
              const row = staff.find((s) => s.id === id);
              logStaffSecurityAudit("staff_logout", { staffId: id, staffName: row?.name, reason: "Owner force logout" });
            });
          }
        }}
        onDelete={(id) => {
          if (!window.confirm(t(lang, "staffDeleteConfirm"))) return;
          removeStaffAccount(id);
        }}
      />

      <section className="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "staffPermissionsTitle")}</h2>
        <WakaSwitch
          checked={preferences.staffCanRecordCashExpenses === true}
          onCheckedChange={(checked) => setPreferences({ staffCanRecordCashExpenses: checked })}
          label={t(lang, "staffAllowCashierExpenses")}
          description={t(lang, "staffAllowCashierExpensesSub")}
          className="rounded-2xl bg-muted px-4 py-3"
        />
        <WakaSwitch
          checked={preferences.requireCashierExpenseApproval === true}
          disabled={preferences.staffCanRecordCashExpenses !== true}
          onCheckedChange={(checked) => setPreferences({ requireCashierExpenseApproval: checked })}
          label={t(lang, "staffRequireExpenseApproval")}
          description={t(lang, "staffRequireExpenseApprovalSub")}
          className="rounded-2xl bg-muted px-4 py-3"
        />
      </section>

      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
        {t(lang, "staffDeviceLocalTrust")}
      </p>

      <StaffPinResetDialog
        lang={lang}
        open={resetPinStaffId != null}
        staffName={staff.find((s) => s.id === resetPinStaffId)?.name ?? ""}
        onClose={() => setResetPinStaffId(null)}
        onConfirm={(pin) => {
          if (resetPinStaffId) {
            resetStaffSecret(resetPinStaffId, { pin, password: null });
          }
        }}
      />
      <StaffPasswordResetDialog
        lang={lang}
        open={resetPasswordStaffId != null}
        staffName={staff.find((s) => s.id === resetPasswordStaffId)?.name ?? ""}
        onClose={() => setResetPasswordStaffId(null)}
        onConfirm={(password) => {
          if (resetPasswordStaffId) {
            resetStaffSecret(resetPasswordStaffId, { password });
          }
        }}
      />
      </div>
    </DeviceApprovedGate>
  );
}
