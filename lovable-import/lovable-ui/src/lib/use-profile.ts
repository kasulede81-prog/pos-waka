import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type ProfileStatus = "pending" | "active" | "suspended";

export interface Profile {
  id: string;
  email: string | null;
  shop_name: string | null;
  owner_name: string | null;
  phone: string | null;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

export function useProfile() {
  const { user, session } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    setProfile((prof as Profile | null) ?? null);
    setIsAdmin(!!roles?.some((r) => r.role === "admin"));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load, session?.access_token]);

  return { profile, isAdmin, loading, reload: load };
}
