import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { EmailService } from "../_shared/email/EmailService.ts";
import { renderStaffInviteEmail, staffInviteAcceptUrl } from "../_shared/email/staffInviteEmail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

type InviteRpc = {
  ok?: boolean;
  error?: string;
  invitation_id?: string;
  shop_id?: string;
  email?: string;
  membership_role?: string;
  pos_role?: string;
  token?: string;
  expires_at?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: {
    shop_id?: string;
    email?: string;
    membership_role?: string;
    pos_role?: string;
    staff_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const { data, error } = await userClient.rpc("shop_invite_staff", {
    p_shop_id: body.shop_id,
    p_email: body.email,
    p_membership_role: body.membership_role,
    p_pos_role: body.pos_role,
    p_staff_id: body.staff_id || null,
  });

  const result = (data ?? {}) as InviteRpc;
  if (error || result.ok !== true || !result.token || !result.email) {
    const code = String(result.error ?? error?.message ?? "invite_failed");
    const status = code === "forbidden" ? 403 : 400;
    return json({ ok: false, error: code }, status);
  }

  const token = result.token;
  const acceptUrl = staffInviteAcceptUrl(token);
  let shopName: string | null = null;
  if (serviceKey && result.shop_id) {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: shop } = await admin.from("shops").select("name").eq("id", result.shop_id).maybeSingle();
    shopName = typeof shop?.name === "string" ? shop.name : null;
  }

  const mail = renderStaffInviteEmail({
    shopName,
    roleLabel: result.pos_role ?? result.membership_role ?? "staff",
    acceptUrl,
  });

  const admin = serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  const emailService = new EmailService(admin);
  const sent = await emailService.send({
    to: result.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    template: "staff_invite",
    metadata: {
      invitation_id: result.invitation_id,
      shop_id: result.shop_id,
      membership_role: result.membership_role,
      pos_role: result.pos_role,
    },
  });

  if (!sent.ok) {
    return json({
      ok: false,
      error: sent.error,
      invitation_id: result.invitation_id,
      email_sent: false,
    }, 502);
  }

  return json({
    ok: true,
    invitation_id: result.invitation_id,
    email: result.email,
    expires_at: result.expires_at,
    email_sent: true,
  });
});
