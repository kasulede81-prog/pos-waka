import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthLayout } from "@/components/auth/auth-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/forgot-password")({
  head: () => seoHead({ title: "Reset password — Waka POS", description: "Reset your Waka POS password.", path: "/forgot-password" }),
  component: ForgotPage,
});

function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/recovery`,
    });
    setLoading(false);
    if (error) return setError(error.message);
    setSent(true);
  };

  return (
    <AuthLayout title={t("auth.forgot.title")} subtitle={t("auth.forgot.body")}>
      {sent ? (
        <p className="rounded-xl bg-waka-50 p-4 text-sm">{t("auth.verify.body")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("auth.email")}</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button disabled={loading} type="submit" className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {loading ? "…" : t("auth.forgot.send")}
          </button>
        </form>
      )}
      <Link to="/login" className="mt-5 block text-center text-sm text-muted-foreground hover:text-primary">{t("auth.signin")}</Link>
    </AuthLayout>
  );
}
