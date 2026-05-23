import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type WakaRole = "super_admin" | "operations_admin" | "support_admin" | "field_agent";

export type WakaInternalMe = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: WakaRole;
  assigned_districts: string[];
  is_active: boolean;
};

export function roleLabel(r: WakaRole | null | undefined): string {
  switch (r) {
    case "super_admin": return "Super admin";
    case "operations_admin": return "Operations admin";
    case "support_admin": return "Support admin";
    case "field_agent": return "Field agent";
    default: return "—";
  }
}

export function useWakaInternalMe() {
  const [me, setMe] = useState<WakaInternalMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.rpc("waka_internal_me");
      if (!mounted) return;
      if (error || !data) {
        setMe(null);
      } else {
        // RPC returns a row or empty; supabase wraps as object or array
        const row = Array.isArray(data) ? data[0] : data;
        setMe(row ? (row as WakaInternalMe) : null);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  return { me, loading, isAdmin: !!me, isSuper: me?.role === "super_admin" };
}

export function canResolveSupport(role?: WakaRole | null) {
  return role === "super_admin" || role === "support_admin" || role === "operations_admin";
}
export function canManageSubs(role?: WakaRole | null) {
  return role === "super_admin" || role === "operations_admin";
}
export function canShopSupportActions(role?: WakaRole | null) {
  return role === "super_admin" || role === "support_admin";
}
