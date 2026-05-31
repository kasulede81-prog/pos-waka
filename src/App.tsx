import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
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
import { SettingsShopPage } from "./pages/SettingsShopPage";
import { SettingsReceiptPage } from "./pages/SettingsReceiptPage";
import { SettingsSellingPage } from "./pages/SettingsSellingPage";
import { SettingsPinPage } from "./pages/SettingsPinPage";
import { SettingsPasswordPage } from "./pages/SettingsPasswordPage";
import { SettingsNotificationsPage } from "./pages/SettingsNotificationsPage";
import { SettingsDataRetentionPage } from "./pages/SettingsDataRetentionPage";
import { ArchiveDataPage } from "./pages/ArchiveDataPage";
import { MonthlyReportsPage } from "./pages/MonthlyReportsPage";
import { BackupSyncPage } from "./pages/BackupSyncPage";
import { AccountPage } from "./pages/AccountPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { MarketingHomePage } from "./pages/MarketingHomePage";
import { AboutPage } from "./pages/public/AboutPage";
import { ContactPage } from "./pages/public/ContactPage";
import { FounderPage } from "./pages/public/FounderPage";
import { CompanyPage } from "./pages/public/CompanyPage";
import { VerifyAgentPage } from "./pages/public/VerifyAgentPage";
import { DemoExperiencePage } from "./pages/DemoExperiencePage";
import { BusinessActivationPage } from "./pages/BusinessActivationPage";
import { PosDataProvider } from "./providers/PosDataProvider";
import { NativeSplashGate } from "./components/NativeSplashGate";
import { SyncStatusProvider } from "./hooks/useSyncStatus";
import { BackOfficeSessionProvider } from "./context/BackOfficeSessionContext";
import { ProfitPage } from "./pages/ProfitPage";
import { StockPage } from "./pages/StockPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { RestockPage } from "./pages/RestockPage";
import { CloseDayPage } from "./pages/CloseDayPage";
import { CashExpensesPage } from "./pages/CashExpensesPage";
import { StaffAccessPage } from "./pages/StaffAccessPage";
import { UpgradePage } from "./pages/UpgradePage";
import { SupportPage } from "./pages/SupportPage";
import { LegalPolicyPage } from "./pages/LegalPolicyPage";
import { InternalWakaAdminPage } from "./pages/InternalWakaAdminPage";
import { InternalAdminOutlet } from "./components/routing/InternalAdminOutlet";
import { InternalShopOpsPage } from "./pages/InternalShopOpsPage";
import { ShopOnboardingPage } from "./pages/ShopOnboardingPage";
import { OnboardingRouteGate } from "./components/onboarding/OnboardingRouteGate";
import { NativeMarketingGuard } from "./components/NativeMarketingGuard";
import { NativePublicGuard } from "./components/NativePublicGuard";
import { unauthenticatedEntryPath } from "./lib/nativeApp";
import { SubscriptionProvider } from "./context/SubscriptionContext";
import type { Language } from "./types";
import { StabilityDiagnosticsOverlay } from "./components/dev/StabilityDiagnosticsOverlay";
import { installNetworkDiagnosticsProbe, isDiagnosticsEnabled } from "./lib/stabilityDiagnostics";

const OwnerDashboardPage = lazy(() =>
  import("./pages/OwnerDashboardPage").then((m) => ({ default: m.OwnerDashboardPage })),
);
const StaffActivityPage = lazy(() =>
  import("./pages/StaffActivityPage").then((m) => ({ default: m.StaffActivityPage })),
);
const HardwareSettingsPage = lazy(() =>
  import("./pages/HardwareSettingsPage").then((m) => ({ default: m.HardwareSettingsPage })),
);
const MarketingAgentPage = lazy(() =>
  import("./pages/MarketingAgentPage").then((m) => ({ default: m.MarketingAgentPage })),
);
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PosPage = lazy(() => import("./pages/PosPage").then((m) => ({ default: m.PosPage })));
const OfficeHubPage = lazy(() => import("./pages/OfficeHubPage").then((m) => ({ default: m.OfficeHubPage })));
const ReceiptsPage = lazy(() => import("./pages/ReceiptsPage").then((m) => ({ default: m.ReceiptsPage })));

