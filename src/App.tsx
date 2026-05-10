import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./hooks/useAuth";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthRecoveryPage } from "./pages/AuthRecoveryPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { InventoryPage } from "./pages/InventoryPage";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import type { Language } from "./types";

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
          <Route element={<AppShell lang={lang} setLang={setLang} onSignOut={auth.signOut} />}>
            <Route index element={<DashboardPage lang={lang} />} />
            <Route path="inventory" element={<InventoryPage lang={lang} />} />
            <Route path="pos" element={<PosPage lang={lang} />} />
            <Route path="customers" element={<CustomersPage lang={lang} />} />
            <Route path="receipts" element={<ReceiptsPage lang={lang} />} />
            <Route
              path="settings"
              element={
                <SettingsPage lang={lang} email={auth.email} shopName={auth.shopName} onSignOut={auth.signOut} />
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
