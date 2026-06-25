import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type EmailDeliveryStatus = "sent" | "failed" | "skipped";

export type EmailDeliveryLogInput = {
  template: string;
  recipientEmail: string;
  recipientUserId?: string | null;
  subject?: string | null;
  status: EmailDeliveryStatus;
  resendId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logEmailDelivery(
  admin: SupabaseClient | null,
  input: EmailDeliveryLogInput,
): Promise<void> {
  if (!admin) {
    console.warn("[waka-email] delivery log skipped — no admin client", input.template, input.status);
    return;
  }

  const row = {
    template: input.template,
    recipient_email: input.recipientEmail.trim().toLowerCase(),
    recipient_user_id: input.recipientUserId ?? null,
    subject: input.subject ?? null,
    status: input.status,
    resend_id: input.resendId ?? null,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  };

  const { error } = await admin.from("email_delivery_log").insert(row);
  if (error) {
    console.error("[waka-email] failed to write delivery log", error.message, row.template);
  }
}
