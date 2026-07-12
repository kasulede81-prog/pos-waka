import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { usePosStore } from "../store/usePosStore";
import { StaffRolesCenter, countStaffWithCustomRole } from "../components/staff/StaffRolesCenter";
import { DeviceApprovedGate } from "../components/device/DeviceApprovedGate";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";

export function SettingsStaffRolesPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const addCustomStaffRole = usePosStore((s) => s.addCustomStaffRole);
  const updateCustomStaffRole = usePosStore((s) => s.updateCustomStaffRole);
  const removeCustomStaffRole = usePosStore((s) => s.removeCustomStaffRole);
  const cloneCustomStaffRole = usePosStore((s) => s.cloneCustomStaffRole);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <DeviceApprovedGate lang={lang}>
      <EnterprisePageContainer>
        <SettingsPageHeader
          lang={lang}
          title={t(lang, "enterpriseRolesPageTitle")}
          subtitle={t(lang, "enterpriseRolesPageSub")}
        />
        <StaffRolesCenter
          lang={lang}
          businessType={preferences.businessType}
          customRoles={preferences.customStaffRoles ?? []}
          staffCountByRole={(roleId) => countStaffWithCustomRole(preferences.staffAccounts, roleId)}
          onCreate={(input) => addCustomStaffRole(input)}
          onUpdate={(id, patch) => updateCustomStaffRole(id, patch)}
          onRemove={(id) => removeCustomStaffRole(id)}
          onCloneTemplate={(templateId, name) => cloneCustomStaffRole({ kind: "template", id: templateId }, name)}
          onCloneRole={(roleId, name) => cloneCustomStaffRole({ kind: "custom", id: roleId }, name)}
        />
      </EnterprisePageContainer>
    </DeviceApprovedGate>
  );
}
