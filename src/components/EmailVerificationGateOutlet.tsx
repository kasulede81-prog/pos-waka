import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { isSupabaseEmailVerified } from "../lib/emailVerification";

export function pathAllowedWhenEmailUnverified(pathname: string): boolean {
  const p = pathname.split("?")[0] || "/";
  const allowed = [
    "/verify-email",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/auth/recovery",
    "/settings",
    "/support",
    "/pos",
    "/receipts",
    "/customers",
    "/debts",
    "/onboarding",
    "/upgrade",
    "/device-limit",
    "/device-activating",
    "/account",
  ];
  if (allowed.includes(p)) return true;
  if (p.startsWith("/settings/")) return true;
  if (p.startsWith("/pos/")) return true;
  return false;
}

type Props = {
  authMode: "supabase" | "local";
  user: User | null | undefined;
  children?: ReactNode;
};

/** Blocks cloud-backed routes until email is verified (Google/Apple exempt). */
export function EmailVerificationGateOutlet({ authMode, user, children }: Props) {
  const location = useLocation();
  const outlet = children ?? <Outlet />;

  if (authMode !== "supabase" || !user) {
    return <>{outlet}</>;
  }

  if (isSupabaseEmailVerified(user)) {
    return <>{outlet}</>;
  }

  const path = location.pathname.split("?")[0] || "/";
  if (pathAllowedWhenEmailUnverified(path)) {
    return <>{outlet}</>;
  }

  return (
    <Navigate
      to="/verify-email"
      replace
      state={{ email: user.email ?? "", from: location.pathname }}
    />
  );
}
