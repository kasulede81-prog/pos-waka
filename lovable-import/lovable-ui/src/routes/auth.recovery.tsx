import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout } from "@/components/auth/auth-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/auth/recovery")({
  head: () => seoHead({ title: "Set new password — Waka POS", description: "Set a new password for your Waka POS account.", path: "/auth/recovery" }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    navigate({ to: "/dashboard" });
  };

  return (
    <AuthLayout title={t("auth.recovery.title")} subtitle={t("auth.recovery.body")}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("auth.password")}</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} type="submit" className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {loading ? "…" : t("auth.recovery.update")}
        </button>
      </form>
    </AuthLayout>
  );
}
