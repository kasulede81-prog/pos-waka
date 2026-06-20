/**
 * Resolve and install a session actor before gated cloud recovery (AppShell not mounted yet).
 */

import type { User } from "@supabase/supabase-js";
import { usePosStore } from "../store/usePosStore";
import { fetchShopMemberRoleForUser } from "./shopMemberRole";
import { resolveSessionActor, type SessionActor } from "./sessionActor";
import { hasSupabaseConfig, supabase } from "./supabase";

export type RecoveryActorResult =
  | { ok: true; actor: SessionActor }
  | { ok: false; errorKey: string; message: string };

export function resolveRecoverySessionActor(input: {
  user: User;
  email?: string | null;
}): SessionActor {
  const preferences = usePosStore.getState().preferences;
  return resolveSessionActor({
    mode: "supabase",
    user: input.user,
    email: input.email ?? input.user.email,
    preferences,
    shopMemberRole: null,
  });
}

/**
 * Install owner/member actor from the authenticated Supabase session for recovery bootstrap.
 * AppShell overwrites this when it mounts after recovery succeeds.
 */
export async function ensureRecoverySessionActor(): Promise<RecoveryActorResult> {
  if (!hasSupabaseConfig || !supabase) {
    return { ok: false, errorKey: "noSelection", message: "Supabase session unavailable" };
  }

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    return { ok: false, errorKey: "noSelection", message: "No authenticated user for recovery" };
  }

  const shopMemberRole = await fetchShopMemberRoleForUser(user.id);
  const actor = resolveSessionActor({
    mode: "supabase",
    user,
    email: user.email,
    preferences: usePosStore.getState().preferences,
    shopMemberRole,
  });

  usePosStore.getState().setSessionActor(actor);
  return { ok: true, actor };
}
