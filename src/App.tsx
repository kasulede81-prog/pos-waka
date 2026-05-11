import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RoleProtectedRoute } from "./components/RoleProtectedRoute";
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
import { SettingsPage } from "./pages/SettingsPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { PosDataProvider } from "./providers/PosDataProvider";
import { SyncStatusProvider } from "./hooks/useSyncStatus";
import { BackOfficeSessionProvider } from "./context/BackOfficeSessionContext";
import { OfficeHubPage } from "./pages/OfficeHubPage";
import { StockPage } from "./pages/StockPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { RestockPage } from "./pages/RestockPage";
import { CloseDayPage } from "./pages/CloseDayPage";
import type { Language } from "./types";

const OwnerDashboardPage = lazy(() =>
  import("./pages/OwnerDashboardPage").then((m) => ({ default: m.OwnerDashboardPage })),
);
const StaffActivityPage = lazy(() =>
  import("./pages/StaffActivityPage").then((m) => ({ default: m.StaffActivityPage })),
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
              mode={auth.mode}
            />
          }
        />

        <Route path="/register" element={<RegisterPage lang={lang} setLang={setLang} isAuthenticated={auth.isAuthenticated} signUp={auth.signUp} />} />

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

        <Route element={<ProtectedRoute initializing={auth.initializing} isAuthenticated={auth.isAuthenticated} />}>
          <Route
            element={
              <PosDataProvider lang={lang}>
                <SyncStatusProvider>
                  <BackOfficeSessionProvider>
                    <AppShell
                      lang={lang}
                      setLang={setLang}
                      onSignOut={auth.signOut}
                      user={auth.user}
                      email={auth.email}
                      authMode={auth.mode}
                    />
                  </BackOfficeSessionProvider>
                </SyncStatusProvider>
              </PosDataProvider>
            }
          >
            <Route index element={<DashboardPage lang={lang} />} />
            <Route path="office" element={<OfficeHubPage lang={lang} />} />
            <Route path="stock" element={<StockPage lang={lang} />} />
            <Route path="suppliers" element={<SuppliersPage lang={lang} />} />
            <Route path="restock" element={<RestockPage lang={lang} />} />
            <Route path="inventory" element={<Navigate to="/stock" replace />} />
            <Route path="pos" element={<PosPage lang={lang} />} />
            <Route path="reports" element={<ReportsPage lang={lang} />} />
            <Route path="close-day" element={<CloseDayPage lang={lang} />} />
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
            <Route path="receipts" element={<ReceiptsPage lang={lang} />} />
            <Route
              path="settings"
              element={
                <SettingsPage
                  lang={lang}
                  email={auth.email}
                  shopName={auth.shopName}
                  onSignOut={auth.signOut}
                  user={auth.user}
                  authMode={auth.mode}
                />
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={auth.isAuthenticated ? "/" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
