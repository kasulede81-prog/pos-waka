import { performEnterpriseLogout } from "./auth/enterpriseLogout";

/** Full local + Supabase sign-out, then hard navigation to login (avoids stale React auth state). */
export async function hardSignOutToLogin(): Promise<void> {
  await performEnterpriseLogout({ hardNavigate: true });
}
