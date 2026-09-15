import { actorHasPermission } from "../lib/actorAuthorization";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Cloud, Lock, ShieldCheck, Zap } from "lucide-react";
import clsx from "clsx";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { Body } from "../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { statusTokens } from "../lib/statusTokens";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";

import { useSubscription } from "../context/SubscriptionContext";
import { maxStaffAccountsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { usePosStore } from "../store/usePosStore";
import { isSupabaseEmailVerified } from "../lib/emailVerification";
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
  const [staffHydrating, setStaffHydrating] = useState(false);

  const hydrateStaffFromCloud = useCallback(async () => {
    if (authMode !== "supabase" || !supabase) return;
    setStaffHydrating(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user || !isSupabaseEmailVerified(data.user)) return;
      const { hydrateStaffTeamFromCloud } = await import("../lib/staffRecovery");
      await hydrateStaffTeamFromCloud({ force: true });
    } finally {
      setStaffHydrating(false);
    }
  }, [authMode]);

  useEffect(() => {
    void hydrateStaffFromCloud();
  }, [hydrateStaffFromCloud]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void hydrateStaffFromCloud();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hydrateStaffFromCloud]);

  if (!canManage) return <Navigate to="/" replace />;

  if (maxStaff <= 0) {
    return (
      <EnterprisePageContainer>
        <EnterprisePageHeader lang={lang} title={t(lang, "staffAccessTitle")} subtitle={t(lang, "staffAccessSub")} backFallback="/settings" />
        <EnterpriseCard muted>
          <Body>{t(lang, "upgradeWhyStaff")} → {t(lang, "upgradeWhyStaffPlan")}</Body>
        </EnterpriseCard>
        <Link to="/upgrade">
          <WakaButton variant="primary">{t(lang, "officePremiumUpgrade")} →</WakaButton>
        </Link>
      </EnterprisePageContainer>
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
            if (authMode === "supabase") {
              await hydrateStaffFromCloud();
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
      <EnterprisePageContainer>
      <EnterprisePageHeader lang={lang} title={t(lang, "staffAccessTitle")} subtitle={t(lang, "staffAccessSub")} backFallback="/settings" />

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { key: "staffHighlightSecure", Icon: Lock },
          { key: "staffHighlightSync", Icon: Cloud },
          { key: "staffHighlightRoles", Icon: ShieldCheck },
          { key: "staffHighlightFast", Icon: Zap },
        ].map(({ key, Icon }) => (
          <EnterpriseCard key={key} muted className="flex gap-3 !p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-waka-50 text-waka-700">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <Body className="!text-sm !font-bold">{t(lang, key)}</Body>
          </EnterpriseCard>
        ))}
      </div>

      <StaffTeamList
        lang={lang}
        businessType={preferences.businessType}
        customStaffRoles={preferences.customStaffRoles}
        staff={staff}
        maxStaff={maxStaff}
        activeStaffId={activeStaffId}
        hydrating={staffHydrating}
        onRefresh={() => void hydrateStaffFromCloud()}
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

      <EnterpriseCard title={t(lang, "staffPermissionsTitle")}>
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
      </EnterpriseCard>

      <div className={clsx("rounded-2xl border px-4 py-3", statusTokens.warning.banner, statusTokens.warning.badgeRing)}>
        <Body className="!text-sm !font-semibold text-warning-foreground">{t(lang, "staffDeviceLocalTrust")}</Body>
      </div>

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
      </EnterprisePageContainer>
    </DeviceApprovedGate>
  );
}
