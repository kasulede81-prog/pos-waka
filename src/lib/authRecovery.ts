import { flushPendingPersist, usePosStore } from "../store/usePosStore";
import { setActiveAccountKey } from "../offline/accountScope";
import { clearStaffAuth } from "./staffOfflineAuth";
import { supabase } from "./supabase";

/** Full local + Supabase sign-out, then hard navigation to login (avoids stale React auth state). */
export async function hardSignOutToLogin(): Promise<void> {
  clearStaffAuth();
  flushPendingPersist();
  usePosStore.getState().resetForSignOut();
  setActiveAccountKey(null);
  try {
    await supabase?.auth.signOut();
  } catch {
    /* ignore */
  }
  window.location.replace("/login");
}
