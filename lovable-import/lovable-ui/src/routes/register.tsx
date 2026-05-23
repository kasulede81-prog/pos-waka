import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { AuthLayout } from "@/components/auth/auth-layout";
import { useI18n } from "@/lib/i18n";
import { seoHead } from "@/components/seo-head";

export const Route = createFileRoute("/register")({
  head: () => seoHead({ title: "Create your shop — Waka POS", description: "Start your Waka POS account free in less than a minute.", path: "/register" }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: RegisterPage,
});

function RegisterPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { shop_name: shopName, owner_name: ownerName, phone },
      },
    });
    setLoading(false);
    if (error) return setError(error.message);
    navigate({ to: "/verify-email" });
  };

  const handleGoogle = async () => {
    setError("");
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth/callback" });
    if (result.error) setError(result.error.message);
    else if (!result.redirected) navigate({ to: "/dashboard" });
  };

  return (
    <AuthLayout title={t("auth.signup.title")} subtitle={t("auth.signup.body")}>
      <button onClick={handleGoogle} className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold hover:bg-muted">
        {t("auth.continue_google")}
      </button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" /> {t("auth.or")} <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {[
          { label: t("auth.shop_name"), value: shopName, set: setShopName, type: "text" },
          { label: t("auth.owner_name"), value: ownerName, set: setOwnerName, type: "text" },
          { label: t("auth.phone"), value: phone, set: setPhone, type: "tel" },
          { label: t("auth.email"), value: email, set: setEmail, type: "email" },
          { label: t("auth.password"), value: password, set: setPassword, type: "password" },
        ].map((f) => (
          <div key={f.label}>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{f.label}</label>
            <input type={f.type} required value={f.value} onChange={(e) => f.set(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button disabled={loading} type="submit" className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {loading ? "…" : t("auth.signup")}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {t("auth.have_account")} <Link to="/login" className="font-bold text-primary hover:underline">{t("auth.signin")}</Link>
      </p>
    </AuthLayout>
  );
}
