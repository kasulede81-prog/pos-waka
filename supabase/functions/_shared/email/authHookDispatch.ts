import { buildAuthConfirmationUrl } from "./buildConfirmationUrl.ts";
import { EmailService } from "./EmailService.ts";
import { sendWelcomeOnSignup } from "./config.ts";
import { wrapEmailLayout } from "./layout.ts";
import {
  passwordResetPlainText,
  passwordResetSubject,
  renderPasswordResetHtml,
} from "./templates/passwordReset.ts";
import {
  renderVerifyEmailHtml,
  verifyEmailPlainText,
  verifyEmailSubject,
} from "./templates/verifyEmail.ts";
import {
  renderWelcomeEmailHtml,
  welcomeEmailPlainText,
  welcomeEmailSubject,
} from "./templates/welcome.ts";

export type AuthHookUser = {
  id: string;
  email?: string | null;
  new_email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export type AuthHookEmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new: string;
  token_hash_new: string;
  old_email?: string;
};

function displayName(user: AuthHookUser): string | null {
  const meta = user.user_metadata ?? {};
  const full = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full;
  const business = typeof meta.business_name === "string" ? meta.business_name.trim() : "";
  if (business) return business;
  const shop = typeof meta.shop_display_name === "string" ? meta.shop_display_name.trim() : "";
  return shop || null;
}

function shopName(user: AuthHookUser): string | null {
  const meta = user.user_metadata ?? {};
  const shop = typeof meta.shop_display_name === "string" ? meta.shop_display_name.trim() : "";
  if (shop) return shop;
  const org = typeof meta.organization_name === "string" ? meta.organization_name.trim() : "";
  if (org) return org;
  const business = typeof meta.business_name === "string" ? meta.business_name.trim() : "";
  return business || null;
}

function genericAuthSubject(action: string): string {
  switch (action) {
    case "invite":
      return "You've been invited to Waka POS";
    case "magiclink":
      return "Your Waka POS sign-in link";
    case "email_change":
    case "email":
      return "Confirm your new Waka POS email";
    case "reauthentication":
      return "Your Waka POS verification code";
    default:
      return "Waka POS account notification";
  }
}

function renderGenericAuthHtml(title: string, body: string, cta?: { label: string; href: string }): string {
  return wrapEmailLayout({ title, bodyHtml: body, cta });
}

export type DispatchAuthEmailResult = { ok: true } | { ok: false; error: string };

