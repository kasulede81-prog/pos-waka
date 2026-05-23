import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout } from "@/components/auth/auth-layout";

export const Route = createFileRoute("/auth/callback")({
  component: CallbackPage,
});

function CallbackPage() {
  const navigate = useNavigate();
  useEffect(() => {
    const check = async () => {
      // Allow Supabase a moment to process the hash/code
      await new Promise((r) => setTimeout(r, 200));
      const { data } = await supabase.auth.getSession();
      navigate({ to: data.session ? "/dashboard" : "/login" });
    };
    check();
  }, [navigate]);
  return (
    <AuthLayout title="Signing you in…">
      <div className="grid place-items-center py-10">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    </AuthLayout>
  );
}
