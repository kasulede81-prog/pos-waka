import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/app-shell";
import { useProfile } from "@/lib/use-profile";
import { Loader2 } from "lucide-react";
import { Navigate } from "@tanstack/react-router";
import { startCloudSync, stopCloudSync } from "@/lib/cloud-sync";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } as never });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { profile, isAdmin, loading } = useProfile();

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) void startCloudSync(data.user.id);
    });
    return () => {
      cancelled = true;
      stopCloudSync();
    };
  }, []);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-waka-700" />
      </div>
    );
  }

  // Profile may not exist yet for very first paint after signup — treat as pending
  const status = profile?.status ?? "pending";

  if (status !== "active" && !isAdmin) {
    return <Navigate to="/pending" />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
