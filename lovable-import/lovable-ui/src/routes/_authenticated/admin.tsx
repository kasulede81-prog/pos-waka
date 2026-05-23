import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Check, X, Pause, Play } from "lucide-react";
import { seoHead } from "@/components/seo-head";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, type Profile, type ProfileStatus } from "@/lib/use-profile";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => seoHead({ title: "Admin — Waka POS", description: "Approve shops.", path: "/admin" }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading: profileLoading } = useProfile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProfileStatus | "all">("pending");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    setProfiles((data as Profile[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  if (profileLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" />;

  const setStatus = async (id: string, status: ProfileStatus) => {
    setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, status } : p)));
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    if (error) {
      alert(error.message);
      void load();
    }
  };

  const filtered = filter === "all" ? profiles : profiles.filter((p) => p.status === filter);
  const counts = {
    pending: profiles.filter((p) => p.status === "pending").length,
    active: profiles.filter((p) => p.status === "active").length,
    suspended: profiles.filter((p) => p.status === "suspended").length,
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-waka-100 text-waka-700">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="text-2xl font-black">Internal admin</h1>
      </div>

      <div className="mt-4 inline-flex rounded-full border border-border p-1 text-xs font-bold">
        {(["pending", "active", "suspended", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 capitalize ${
              filter === f ? "bg-waka-600 text-primary-foreground" : "text-foreground/70"
            }`}
          >
            {f} {f !== "all" && <span className="opacity-70">({counts[f]})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-10 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-waka-700" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No shops match this filter.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {filtered.map((p) => (
            <li key={p.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{p.shop_name || "(no shop name)"}</p>
                  <p className="text-xs text-muted-foreground">{p.owner_name || "—"} · {p.email}</p>
                  {p.phone && <p className="text-xs text-muted-foreground">{p.phone}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Signed up {new Date(p.created_at).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    p.status === "active" ? "bg-emerald-100 text-emerald-800"
                      : p.status === "pending" ? "bg-amber-100 text-amber-800"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {p.status}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {p.status !== "active" && (
                  <button onClick={() => setStatus(p.id, "active")} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                )}
                {p.status === "active" && (
                  <button onClick={() => setStatus(p.id, "suspended")} className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-bold text-white">
                    <Pause className="h-3.5 w-3.5" /> Suspend
                  </button>
                )}
                {p.status === "suspended" && (
                  <button onClick={() => setStatus(p.id, "active")} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                    <Play className="h-3.5 w-3.5" /> Reactivate
                  </button>
                )}
                {p.status === "pending" && (
                  <button onClick={() => setStatus(p.id, "suspended")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold text-foreground/70 hover:bg-muted">
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
