import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { dispatchAuthHookEmail } from "../_shared/email/authHookDispatch.ts";
import type { AuthHookEmailData, AuthHookUser } from "../_shared/email/authHookDispatch.ts";
import { EmailService } from "../_shared/email/EmailService.ts";

function hookSecretRaw(): string | null {
  const raw = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.trim();
  if (!raw) return null;
  return raw.replace(/^v1,whsec_/, "");
}

function jsonError(message: string, httpCode = 500): Response {
  return new Response(
    JSON.stringify({
      error: {
        http_code: httpCode,
        message,
      },
    }),
    {
      status: httpCode,
      headers: { "Content-Type": "application/json" },
    },
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hookSecret = hookSecretRaw();

  if (!supabaseUrl || !serviceKey) {
    return jsonError("server_misconfigured", 500);
  }
  if (!hookSecret) {
    return jsonError("send_email_hook_secret_missing", 500);
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let user: AuthHookUser;
  let email_data: AuthHookEmailData;

  try {
    const wh = new Webhook(hookSecret);
    const verified = wh.verify(payload, headers) as {
      user: AuthHookUser;
      email_data: AuthHookEmailData;
    };
    user = verified.user;
    email_data = verified.email_data;
  } catch (err) {
    const message = err instanceof Error ? err.message : "hook_verification_failed";
    console.error("[waka-email] hook verification failed", message);
    return jsonError(message, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const emailService = new EmailService(admin);

  const result = await dispatchAuthHookEmail(
    supabaseUrl,
    user,
    email_data,
    emailService,
  );

  if (!result.ok) {
    console.error("[waka-email] dispatch failed", result.error, email_data.email_action_type);
    return jsonError(result.error, 500);
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
