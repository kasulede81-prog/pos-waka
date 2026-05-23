import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Clock, ShieldAlert, LogOut, Mail, Phone } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { useProfile } from "@/lib/use-profile";
import { useAuth } from "@/lib/auth-context";
import { WakaLogo } from "@/components/waka-logo";

export const Route = createFileRoute("/pending")({
  head: () => seoHead({ title: "Awaiting approval — Waka POS", description: "Your shop activation is being reviewed.", path: "/pending" }),
  component: PendingPage,
});

function PendingPage() {
  const { profile, isAdmin, loading } = useProfile();
  const { signOut, user } = useAuth();
  const router = useRouter();

  if (loading) return null;

  // Already active or admin — bounce to dashboard
  if (isAdmin || profile?.status === "active") {
    router.navigate({ to: "/dashboard" });
    return null;
  }

  const suspended = profile?.status === "suspended";

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-waka-50 to-background p-4">
      <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card p-8 shadow-sm">
        <WakaLogo size="sm" />
        <div className="mt-6 grid h-14 w-14 place-items-center rounded-2xl bg-waka-100 text-waka-700">
          {suspended ? <ShieldAlert className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
        </div>
        <h1 className="mt-4 text-2xl font-black">
          {suspended ? "Your shop is suspended" : "We're reviewing your shop"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {suspended
            ? "Your access to Waka POS has been paused. Reach out to support to resolve this."
            : "Thanks for signing up. Our team approves new shops within a few hours during business days. We'll email you once your shop is active."}
        </p>

        <div className="mt-6 rounded-2xl bg-muted/50 p-4 text-xs">
          <p><span className="font-bold">Signed in as:</span> {user?.email}</p>
          {profile?.shop_name && <p className="mt-1"><span className="font-bold">Shop:</span> {profile.shop_name}</p>}
          <p className="mt-1"><span className="font-bold">Status:</span> {profile?.status ?? "pending"}</p>
        </div>

        <div className="mt-6 flex flex-col gap-2 text-sm">
          <a href="https://wa.me/256700000000" className="inline-flex items-center gap-2 text-waka-700 hover:underline">
            <Phone className="h-4 w-4" /> WhatsApp support
          </a>
          <a href="mailto:support@waka.ug" className="inline-flex items-center gap-2 text-waka-700 hover:underline">
            <Mail className="h-4 w-4" /> support@waka.ug
          </a>
        </div>

        <button
          onClick={async () => { await signOut(); router.navigate({ to: "/" }); }}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold text-foreground/80 hover:bg-muted"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