function LazyWait() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-slate-600">Loading…</div>
  );
}

function App() {
  const auth = useAuth();
  const [lang, setLang] = useState<Language>("en");
  const showDiagnostics = isDiagnosticsEnabled();

  useEffect(() => {
    if (showDiagnostics) installNetworkDiagnosticsProbe();
  }, [showDiagnostics]);

  return (
    <BrowserRouter>
      {showDiagnostics ? <StabilityDiagnosticsOverlay /> : null}
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
            <SubscriptionProvider user={auth.user} authMode={auth.mode}>
              <SupportPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />
            </SubscriptionProvider>
          }
        />
        <Route path="/terms" element={<LegalPolicyPage kind="terms" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/privacy" element={<LegalPolicyPage kind="privacy" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route
          path="/refund-policy"
          element={<LegalPolicyPage kind="refund" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />}
        />
        <Route
          path="/acceptable-use"
          element={<LegalPolicyPage kind="acceptable-use" lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />}
        />
        <Route path="/verify-agent/:agentId" element={<VerifyAgentPage lang={lang} />} />

        <Route element={<NativeMarketingGuard isAuthenticated={auth.isAuthenticated} />}>
          <Route path="/home" element={<MarketingHomePage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/about" element={<AboutPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/contact" element={<ContactPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/founder" element={<FounderPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
          <Route path="/about/founder" element={<Navigate to="/founder" replace />} />
          <Route path="/company" element={<CompanyPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
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
                    <Outlet />
                  </SubscriptionProvider>
                }
              >
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
                <Route path="onboarding" element={<ShopOnboardingPage lang={lang} setLang={setLang} onSignOut={auth.signOut} />} />
                <Route
                  element={
                    <SyncStatusProvider>
                      <BackOfficeSessionProvider>
                        <AppShell
                            lang={lang}
                            setLang={setLang}
                            onSignOut={auth.signOut}
                            user={auth.user}
                            email={auth.email}
                            authMode={auth.mode}
                            staffSession={auth.staffSession}
                          />
                      </BackOfficeSessionProvider>
                    </SyncStatusProvider>
                  }
                >
            <Route
              index
              element={
                <Suspense fallback={<LazyWait />}>
                  <DashboardPage lang={lang} />
                </Suspense>
              }
            />
            <Route
              path="office"
              element={
                <Suspense fallback={<LazyWait />}>
                  <OfficeHubPage lang={lang} />
                </Suspense>
              }
            />
            <Route
              path="office/profit"
              element={
                <RoleProtectedRoute permission="back_office.access">
                  <ProfitPage lang={lang} />
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
              path="suppliers"
              element={
                <RoleProtectedRoute permission="suppliers.view">
                  <SuppliersPage lang={lang} />
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
              path="reports"
              element={
                <RoleProtectedRoute permission="reports.view">
                  <ReportsPage lang={lang} />
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
                  <StaffAccessPage lang={lang} />
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
              path="settings/shop"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsShopPage
                    lang={lang}
                    email={auth.email}
                    shopName={auth.shopName}
                    user={auth.user}
                    authMode={auth.mode}
                  />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/receipt"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsReceiptPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/selling"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsSellingPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/pin"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsPinPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/password"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsPasswordPage
                    lang={lang}
                    authMode={auth.mode}
                    updatePassword={auth.updatePassword}
                  />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/notifications"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <SettingsNotificationsPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/retention"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <SettingsDataRetentionPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="settings/archive"
              element={
                <RoleProtectedRoute permission="settings.shop">
                  <ArchiveDataPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route
              path="office/monthly-reports"
              element={
                <RoleProtectedRoute permission="reports.view">
                  <MonthlyReportsPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
                </Route>
              </Route>
            </Route>
          </Route>
        </Route>
        </Route>

        <Route path="*" element={<Navigate to={auth.isAuthenticated ? "/" : unauthenticatedEntryPath()} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
