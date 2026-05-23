import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { AuthLayout } from "@/components/auth/auth-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/login")({
  head: () => seoHead({ title: "Sign in — Waka POS", description: "Sign in to your Waka POS account.", path: "/login" }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    navigate({ to: "/dashboard" });
  };

  const handleGoogle = async () => {
    setError("");
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth/callback" });
    if (result.error) setError(result.error.message);
    else if (!result.redirected) navigate({ to: "/dashboard" });
  };

  return (
    <AuthLayout title={t("auth.welcome")} subtitle={t("auth.welcome.body")}>
      <button onClick={handleGoogle} className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold hover:bg-muted">
        {t("auth.continue_google")}
      </button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t("auth.or")}
        <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("auth.email")}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("auth.password")}</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} type="submit" className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {loading ? "…" : t("auth.signin")}
        </button>
      </form>
      <div className="mt-5 flex items-center justify-between text-sm">
        <Link to="/forgot-password" className="text-primary hover:underline">{t("auth.forgot")}</Link>
        <Link to="/register" className="text-muted-foreground hover:text-primary">{t("auth.no_account")}</Link>
      </div>
    </AuthLayout>
  );
}
