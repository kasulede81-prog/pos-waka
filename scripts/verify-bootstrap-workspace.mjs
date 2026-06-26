/**
 * Verify bootstrap_owner_workspace creates all owner workspace rows.
 * Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-bootstrap-workspace.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(root, ".env"));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error("Need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const stamp = Date.now();
const email = `waka.bootstrap.verify.${stamp}@mailinator.com`;
const password = `Test-${stamp}-Aa1!`;

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      business_name: "Bootstrap Verify Shop",
      organization_name: "Bootstrap Verify Org",
      shop_display_name: "Bootstrap Verify Shop",
      business_type: "kiosk_duka",
      full_name: "Bootstrap Verify Owner",
      pos_role: "owner",
    },
  });
  if (createErr) throw createErr;
  const userId = created.user.id;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw signInErr;

  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  await authed.auth.setSession({
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
  });

  const { data: bootRows, error: bootErr } = await authed.rpc("bootstrap_owner_workspace", {
    p_org_name: "Bootstrap Verify Org",
    p_business_type: "kiosk_duka",
    p_full_name: "Bootstrap Verify Owner",
    p_email: email,
    p_shop_display_name: "Bootstrap Verify Shop",
  });

  if (bootErr) {
    console.error("bootstrap_owner_workspace FAILED:", bootErr.message);
    process.exit(1);
  }

  console.log("bootstrap_owner_workspace OK:", bootRows);

  const checks = await Promise.all([
    admin.from("profiles").select("id, role, full_name").eq("id", userId).maybeSingle(),
    admin.from("organization_members").select("organization_id, role").eq("user_id", userId),
    admin.from("shop_members").select("shop_id, role").eq("user_id", userId),
    admin.from("organizations").select("id, name").eq("created_by", userId),
    admin.from("shops").select("id, name, organization_id").eq("owner_user_id", userId),
    admin.from("subscriptions").select("id, organization_id, shop_id, status").limit(5),
  ]);

  const [profile, orgMembers, shopMembers, orgs, shops, subs] = checks.map((r) => r.data);

  const orgId = orgMembers?.[0]?.organization_id ?? bootRows?.[0]?.organization_id;
  const shopId = shopMembers?.[0]?.shop_id ?? bootRows?.[0]?.shop_id;
  const subForOrg = subs?.filter((s) => s.organization_id === orgId) ?? [];

  const report = {
    userId,
    email,
    profile: profile ? { exists: true, role: profile.role, full_name: profile.full_name } : { exists: false },
    organization: orgs?.length ? { exists: true, id: orgs[0].id, name: orgs[0].name } : { exists: false },
    membership: orgMembers?.length
      ? { exists: true, role: orgMembers[0].role, organization_id: orgMembers[0].organization_id }
      : { exists: false },
    shop: shops?.length ? { exists: true, id: shops[0].id, name: shops[0].name } : { exists: false },
    shopMembership: shopMembers?.length
      ? { exists: true, role: shopMembers[0].role, shop_id: shopMembers[0].shop_id }
      : { exists: false },
    subscription: subForOrg.length
      ? { exists: true, status: subForOrg[0].status, id: subForOrg[0].id }
      : { exists: false },
    ownerRoleOk:
      profile?.role === "owner" &&
      orgMembers?.[0]?.role === "owner" &&
      shopMembers?.[0]?.role === "owner",
  };

  console.log(JSON.stringify(report, null, 2));

  const ok =
    report.profile.exists &&
    report.organization.exists &&
    report.membership.exists &&
    report.shop.exists &&
    report.shopMembership.exists &&
    report.ownerRoleOk;

  if (!ok) {
    console.error("Verification incomplete — not all workspace objects created");
    process.exit(1);
  }

  console.log("All workspace objects verified for user", userId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
