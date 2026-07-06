import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { isElectronDesktop } from "./lib/electronDesktop";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BusinessProfileRequiredRoute } from "./components/BusinessProfileRequiredRoute";
import { RoleProtectedRoute } from "./components/RoleProtectedRoute";
import { MarketingAgentProtectedRoute } from "./components/MarketingAgentProtectedRoute";
import { ActivationGateOutlet } from "./components/ActivationGateOutlet";
import { ActivationProvider } from "./context/ActivationContext";
import { useAuth } from "./hooks/useAuth";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthRecoveryPage } from "./pages/AuthRecoveryPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsHubPage } from "./pages/SettingsHubPage";
import { SettingsCashDrawerPage } from "./pages/SettingsCashDrawerPage";
import { SettingsShopPage } from "./pages/SettingsShopPage";
import { SettingsReceiptPage } from "./pages/SettingsReceiptPage";
import { SettingsSellingPage } from "./pages/SettingsSellingPage";
import { SettingsHomeMenuPage } from "./pages/SettingsHomeMenuPage";
import { SettingsOfficeMenuPage } from "./pages/SettingsOfficeMenuPage";
import { SettingsShelvesPage } from "./pages/SettingsShelvesPage";
import { SettingsPinPage } from "./pages/SettingsPinPage";
import { SettingsPasswordPage } from "./pages/SettingsPasswordPage";
import { SettingsNotificationsPage } from "./pages/SettingsNotificationsPage";
import { SettingsDataRetentionPage } from "./pages/SettingsDataRetentionPage";
import { SettingsSystemHealthPage } from "./pages/SettingsSystemHealthPage";
import { SettingsDiagnosticsPage } from "./pages/SettingsDiagnosticsPage";
import { SettingsFinanceDiagnosticsPage } from "./pages/SettingsFinanceDiagnosticsPage";
import { SettingsSubscriptionDiagnosticsPage } from "./pages/SettingsSubscriptionDiagnosticsPage";
import { DeviceManagementPage } from "./pages/DeviceManagementPage";
import { DevicePendingApprovalPage } from "./pages/DevicePendingApprovalPage";
import { DeviceAuthorityBridge } from "./components/device/DeviceAuthorityBridge";
import { SyncConflictCenterPage } from "./pages/SyncConflictCenterPage";
import { SettingsPharmacyPage } from "./pages/SettingsPharmacyPage";
import { MenuBuilderPage } from "./pages/MenuBuilderPage";
import { ArchiveDataPage } from "./pages/ArchiveDataPage";
import { BackupSyncPage } from "./pages/BackupSyncPage";
import { CashManagementPage } from "./pages/CashManagementPage";
import { AccountPage } from "./pages/AccountPage";
import { AccountDeletionPage } from "./pages/AccountDeletionPage";
import { OwnerProtectedRoute } from "./components/OwnerProtectedRoute";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { MarketingHomePage } from "./pages/MarketingHomePage";
import { AboutPage } from "./pages/public/AboutPage";
import { PricingPage } from "./pages/public/PricingPage";
import { ContactPage } from "./pages/public/ContactPage";
import { FounderPage } from "./pages/public/FounderPage";
import { CompanyPage } from "./pages/public/CompanyPage";
import { SolutionPage } from "./pages/public/SolutionPage";
import { VerifyAgentPage } from "./pages/public/VerifyAgentPage";
import { DemoExperiencePage } from "./pages/DemoExperiencePage";
import { BusinessActivationPage } from "./pages/BusinessActivationPage";
import { PosDataProvider } from "./providers/PosDataProvider";
import { NativeSplashGate } from "./components/NativeSplashGate";
import { SyncStatusProvider } from "./hooks/useSyncStatus";
import { BackOfficeSessionProvider } from "./context/BackOfficeSessionContext";
import { SensitiveActionAuthProvider } from "./context/SensitiveActionAuthContext";
import { SensitiveActionGate } from "./components/security/SensitiveActionGate";
import { SettingsChangeGate } from "./components/security/SettingsChangeGate";
import { SettingsBiometricPage } from "./pages/SettingsBiometricPage";
import { ProfitPage } from "./pages/ProfitPage";
import { PharmacyMarginReportPage } from "./pages/PharmacyMarginReportPage";
import { InventoryPurchasingPage } from "./pages/InventoryPurchasingPage";
import { InventoryPurchasingProtectedRoute } from "./components/InventoryPurchasingProtectedRoute";
import { PharmacyProtectedRoute, PharmacyPosRedirect, PharmacyBusinessRoute } from "./components/pharmacy/PharmacyProtectedRoute";
import { EnterpriseProtectedRoute } from "./components/enterprise/EnterpriseProtectedRoute";
import { LegacyPurchaseDetailRedirect, LegacySupplierDetailRedirect } from "./components/inventory/LegacyInventoryRedirects";
import { InventoryCountSessionsPage } from "./pages/InventoryCountSessionsPage";
import { InventoryCountSessionPage } from "./pages/InventoryCountSessionPage";
import { CloseDayPage } from "./pages/CloseDayPage";
import { XReportPage } from "./pages/XReportPage";
import { CashPositionPage } from "./pages/CashPositionPage";
import { DayOpenPage } from "./pages/DayOpenPage";
import { ReportsPage } from "./pages/ReportsPage";
import { CashExpensesPage } from "./pages/CashExpensesPage";
import { StaffAccessPage } from "./pages/StaffAccessPage";
import { UpgradePage } from "./pages/UpgradePage";
import { SupportPage } from "./pages/SupportPage";
import { PilotSupportCenterPage } from "./pages/PilotSupportCenterPage";
import { LegalPolicyPage } from "./pages/LegalPolicyPage";
import { InternalWakaAdminPage } from "./pages/InternalWakaAdminPage";
import { InternalAdminOutlet } from "./components/routing/InternalAdminOutlet";
import { InternalShopOpsPage } from "./pages/InternalShopOpsPage";
import { ShopRescueConsolePage } from "./pages/ShopRescueConsolePage";
import { ShopOnboardingPage } from "./pages/ShopOnboardingPage";
import { OnboardingRouteGate } from "./components/onboarding/OnboardingRouteGate";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { NativeMarketingGuard } from "./components/NativeMarketingGuard";
import { RouteSeoController } from "./components/marketing/RouteSeoController";
import { NativePublicGuard } from "./components/NativePublicGuard";
import { unauthenticatedEntryPath } from "./lib/nativeApp";
import { SubscriptionProvider } from "./context/SubscriptionContext";
import { DeviceActivationProvider } from "./context/DeviceActivationContext";
import { DeviceActivationGateOutlet } from "./components/DeviceActivationGateOutlet";
import { EmailVerificationGateOutlet } from "./components/EmailVerificationGateOutlet";
import { DeviceLimitReachedPage } from "./pages/DeviceLimitReachedPage";
import { StabilityDiagnosticsOverlay } from "./components/dev/StabilityDiagnosticsOverlay";
import { StartupBootstrapGate } from "./components/startup/StartupBootstrapGate";
import { DisplayScaleProvider } from "./context/DisplayScaleProvider";
import { installNetworkDiagnosticsProbe, isDiagnosticsEnabled } from "./lib/stabilityDiagnostics";
import { SettingsAppearancePage } from "./pages/SettingsAppearancePage";
import { useUiLanguage } from "./hooks/useUiLanguage";

