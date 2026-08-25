/**
 * Staff feature — management UI surface (re-exports only).
 * Team, roles, security pages and components.
 * Phase 2: no logic moved; files stay in pages/ and components/.
 */
export { StaffAccessPage } from "../../../pages/StaffAccessPage";
export { StaffAcceptPage } from "../../../pages/StaffAcceptPage";
export { StaffCenterLayout } from "../../../pages/StaffCenterLayout";
export { StaffCenterActivityPage } from "../../../pages/StaffCenterActivityPage";
export { SettingsStaffRolesPage } from "../../../pages/SettingsStaffRolesPage";
export { SettingsStaffSecurityPage } from "../../../pages/SettingsStaffSecurityPage";

export { StaffTeamList } from "../../../components/staff/StaffTeamList";
export { StaffCreateWizard } from "../../../components/staff/StaffCreateWizard";
export { StaffRolesCenter } from "../../../components/staff/StaffRolesCenter";
export { StaffDesktopTable } from "../../../components/staff/StaffDesktopTable";
export { StaffCloudInviteCard } from "../../../components/staff/StaffCloudInviteCard";
export { StaffLegacyUpgradeDialog } from "../../../components/staff/StaffLegacyUpgradeDialog";
export { StaffCacheMissingScreen } from "../../../components/staff/StaffCacheMissingScreen";
export { CustomRolePermissionEditor } from "../../../components/staff/CustomRolePermissionEditor";

export { SellerPicker } from "../../../components/auth/SellerPicker";
export { EnterpriseStaffLockScreen } from "../../../components/auth/EnterpriseStaffLockScreen";
export { EnterpriseStaffLoginPanel } from "../../../components/auth/EnterpriseStaffLoginPanel";