/** Map Supabase Auth hook payloads to branded Resend messages. */
export async function dispatchAuthHookEmail(
  supabaseUrl: string,
  user: AuthHookUser,
  emailData: AuthHookEmailData,
  emailService: EmailService,
): Promise<DispatchAuthEmailResult> {
  const action = emailData.email_action_type;
  const name = displayName(user);

  const sendOne = async (
    to: string,
    template: string,
    subject: string,
    html: string,
    text: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<DispatchAuthEmailResult> => {
    const result = await emailService.send({
      to,
      subject,
      html,
      text,
      template,
      recipientUserId: user.id,
      metadata,
      tags: [
        { name: "template", value: template },
        { name: "auth_action", value: action },
      ],
    });
    if (!result.ok && !result.skipped) {
      return { ok: false, error: result.error };
    }
    return { ok: true };
  };

  if (action === "signup") {
    const url = buildAuthConfirmationUrl(supabaseUrl, emailData);
    const to = user.email ?? "";
    const verify = await sendOne(
      to,
      "verify_email",
      verifyEmailSubject(),
      renderVerifyEmailHtml({ confirmationUrl: url, recipientName: name }),
      verifyEmailPlainText({ confirmationUrl: url, recipientName: name }),
      { email_action_type: action },
    );
    if (!verify.ok) return verify;

    if (sendWelcomeOnSignup()) {
      const welcome = await emailService.send({
        to,
        subject: welcomeEmailSubject(),
        html: renderWelcomeEmailHtml({ recipientName: name, shopName: shopName(user) }),
        text: welcomeEmailPlainText({ recipientName: name, shopName: shopName(user) }),
        template: "welcome",
        recipientUserId: user.id,
        metadata: { email_action_type: action, paired_with: "verify_email" },
        tags: [
          { name: "template", value: "welcome" },
          { name: "auth_action", value: action },
        ],
      });
      if (!welcome.ok && !welcome.skipped) {
        console.warn("[waka-email] welcome email failed after signup verify", welcome.error);
      }
    }
    return { ok: true };
  }

  if (action === "recovery") {
    const url = buildAuthConfirmationUrl(supabaseUrl, emailData);
    return sendOne(
      user.email ?? "",
      "password_reset",
      passwordResetSubject(),
      renderPasswordResetHtml({ confirmationUrl: url, recipientName: name }),
      passwordResetPlainText({ confirmationUrl: url, recipientName: name }),
      { email_action_type: action },
    );
  }

  if (action === "email_change") {
    const hasSecureChange = Boolean(emailData.token_hash_new?.trim() && emailData.token_new?.trim());
    if (hasSecureChange && user.email) {
      const currentUrl = buildAuthConfirmationUrl(supabaseUrl, {
        token_hash: emailData.token_hash_new,
        email_action_type: action,
        redirect_to: emailData.redirect_to,
      });
      const current = await sendOne(
        user.email,
        "email_change_current",
        "Confirm email change on your Waka POS account",
        renderGenericAuthHtml(
          "Confirm this email change",
          `<p style="margin:0 0 12px;">Use the button below to confirm an email change request on your Waka POS account.</p>`,
          { label: "Confirm change", href: currentUrl },
        ),
        undefined,
        { email_action_type: action, target: "current_email" },
      );
      if (!current.ok) return current;
    }
    const newAddress = user.new_email ?? user.email ?? "";
    const newUrl = buildAuthConfirmationUrl(supabaseUrl, emailData);
    return sendOne(
      newAddress,
      "email_change_new",
      genericAuthSubject(action),
      renderGenericAuthHtml(
        "Confirm your new email",
        `<p style="margin:0 0 12px;">Confirm <strong>${newAddress}</strong> as the email for your Waka POS account.</p>`,
        { label: "Confirm new email", href: newUrl },
      ),
      undefined,
      { email_action_type: action, target: "new_email" },
    );
  }

  if (action === "reauthentication") {
    return sendOne(
      user.email ?? "",
      "reauthentication",
      genericAuthSubject(action),
      renderGenericAuthHtml(
        "Your verification code",
        `<p style="margin:0 0 12px;">Enter this code to continue:</p>
         <p style="margin:0;font-size:28px;font-weight:800;letter-spacing:0.2em;color:#16a34a;">${emailData.token}</p>`,
      ),
      `Your Waka POS verification code: ${emailData.token}`,
      { email_action_type: action },
    );
  }

  if (["invite", "magiclink", "email"].includes(action)) {
    const url = buildAuthConfirmationUrl(supabaseUrl, emailData);
    const labels: Record<string, string> = {
      invite: "Accept invitation",
      magiclink: "Sign in",
      email: "Confirm email",
    };
    return sendOne(
      user.email ?? "",
      action,
      genericAuthSubject(action),
      renderGenericAuthHtml(
        genericAuthSubject(action),
        `<p style="margin:0;">Tap the button below to continue. This link expires shortly and can only be used once.</p>`,
        { label: labels[action] ?? "Continue", href: url },
      ),
      undefined,
      { email_action_type: action },
    );
  }

  if (action.endsWith("_notification")) {
    const subject = genericAuthSubject(action);
    return sendOne(
      user.email ?? "",
      action,
      subject,
      renderGenericAuthHtml(
        subject,
        `<p style="margin:0;">This is a security notification for your Waka POS account. If you did not make this change, contact support@waka.ug immediately.</p>`,
      ),
      undefined,
      { email_action_type: action },
    );
  }

  console.warn("[waka-email] unhandled auth email_action_type", action);
  return { ok: true };
}