const OwnerDashboardPage = lazy(() =>
  import("./pages/OwnerDashboardPage").then((m) => ({ default: m.OwnerDashboardPage })),
);
// Staff activity retained at /office/audit-center (Investigation)
const AuditCenterPage = lazy(() =>
  import("./pages/AuditCenterPage").then((m) => ({ default: m.AuditCenterPage })),
);
const HardwareSettingsPage = lazy(() =>
  import("./pages/HardwareSettingsPage").then((m) => ({ default: m.HardwareSettingsPage })),
);
const MarketingAgentPage = lazy(() =>
  import("./pages/MarketingAgentPage").then((m) => ({ default: m.MarketingAgentPage })),
);
const HomePage = lazy(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })));
const PosPage = lazy(() => import("./pages/PosPage").then((m) => ({ default: m.PosPage })));
const OfficeHubPage = lazy(() => import("./pages/OfficeHubPage").then((m) => ({ default: m.OfficeHubPage })));
const OfficeHubSectionPage = lazy(() =>
  import("./pages/OfficeHubSectionPage").then((m) => ({ default: m.OfficeHubSectionPage })),
);
const ReceiptsPage = lazy(() => import("./pages/ReceiptsPage").then((m) => ({ default: m.ReceiptsPage })));
const FloorPlanPage = lazy(() => import("./pages/FloorPlanPage").then((m) => ({ default: m.FloorPlanPage })));
const TableOrderPage = lazy(() => import("./pages/TableOrderPage").then((m) => ({ default: m.TableOrderPage })));
const SettingsFloorPage = lazy(() => import("./pages/SettingsFloorPage").then((m) => ({ default: m.SettingsFloorPage })));
const SettingsHospitalityPage = lazy(() =>
  import("./pages/SettingsHospitalityPage").then((m) => ({ default: m.SettingsHospitalityPage })),
);
const KitchenDisplayPage = lazy(() => import("./pages/KitchenDisplayPage").then((m) => ({ default: m.KitchenDisplayPage })));
const CustomerDisplayPage = lazy(() => import("./pages/CustomerDisplayPage").then((m) => ({ default: m.CustomerDisplayPage })));
const ReservationCalendarPage = lazy(() =>
  import("./pages/ReservationCalendarPage").then((m) => ({ default: m.ReservationCalendarPage })),
);
const ExpoDisplayPage = lazy(() => import("./pages/ExpoDisplayPage").then((m) => ({ default: m.ExpoDisplayPage })));
const PendingSalesPage = lazy(() => import("./pages/PendingSalesPage").then((m) => ({ default: m.PendingSalesPage })));
const OpenShiftsPage = lazy(() => import("./pages/OpenShiftsPage").then((m) => ({ default: m.OpenShiftsPage })));
const PharmacyDashboardPage = lazy(() =>
  import("./pages/PharmacyDashboardPage").then((m) => ({ default: m.PharmacyDashboardPage })),
);
const PharmacyExpiryCenterPage = lazy(() =>
  import("./pages/PharmacyExpiryCenterPage").then((m) => ({ default: m.PharmacyExpiryCenterPage })),
);
const PharmacyInventoryReportsPage = lazy(() =>
  import("./pages/PharmacyInventoryReportsPage").then((m) => ({ default: m.PharmacyInventoryReportsPage })),
);
const PharmacyPrescriptionWorkspacePage = lazy(() =>
  import("./pages/PharmacyPrescriptionWorkspacePage").then((m) => ({
    default: m.PharmacyPrescriptionWorkspacePage,
  })),
);
const PharmacyPatientsPage = lazy(() =>
  import("./pages/PharmacyPatientsPage").then((m) => ({ default: m.PharmacyPatientsPage })),
);
const PharmacyPatientProfilePage = lazy(() =>
  import("./pages/PharmacyPatientProfilePage").then((m) => ({ default: m.PharmacyPatientProfilePage })),
);
const PharmacyPatientReportsPage = lazy(() =>
  import("./pages/PharmacyPatientReportsPage").then((m) => ({ default: m.PharmacyPatientReportsPage })),
);
const PharmacyComplianceRegisterPage = lazy(() =>
  import("./pages/PharmacyComplianceRegisterPage").then((m) => ({ default: m.PharmacyComplianceRegisterPage })),
);
const PharmacyComplianceReportsPage = lazy(() =>
  import("./pages/PharmacyComplianceReportsPage").then((m) => ({ default: m.PharmacyComplianceReportsPage })),
);
const PharmacyAccessDeniedPage = lazy(() =>
  import("./pages/PharmacyAccessDeniedPage").then((m) => ({ default: m.PharmacyAccessDeniedPage })),
);
const EnterpriseDashboardPage = lazy(() =>
  import("./pages/enterprise/EnterpriseDashboardPage").then((m) => ({ default: m.EnterpriseDashboardPage })),
);
const EnterpriseBranchCenterPage = lazy(() =>
  import("./pages/enterprise/EnterpriseBranchCenterPage").then((m) => ({ default: m.EnterpriseBranchCenterPage })),
);
const EnterpriseTransfersPage = lazy(() =>
  import("./pages/enterprise/EnterpriseTransfersPage").then((m) => ({ default: m.EnterpriseTransfersPage })),
);
const EnterprisePurchasingPage = lazy(() =>
  import("./pages/enterprise/EnterprisePurchasingPage").then((m) => ({ default: m.EnterprisePurchasingPage })),
);
const EnterpriseReportsPage = lazy(() =>
  import("./pages/enterprise/EnterpriseReportsPage").then((m) => ({ default: m.EnterpriseReportsPage })),
);
const EnterpriseAuditCenterPage = lazy(() =>
  import("./pages/enterprise/EnterpriseAuditCenterPage").then((m) => ({ default: m.EnterpriseAuditCenterPage })),
);
const EnterpriseHealthPage = lazy(() =>
  import("./pages/enterprise/EnterpriseHealthPage").then((m) => ({ default: m.EnterpriseHealthPage })),
);
const EnterpriseBackupPage = lazy(() =>
  import("./pages/enterprise/EnterpriseBackupPage").then((m) => ({ default: m.EnterpriseBackupPage })),
);

