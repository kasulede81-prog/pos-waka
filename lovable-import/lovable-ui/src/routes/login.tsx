import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    setSuccess(true);
    window.setTimeout(() => navigate({ to: "/dashboard" }), 450);
  };

  const handleGoogle = async () => {
    setError("");
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth/callback" });
    if (result.error) setError(result.error.message);
    else if (!result.redirected) navigate({ to: "/dashboard" });
  };

  return (
    <AuthLayout title={t("auth.welcome")} subtitle={t("auth.welcome.body")}>
      <div className={cn("transition-all duration-300", success && "scale-[.98] opacity-0") }>
        <button type="button" onClick={handleGoogle} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-background text-sm font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted active:scale-[.98]">Continue with Google</button>
        <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70"><span className="h-px flex-1 bg-border" />{t("auth.or")}<span className="h-px flex-1 bg-border" /></div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="group relative block"><span className="sr-only">{t("auth.email")}</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email or phone number" className="peer h-14 w-full rounded-xl border border-input bg-background px-4 pt-4 text-sm outline-none transition-all placeholder:text-transparent focus:border-primary focus:ring-4 focus:ring-primary/10" /><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wider peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wider">Email or phone number</span></label>
          <label className="group relative block"><span className="sr-only">{t("auth.password")}</span><input type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="peer h-14 w-full rounded-xl border border-input bg-background px-4 pr-12 pt-4 text-sm outline-none transition-all placeholder:text-transparent focus:border-primary focus:ring-4 focus:ring-primary/10" /><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wider peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wider">Password</span><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></label>
          <div className="flex items-center justify-between text-xs"><label className="flex cursor-pointer items-center gap-2 text-muted-foreground"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 rounded border-input accent-primary" />Remember me</label><Link to="/forgot-password" className="font-semibold text-primary transition-colors hover:text-primary/80">{t("auth.forgot")}</Link></div>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <button disabled={loading || success} type="submit" className="mt-1 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-70">{success ? <Check className="size-5" /> : loading ? <LoaderCircle className="size-5 animate-spin" /> : t("auth.signin")}</button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">{t("auth.no_account")} <Link to="/register" className="font-semibold text-primary transition-colors hover:text-primary/80">Create one</Link></p>
      </div>
    </AuthLayout>
  );
}
