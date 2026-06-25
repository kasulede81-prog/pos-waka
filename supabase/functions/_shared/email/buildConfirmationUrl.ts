export type AuthEmailData = {
  token_hash: string;
  email_action_type: string;
  redirect_to: string;
};

/** Supabase Auth verify URL — same shape as {{ .ConfirmationURL }} in dashboard templates. */
export function buildAuthConfirmationUrl(supabaseUrl: string, emailData: AuthEmailData): string {
  const base = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/verify`;
  const params = new URLSearchParams({
    token: emailData.token_hash,
    type: emailData.email_action_type,
    redirect_to: emailData.redirect_to,
  });
  return `${base}?${params.toString()}`;
}