function LazyWait() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-stone-600">Loading…</div>
  );
}

function AppRoutes() {
  const auth = useAuth();
  const { lang, setLang, ready: langReady } = useUiLanguage();
  const showDiagnostics = isDiagnosticsEnabled();

  useEffect(() => {
    if (showDiagnostics) installNetworkDiagnosticsProbe();
  }, [showDiagnostics]);

  return (
    <StartupBootstrapGate
      lang={lang}
      langReady={langReady}
      authInitializing={auth.initializing}
      isAuthenticated={auth.isAuthenticated}
      onSignOut={auth.signOut}
    >
      {showDiagnostics ? <StabilityDiagnosticsOverlay /> : null}
      <RouteSeoController />
      <NativeSplashGate authReady={!auth.initializing} waitForPos={auth.isAuthenticated} />
      <Routes>
        <Route element={<NativePublicGuard isAuthenticated={auth.isAuthenticated} />}>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        <Route
          path="/login"
          element={
            <LoginPage
              lang={lang}
              setLang={setLang}
              initializing={auth.initializing}
              isAuthenticated={auth.isAuthenticated}
              onLogin={auth.signIn}
              onGoogleLogin={auth.signInWithGoogle}
              onStaffLogin={auth.signInStaff}
              listStaffShops={auth.listStaffShops}
              rememberedStaffDevice={auth.rememberedStaffDevice}
              onClearRememberedStaff={auth.clearRememberedStaff}
              mode={auth.mode}
            />
          }
        />

        <Route
          path="/register"
          element={
            <RouteErrorBoundary scope="Registration">
              <RegisterPage
                lang={lang}
                setLang={setLang}
                isAuthenticated={auth.isAuthenticated}
                signUpQuick={auth.signUpQuick}
                onGoogleSignIn={auth.signInWithGoogle}
              />
            </RouteErrorBoundary>
          }
        />

        <Route
          path="/verify-email"
          element={
            <VerifyEmailPage
              lang={lang}
              setLang={setLang}
              isAuthenticated={auth.isAuthenticated}
              resendVerificationEmail={auth.resendVerificationEmail}
            />
          }
        />

        <Route
          path="/forgot-password"
          element={
            <ForgotPasswordPage
              lang={lang}
              setLang={setLang}
              isAuthenticated={auth.isAuthenticated}
              requestPasswordReset={auth.requestPasswordReset}
            />
          }
        />

        <Route path="/auth/recovery" element={<AuthRecoveryPage />} />
        <Route
          path="/reset-password"
          element={
            <ResetPasswordPage
              lang={lang}
              setLang={setLang}
              mode={auth.mode}
              updatePassword={auth.updatePassword}
              signOut={auth.signOut}
            />
          }
        />

        <Route
          path="/support"
          element={
            <RouteErrorBoundary scope="Support">
              <SyncStatusProvider>
                <SubscriptionProvider user={auth.user} authMode={auth.mode}>
                  <SupportPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />
                </SubscriptionProvider>
              </SyncStatusProvider>
            </RouteErrorBoundary>
          }
        />
        <Route path="/terms" element={<LegalPolicyPage kind="terms" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/privacy" element={<LegalPolicyPage kind="privacy" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route
          path="/acceptable-use"
          element={<LegalPolicyPage kind="acceptable-use" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />}
        />
        <Route path="/verify-agent/:agentId" element={<VerifyAgentPage lang={lang} />} />

        <Route element={<NativeMarketingGuard isAuthenticated={auth.isAuthenticated} />}>
          <Route path="/home" element={<MarketingHomePage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/about" element={<AboutPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/pricing" element={<PricingPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/contact" element={<ContactPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/founder" element={<FounderPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/about/founder" element={<Navigate to="/founder" replace />} />
          <Route path="/company" element={<CompanyPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/solutions/:solutionSlug" element={<SolutionPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/demo" element={<DemoExperiencePage lang={lang} isAuthenticated={auth.isAuthenticated} />} />
        </Route>
        </Route>

        <Route element={<ProtectedRoute initializing={auth.initializing} isAuthenticated={auth.isAuthenticated} />}>
          <Route element={<BusinessProfileRequiredRoute authMode={auth.mode} userId={auth.user?.id} />}>
            <Route
              element={
                <ActivationProvider authMode={auth.mode} user={auth.user}>
                  <ActivationGateOutlet />
                </ActivationProvider>
              }
            >
              <Route path="activate" element={<BusinessActivationPage lang={lang} setLang={setLang} />} />
                <Route
                  element={
                    <SubscriptionProvider user={auth.user} authMode={auth.mode}>
                      <EmailVerificationGateOutlet authMode={auth.mode} user={auth.user}>
                        <DeviceActivationProvider authMode={auth.mode} user={auth.user}>
                          <DeviceAuthorityBridge authMode={auth.mode}>
                            <DeviceActivationGateOutlet />
                          </DeviceAuthorityBridge>
                        </DeviceActivationProvider>
                      </EmailVerificationGateOutlet>
                    </SubscriptionProvider>
                  }
                >
                <Route
                  path="device-limit"
                  element={<DeviceLimitReachedPage lang={lang} onSignOut={auth.signOut} />}
                />
                <Route path="device-pending" element={<DevicePendingApprovalPage lang={lang} />} />
                <Route element={<InternalAdminOutlet />}>
                  <Route path="internal/waka" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/shops" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/devices" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/analytics" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/support" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/billing" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route
                    path="internal/waka/billing/pricing-campaigns"
                    element={<InternalWakaAdminPage lang={lang} email={auth.email} />}
                  />
                  <Route path="internal/waka/admins" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/agents" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/activations" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/pilot" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route
                    path="internal/waka/business-types"
                    element={<InternalWakaAdminPage lang={lang} email={auth.email} />}
                  />
                  <Route
                    path="internal/waka/growth-campaign"
                    element={<InternalWakaAdminPage lang={lang} email={auth.email} />}
                  />
                  <Route
                    path="internal/waka/ai-settings"
                    element={<InternalWakaAdminPage lang={lang} email={auth.email} />}
                  />
                  <Route
                    path="internal/waka/releases"
                    element={<InternalWakaAdminPage lang={lang} email={auth.email} />}
                  />
                  <Route
                    path="internal/waka/display-scale"
                    element={<InternalWakaAdminPage lang={lang} email={auth.email} />}
                  />
                  <Route path="internal/waka/shop/:shopId" element={<InternalShopOpsPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/shop/:shopId/rescue" element={<ShopRescueConsolePage lang={lang} email={auth.email} />} />
                </Route>
                <Route
                  element={
                    <PosDataProvider lang={lang} accountKey={auth.accountKey} onSignOut={auth.signOut}>
                      <OnboardingRouteGate
                        authMode={auth.mode}
                        user={auth.user}
                        email={auth.email}
                        staffSession={auth.staffSession}
                      />
                    </PosDataProvider>
                  }
                >
                <Route path="onboarding" element={
                  <RouteErrorBoundary scope="onboarding">
                    <ShopOnboardingPage lang={lang} setLang={setLang} onSignOut={auth.signOut} />
                  </RouteErrorBoundary>
                } />
                <Route
                  element={
                    <SyncStatusProvider>
                      <BackOfficeSessionProvider>
                        <SensitiveActionAuthProvider lang={lang}>
                          <AppShell
                            lang={lang}
                            setLang={setLang}
                            onSignOut={auth.signOut}
                            user={auth.user}
                            email={auth.email}
                            authMode={auth.mode}
                            staffSession={auth.staffSession}
                          />
                        </SensitiveActionAuthProvider>
                      </BackOfficeSessionProvider>
                    </SyncStatusProvider>
                  }
                >
            <Route
              index
              element={
                <Suspense fallback={<LazyWait />}>
                  <HomePage lang={lang} />
                </Suspense>
              }
            />
            <Route
              path="office"
              element={
                <RoleProtectedRoute permission="back_office.access">
                  <Suspense fallback={<LazyWait />}>
                    <OfficeHubPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/section/:sectionId"
              element={
                <RoleProtectedRoute permission="back_office.access">
                  <Suspense fallback={<LazyWait />}>
                    <OfficeHubSectionPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/profit"
              element={
                <RoleProtectedRoute permission="reports.profit">
                  <SensitiveActionGate lang={lang} kind="access_reports">
                    <ProfitPage lang={lang} />
                  </SensitiveActionGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/cash-drawer"
              element={
                <RoleProtectedRoute permission="day.close">
                  <CashManagementPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route path="office/cash" element={<Navigate to="/office/cash-drawer" replace />} />
            <Route
              path="office/day-open"
              element={
                <RoleProtectedRoute permission="day.open_drawer">
                  <DayOpenPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/cash-position"
              element={
                <RoleProtectedRoute permission="day.close">
                  <SensitiveActionGate lang={lang} kind="access_reports">
                    <CashPositionPage lang={lang} />
                  </SensitiveActionGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/open-shifts"
              element={
                <RoleProtectedRoute permission="back_office.access">
                  <Suspense fallback={<LazyWait />}>
                    <OpenShiftsPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/shift-reports"
              element={<Navigate to="/office/open-shifts" replace />}
            />
            <Route path="office/purchases" element={<Navigate to="/stock?tab=purchases" replace />} />
            <Route path="office/purchases/:purchaseId" element={<LegacyPurchaseDetailRedirect />} />
            <Route
              path="office/pharmacy-margins"
              element={
                <RoleProtectedRoute permission="reports.profit">
                  <PharmacyMarginReportPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/hardware"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <Suspense fallback={<LazyWait />}>
                    <HardwareSettingsPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="agent"
              element={
                <MarketingAgentProtectedRoute>
                  <Suspense fallback={<LazyWait />}>
                    <MarketingAgentPage lang={lang} />
                  </Suspense>
                </MarketingAgentProtectedRoute>
              }
            />
            <Route path="upgrade" element={<UpgradePage lang={lang} />} />
            <Route
              path="office/backup"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <BackupSyncPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/account/delete"
              element={
                <OwnerProtectedRoute>
                  <AccountDeletionPage
                    lang={lang}
                    userId={auth.user?.id ?? null}
                    email={auth.email}
                    user={auth.user}
                    onSignOut={auth.signOut}
                  />
                </OwnerProtectedRoute>
              }
            />
            <Route
              path="office/account"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <AccountPage
                    lang={lang}
                    email={auth.email}
                    shopName={auth.shopName}
                    onSignOut={auth.signOut}
                    user={auth.user}
                    authMode={auth.mode}
                  />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="stock"
              element={
                <InventoryPurchasingProtectedRoute>
                  <InventoryPurchasingPage lang={lang} />
                </InventoryPurchasingProtectedRoute>
              }
            />
            <Route
              path="stock/count"
              element={
                <RoleProtectedRoute permission="stock.count">
                  <InventoryCountSessionsPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="stock/count/:sessionId"
              element={
                <RoleProtectedRoute permission="stock.count">
                  <InventoryCountSessionPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route path="suppliers" element={<Navigate to="/stock?tab=suppliers" replace />} />
            <Route path="suppliers/:supplierId" element={<LegacySupplierDetailRedirect />} />
            <Route path="restock" element={<Navigate to="/stock?tab=purchases&new=1" replace />} />
            <Route path="inventory" element={<Navigate to="/stock" replace />} />
            <Route
              path="pos"
              element={
                <PharmacyPosRedirect>
                  <Suspense fallback={<LazyWait />}>
                    <PosPage lang={lang} />
                  </Suspense>
                </PharmacyPosRedirect>
              }
            />
            <Route
              path="floor"
              element={
                <RoleProtectedRoute permission="hospitality.floor">
                  <Suspense fallback={<LazyWait />}>
                    <FloorPlanPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="floor/reservations"
              element={
                <RoleProtectedRoute permission="hospitality.floor">
                  <Suspense fallback={<LazyWait />}>
                    <ReservationCalendarPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="floor/order/:sessionId"
              element={
                <RoleProtectedRoute permission="hospitality.order">
                  <Suspense fallback={<LazyWait />}>
                    <TableOrderPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="pharmacy/access-denied"
              element={
                <PharmacyBusinessRoute>
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyAccessDeniedPage lang={lang} />
                  </Suspense>
                </PharmacyBusinessRoute>
              }
            />
            <Route
              path="pharmacy"
              element={
                <PharmacyProtectedRoute>
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyDashboardPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/expiry"
              element={
                <PharmacyProtectedRoute>
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyExpiryCenterPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/reports/inventory"
              element={
                <PharmacyProtectedRoute permission="reports.view">
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyInventoryReportsPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/reports/patients"
              element={
                <PharmacyProtectedRoute permission="reports.view">
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyPatientReportsPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/compliance/register"
              element={
                <PharmacyProtectedRoute permission="reports.view">
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyComplianceRegisterPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/compliance/reports"
              element={
                <PharmacyProtectedRoute permission="reports.view">
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyComplianceReportsPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/prescriptions"
              element={
                <PharmacyProtectedRoute permission="pos.sell">
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyPrescriptionWorkspacePage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route path="pharmacy/dispense" element={<Navigate to="/pharmacy/prescriptions" replace />} />
            <Route
              path="pharmacy/patients"
              element={
                <PharmacyProtectedRoute>
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyPatientsPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/patients/:patientId"
              element={
                <PharmacyProtectedRoute>
                  <Suspense fallback={<LazyWait />}>
                    <PharmacyPatientProfilePage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/inventory"
              element={
                <PharmacyProtectedRoute permission="stock.view">
                  <InventoryPurchasingProtectedRoute>
                    <InventoryPurchasingPage lang={lang} />
                  </InventoryPurchasingProtectedRoute>
                </PharmacyProtectedRoute>
              }
            />
            <Route path="pharmacy/purchases" element={<Navigate to="/pharmacy/inventory?tab=purchases" replace />} />
            <Route
              path="pharmacy/reports"
              element={
                <PharmacyProtectedRoute permission="reports.view">
                  <SensitiveActionGate lang={lang} kind="access_reports">
                    <ReportsPage lang={lang} />
                  </SensitiveActionGate>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/returns"
              element={
                <PharmacyProtectedRoute permission="receipts.view">
                  <Suspense fallback={<LazyWait />}>
                    <ReceiptsPage lang={lang} />
                  </Suspense>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="pharmacy/settings"
              element={
                <PharmacyProtectedRoute permission="settings.view">
                  <SettingsChangeGate lang={lang}>
                    <SettingsPharmacyPage lang={lang} />
                  </SettingsChangeGate>
                </PharmacyProtectedRoute>
              }
            />
            <Route
              path="customer-display"
              element={
                <Suspense fallback={<LazyWait />}>
                  <CustomerDisplayPage lang={lang} />
                </Suspense>
              }
            />
            <Route
              path="kitchen"
              element={
                <RoleProtectedRoute permission="hospitality.kitchen">
                  <Suspense fallback={<LazyWait />}>
                    <KitchenDisplayPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="expo"
              element={
                <RoleProtectedRoute permission="hospitality.kitchen">
                  <Suspense fallback={<LazyWait />}>
                    <ExpoDisplayPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="pending-sales"
              element={
                <RoleProtectedRoute permission="pending_sales.manage">
                  <Suspense fallback={<LazyWait />}>
                    <PendingSalesPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="reports"
              element={
                <RoleProtectedRoute permission="reports.view">
                  <SensitiveActionGate lang={lang} kind="access_reports">
                    <ReportsPage lang={lang} />
                  </SensitiveActionGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/x-report"
              element={
                <RoleProtectedRoute permission="reports.view">
                  <XReportPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="close-day"
              element={
                <RoleProtectedRoute permission="day.close">
                  <CloseDayPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="cash-expenses"
              element={
                <RoleProtectedRoute permission="expenses.record">
                  <CashExpensesPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="staff-access"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SensitiveActionGate lang={lang} kind="manage_users" deniedTo="/settings">
                    <StaffAccessPage lang={lang} />
                  </SensitiveActionGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="owner"
              element={
                <RoleProtectedRoute permission="owner.dashboard">
                  <Suspense fallback={<LazyWait />}>
                    <OwnerDashboardPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="enterprise"
              element={
                <EnterpriseProtectedRoute permission="enterprise.dashboard">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseDashboardPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/branches"
              element={
                <EnterpriseProtectedRoute permission="enterprise.branches">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseBranchCenterPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/transfers"
              element={
                <EnterpriseProtectedRoute permission="enterprise.transfers">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseTransfersPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/purchasing"
              element={
                <EnterpriseProtectedRoute permission="enterprise.purchasing">
                  <Suspense fallback={<LazyWait />}>
                    <EnterprisePurchasingPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/reports"
              element={
                <EnterpriseProtectedRoute permission="enterprise.reports">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseReportsPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/audit"
              element={
                <EnterpriseProtectedRoute permission="enterprise.audit">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseAuditCenterPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/health"
              element={
                <EnterpriseProtectedRoute permission="enterprise.health">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseHealthPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="enterprise/backup"
              element={
                <EnterpriseProtectedRoute permission="enterprise.backup">
                  <Suspense fallback={<LazyWait />}>
                    <EnterpriseBackupPage lang={lang} />
                  </Suspense>
                </EnterpriseProtectedRoute>
              }
            />
            <Route
              path="owner/activity"
              element={<Navigate to="/office/audit-center" replace />}
            />
            <Route
              path="office/audit-center"
              element={
                <RoleProtectedRoute permission="owner.activity">
                  <SensitiveActionGate lang={lang} kind="access_reports">
                    <Suspense fallback={<LazyWait />}>
                      <AuditCenterPage lang={lang} />
                    </Suspense>
                  </SensitiveActionGate>
                </RoleProtectedRoute>
              }
            />
            <Route path="customers" element={<CustomersPage lang={lang} />} />
            <Route path="debts" element={<CustomersPage lang={lang} />} />
            <Route
              path="receipts"
              element={
                <Suspense fallback={<LazyWait />}>
                  <ReceiptsPage lang={lang} />
                </Suspense>
              }
            />
            <Route
              path="settings"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <SettingsHubPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="pilot-support"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <PilotSupportCenterPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/cash-drawer"
              element={
                <RoleProtectedRoute permission="day.open_drawer">
                  <SettingsChangeGate lang={lang}>
                    <SettingsCashDrawerPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/shop"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsShopPage
                      lang={lang}
                      email={auth.email}
                      shopName={auth.shopName}
                      user={auth.user}
                      authMode={auth.mode}
                    />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/receipt"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsReceiptPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/selling"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsSellingPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/home-menu"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsHomeMenuPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/office-menu"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsOfficeMenuPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/shelves"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsShelvesPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/floor"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <Suspense fallback={<LazyWait />}>
                      <SettingsFloorPage lang={lang} />
                    </Suspense>
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/pharmacy"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsPharmacyPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/menu"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <MenuBuilderPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/hospitality"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <Suspense fallback={<LazyWait />}>
                      <SettingsHospitalityPage lang={lang} />
                    </Suspense>
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/pin"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsPinPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/biometric"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsBiometricPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/password"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsPasswordPage
                      lang={lang}
                      authMode={auth.mode}
                      updatePassword={auth.updatePassword}
                    />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/appearance"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <SettingsAppearancePage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/notifications"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <SettingsChangeGate lang={lang}>
                    <SettingsNotificationsPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/devices"
              element={
                <RoleProtectedRoute permission="settings.devices">
                  <SettingsChangeGate lang={lang}>
                    <DeviceManagementPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/sync-conflicts"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SyncConflictCenterPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/health"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsSystemHealthPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/diagnostics"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsDiagnosticsPage lang={lang} user={auth.user} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/finance-diagnostics"
              element={
                <RoleProtectedRoute permission="owner.dashboard">
                  <SettingsChangeGate lang={lang}>
                    <SettingsFinanceDiagnosticsPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/subscription-diagnostics"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <SettingsChangeGate lang={lang}>
                    <SettingsSubscriptionDiagnosticsPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/retention"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsDataRetentionPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/archive"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <ArchiveDataPage lang={lang} />
                  </SettingsChangeGate>
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/monthly-reports"
              element={<Navigate to="/reports?tab=monthly" replace />}
            />
                </Route>
              </Route>
            </Route>
          </Route>
        </Route>
        </Route>

        <Route path="*" element={<Navigate to={auth.isAuthenticated ? "/" : unauthenticatedEntryPath()} replace />} />
      </Routes>
    </StartupBootstrapGate>
  );
}

function App() {
  const Router = isElectronDesktop() ? HashRouter : BrowserRouter;
  return (
    <Router>
      <DisplayScaleProvider>
        <AppRoutes />
      </DisplayScaleProvider>
    </Router>
  );
}

export default App;
