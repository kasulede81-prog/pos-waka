import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { isElectronDesktop } from "./lib/electronDesktop";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BusinessProfileRequiredRoute } from "./components/BusinessProfileRequiredRoute";
import { RoleProtectedRoute } from "./components/RoleProtectedRoute";
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
import { ConnectedDevicesPage } from "./pages/ConnectedDevicesPage";
import { SyncConflictCenterPage } from "./pages/SyncConflictCenterPage";
import { SettingsPharmacyPage } from "./pages/SettingsPharmacyPage";
import { SettingsHospitalityPage } from "./pages/SettingsHospitalityPage";
import { ArchiveDataPage } from "./pages/ArchiveDataPage";
import { BackupSyncPage } from "./pages/BackupSyncPage";
import { CashManagementPage } from "./pages/CashManagementPage";
import { AccountPage } from "./pages/AccountPage";
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
import { StockPage } from "./pages/StockPage";
import { InventoryCountSessionsPage } from "./pages/InventoryCountSessionsPage";
import { InventoryCountSessionPage } from "./pages/InventoryCountSessionPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { RestockPage } from "./pages/RestockPage";
import { CloseDayPage } from "./pages/CloseDayPage";
import { CashPositionPage } from "./pages/CashPositionPage";
import { DayOpenPage } from "./pages/DayOpenPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { PurchaseDetailPage } from "./pages/PurchaseDetailPage";
import { SupplierDetailPage } from "./pages/SupplierDetailPage";
import { CashExpensesPage } from "./pages/CashExpensesPage";
import { StaffAccessPage } from "./pages/StaffAccessPage";
import { UpgradePage } from "./pages/UpgradePage";
import { SupportPage } from "./pages/SupportPage";
import { PilotSupportCenterPage } from "./pages/PilotSupportCenterPage";
import { LegalPolicyPage } from "./pages/LegalPolicyPage";
import { InternalWakaAdminPage } from "./pages/InternalWakaAdminPage";
import { InternalAdminOutlet } from "./components/routing/InternalAdminOutlet";
import { InternalShopOpsPage } from "./pages/InternalShopOpsPage";
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
import { installNetworkDiagnosticsProbe, isDiagnosticsEnabled } from "./lib/stabilityDiagnostics";
import { useUiLanguage } from "./hooks/useUiLanguage";

const OwnerDashboardPage = lazy(() =>
  import("./pages/OwnerDashboardPage").then((m) => ({ default: m.OwnerDashboardPage })),
);
const StaffActivityPage = lazy(() =>
  import("./pages/StaffActivityPage").then((m) => ({ default: m.StaffActivityPage })),
);
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
const KitchenDisplayPage = lazy(() => import("./pages/KitchenDisplayPage").then((m) => ({ default: m.KitchenDisplayPage })));
const PendingSalesPage = lazy(() => import("./pages/PendingSalesPage").then((m) => ({ default: m.PendingSalesPage })));
const OpenShiftsPage = lazy(() => import("./pages/OpenShiftsPage").then((m) => ({ default: m.OpenShiftsPage })));

function LazyWait() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-slate-600">Loading…</div>
  );
}

function AppRoutes() {
  const auth = useAuth();
  const { lang, setLang, ready: langReady } = useUiLanguage();
  const showDiagnostics = isDiagnosticsEnabled();

  useEffect(() => {
    if (showDiagnostics) installNetworkDiagnosticsProbe();
  }, [showDiagnostics]);

  if (!langReady) {
    return null;
  }

  return (
    <>
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
            <RegisterPage
              lang={lang}
              setLang={setLang}
              isAuthenticated={auth.isAuthenticated}
              signUpQuick={auth.signUpQuick}
              onGoogleSignIn={auth.signInWithGoogle}
            />
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
              <Route path="activate" element={<BusinessActivationPage lang={lang} />} />
                <Route
                  element={
                    <SubscriptionProvider user={auth.user} authMode={auth.mode}>
                      <EmailVerificationGateOutlet authMode={auth.mode} user={auth.user}>
                        <DeviceActivationProvider authMode={auth.mode} user={auth.user}>
                          <DeviceActivationGateOutlet />
                        </DeviceActivationProvider>
                      </EmailVerificationGateOutlet>
                    </SubscriptionProvider>
                  }
                >
                <Route
                  path="device-limit"
                  element={<DeviceLimitReachedPage lang={lang} onSignOut={auth.signOut} />}
                />
                <Route element={<InternalAdminOutlet />}>
                  <Route path="internal/waka" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/shops" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/devices" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/analytics" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/support" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
                  <Route path="internal/waka/billing" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
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
                  <Route path="internal/waka/shop/:shopId" element={<InternalShopOpsPage lang={lang} email={auth.email} />} />
                </Route>
                <Route
                  element={
                    <PosDataProvider lang={lang} accountKey={auth.accountKey}>
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
            <Route
              path="office/purchases"
              element={
                <RoleProtectedRoute permission="purchases.view">
                  <PurchasesPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/purchases/:purchaseId"
              element={
                <RoleProtectedRoute permission="purchases.view">
                  <PurchaseDetailPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
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
                <RoleProtectedRoute permission="settings.view">
                  <Suspense fallback={<LazyWait />}>
                    <MarketingAgentPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
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
                <RoleProtectedRoute permission="stock.view">
                  <StockPage lang={lang} />
                </RoleProtectedRoute>
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
            <Route
              path="suppliers"
              element={
                <RoleProtectedRoute permission="suppliers.view">
                  <SuppliersPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="suppliers/:supplierId"
              element={
                <RoleProtectedRoute permission="suppliers.view">
                  <SupplierDetailPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="restock"
              element={
                <RoleProtectedRoute permission="purchases.record">
                  <RestockPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route path="inventory" element={<Navigate to="/stock" replace />} />
            <Route
              path="pos"
              element={
                <Suspense fallback={<LazyWait />}>
                  <PosPage lang={lang} />
                </Suspense>
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
              path="owner/activity"
              element={
                <RoleProtectedRoute permission="owner.activity">
                  <Suspense fallback={<LazyWait />}>
                    <StaffActivityPage lang={lang} />
                  </Suspense>
                </RoleProtectedRoute>
              }
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
              path="settings/hospitality"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsChangeGate lang={lang}>
                    <SettingsHospitalityPage lang={lang} />
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
                    <ConnectedDevicesPage lang={lang} />
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
                    <SettingsDiagnosticsPage lang={lang} />
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
    </>
  );
}

function App() {
  const Router = isElectronDesktop() ? HashRouter : BrowserRouter;
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}

export default App;
