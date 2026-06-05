#!/usr/bin/env node
/**
 * Point waka.ug apex DNS to Vercel (fixes 404 on /sitemap.xml and /robots.txt).
 *
 * Prerequisites:
 *   - Cloudflare API token with Zone.DNS Edit for waka.ug
 *   - Set env: CLOUDFLARE_API_TOKEN
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=xxx node scripts/configure-waka-ug-cloudflare-dns.mjs
 */
const ZONE_NAME = "waka.ug";
const VERCEL_APEX_IP = "76.76.21.21";

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!token) {
  console.error("Set CLOUDFLARE_API_TOKEN with Zone.DNS Edit permission for waka.ug");
  process.exit(1);
}

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(JSON.stringify(json.errors ?? json, null, 2));
  }
  return json.result;
}

const zone = (await cf(`/zones?name=${ZONE_NAME}`))[0];
if (!zone) throw new Error(`Cloudflare zone not found: ${ZONE_NAME}`);

const records = await cf(`/zones/${zone.id}/dns_records?type=A&name=${ZONE_NAME}`);
const existing = records.find((r) => r.name === ZONE_NAME || r.name === `${ZONE_NAME}.`);

const payload = {
  type: "A",
  name: "@",
  content: VERCEL_APEX_IP,
  ttl: 1,
  proxied: false,
};

if (existing) {
  await cf(`/zones/${zone.id}/dns_records/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  console.log(`Updated A record @ → ${VERCEL_APEX_IP} (proxied: false)`);
} else {
  await cf(`/zones/${zone.id}/dns_records`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  console.log(`Created A record @ → ${VERCEL_APEX_IP} (proxied: false)`);
}

console.log("DNS updated. Propagation usually takes 1–5 minutes on Cloudflare.");
console.log("Verify: curl -I https://waka.ug/sitemap.xml");
