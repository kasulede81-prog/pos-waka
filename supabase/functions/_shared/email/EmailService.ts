import { Resend } from "npm:resend@4.0.1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  emailFromAddress,
  emailReplyTo,
  isSyntheticPhoneLoginEmail,
  resendApiKey,
} from "./config.ts";
import { logEmailDelivery } from "./logDelivery.ts";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  template: string;
  recipientUserId?: string | null;
  metadata?: Record<string, unknown>;
  tags?: { name: string; value: string }[];
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string; skipped?: boolean };

export class EmailService {
  private resend: Resend | null;
  private admin: SupabaseClient | null;

  constructor(admin: SupabaseClient | null = null) {
    const key = resendApiKey();
    this.resend = key ? new Resend(key) : null;
    this.admin = admin;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const to = input.to.trim().toLowerCase();
    if (!to.includes("@")) {
      await logEmailDelivery(this.admin, {
        template: input.template,
        recipientEmail: to,
        recipientUserId: input.recipientUserId,
        subject: input.subject,
        status: "skipped",
        errorMessage: "invalid_recipient",
        metadata: input.metadata,
      });
      return { ok: false, error: "invalid_recipient", skipped: true };
    }

    if (isSyntheticPhoneLoginEmail(to)) {
      await logEmailDelivery(this.admin, {
        template: input.template,
        recipientEmail: to,
        recipientUserId: input.recipientUserId,
        subject: input.subject,
        status: "skipped",
        errorMessage: "synthetic_phone_login_email",
        metadata: input.metadata,
      });
      return { ok: false, error: "synthetic_phone_login_email", skipped: true };
    }

    if (!this.resend) {
      await logEmailDelivery(this.admin, {
        template: input.template,
        recipientEmail: to,
        recipientUserId: input.recipientUserId,
        subject: input.subject,
        status: "failed",
        errorMessage: "resend_not_configured",
        metadata: input.metadata,
      });
      return { ok: false, error: "resend_not_configured" };
    }

    const { data, error } = await this.resend.emails.send({
      from: emailFromAddress(),
      replyTo: emailReplyTo(),
      to: [to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tags,
    });

    if (error) {
      const message = error.message ?? "resend_send_failed";
      await logEmailDelivery(this.admin, {
        template: input.template,
        recipientEmail: to,
        recipientUserId: input.recipientUserId,
        subject: input.subject,
        status: "failed",
        errorMessage: message,
        metadata: { ...input.metadata, resendName: error.name },
      });
      return { ok: false, error: message };
    }

    const id = data?.id ?? "unknown";
    await logEmailDelivery(this.admin, {
      template: input.template,
      recipientEmail: to,
      recipientUserId: input.recipientUserId,
      subject: input.subject,
      status: "sent",
      resendId: id,
      metadata: input.metadata,
    });

    return { ok: true, id };
  }
}
