import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BusinessProfileRequiredRoute } from "./components/BusinessProfileRequiredRoute";
import { RoleProtectedRoute } from "./components/RoleProtectedRoute";
import { ActivationGateOutlet } from "./components/ActivationGateOutlet";
import { ActivationProvider } from "./context/ActivationContext";
import { useAuth } from "./hooks/useAuth";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthRecoveryPage } from "./pages/AuthRecoveryPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsHubPage } from "./pages/SettingsHubPage";
import { SettingsShopPage } from "./pages/SettingsShopPage";
import { SettingsSellingPage } from "./pages/SettingsSellingPage";
import { SettingsPinPage } from "./pages/SettingsPinPage";
import { SettingsNotificationsPage } from "./pages/SettingsNotificationsPage";
import { BackupSyncPage } from "./pages/BackupSyncPage";
import { AccountPage } from "./pages/AccountPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { MarketingHomePage } from "./pages/MarketingHomePage";
import { AboutPage } from "./pages/public/AboutPage";
import { ContactPage } from "./pages/public/ContactPage";
import { FounderPage } from "./pages/public/FounderPage";
import { CompanyPage } from "./pages/public/CompanyPage";
import { DemoExperiencePage } from "./pages/DemoExperiencePage";
import { BusinessActivationPage } from "./pages/BusinessActivationPage";
import { PosDataProvider } from "./providers/PosDataProvider";
import { SyncStatusProvider } from "./hooks/useSyncStatus";
import { BackOfficeSessionProvider } from "./context/BackOfficeSessionContext";
import { OfficeHubPage } from "./pages/OfficeHubPage";
import { ProfitPage } from "./pages/ProfitPage";
import { StockPage } from "./pages/StockPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { RestockPage } from "./pages/RestockPage";
import { CloseDayPage } from "./pages/CloseDayPage";
import { StaffAccessPage } from "./pages/StaffAccessPage";
import { UpgradePage } from "./pages/UpgradePage";
import { SupportPage } from "./pages/SupportPage";
import { LegalPolicyPage } from "./pages/LegalPolicyPage";
import { InternalWakaAdminPage } from "./pages/InternalWakaAdminPage";
import { InternalShopOpsPage } from "./pages/InternalShopOpsPage";
import { SubscriptionProvider } from "./context/SubscriptionContext";
import type { Language } from "./types";

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

function LazyWait() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-slate-600">Loading…</div>
  );
}

function App() {
  const auth = useAuth();
  const [lang, setLang] = useState<Language>("en");

  return (
    <BrowserRouter>
      <Routes>
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
              signUp={auth.signUp}
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

        <Route
          path="/auth/recovery"
          element={<AuthRecoveryPage lang={lang} setLang={setLang} mode={auth.mode} updatePassword={auth.updatePassword} />}
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

        <Route path="/home" element={<MarketingHomePage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/about" element={<AboutPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/contact" element={<ContactPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/founder" element={<FounderPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/about/founder" element={<Navigate to="/founder" replace />} />
        <Route path="/company" element={<CompanyPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} />} />
        <Route path="/demo" element={<DemoExperiencePage lang={lang} isAuthenticated={auth.isAuthenticated} />} />

        <Route element={<ProtectedRoute initializing={auth.initializing} isAuthenticated={auth.isAuthenticated} />}>
          <Route element={<BusinessProfileRequiredRoute authMode={auth.mode} />}>
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
                    <PosDataProvider lang={lang} accountKey={auth.accountKey}>
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
                    </PosDataProvider>
                  </SubscriptionProvider>
                }
              >
            <Route index element={<DashboardPage lang={lang} />} />
            <Route path="office" element={<OfficeHubPage lang={lang} />} />
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
            <Route path="pos" element={<PosPage lang={lang} />} />
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
            <Route path="receipts" element={<ReceiptsPage lang={lang} />} />
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
              path="settings/notifications"
              element={
                <RoleProtectedRoute permission="settings.view">
                  <SettingsNotificationsPage lang={lang} />
                </RoleProtectedRoute>
              }
            />
            <Route path="internal/waka" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
            <Route path="internal/waka/admins" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
            <Route path="internal/waka/agents" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
            <Route path="internal/waka/activations" element={<InternalWakaAdminPage lang={lang} email={auth.email} />} />
            <Route path="internal/waka/shop/:shopId" element={<InternalShopOpsPage lang={lang} email={auth.email} />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={auth.isAuthenticated ? "/" : "/home"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
