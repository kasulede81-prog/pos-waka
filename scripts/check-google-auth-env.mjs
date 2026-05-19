#!/usr/bin/env node
/**
 * Quick check before deploy: VITE_GOOGLE_OAUTH_CLIENT_ID must be set for production builds.
 * Usage: node scripts/check-google-auth-env.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = [".env.production.local", ".env.production", ".env"];

let clientId = process.env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim();

if (!clientId) {
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const match = text.match(/^VITE_GOOGLE_OAUTH_CLIENT_ID=(.+)$/m);
    if (match?.[1]?.trim() && !match[1].includes("your_") && !match[1].includes("PASTE")) {
      clientId = match[1].trim();
      console.log(`Found VITE_GOOGLE_OAUTH_CLIENT_ID in ${file}`);
      break;
    }
  }
}

if (!clientId) {
  console.error(`
[waka] Missing VITE_GOOGLE_OAUTH_CLIENT_ID

1. Open Supabase → Authentication → Providers → Google
2. Copy the "Client ID" (ends with .apps.googleusercontent.com)
3. Add to Vercel → Project → Settings → Environment Variables → Production:
     VITE_GOOGLE_OAUTH_CLIENT_ID = <paste Client ID>
   Also set: VITE_APP_URL = https://waka-ug.com
4. Redeploy (Deployments → Redeploy)

Local: paste the same Client ID into .env as VITE_GOOGLE_OAUTH_CLIENT_ID=
`);
  process.exit(1);
}

console.log(`[waka] OK — Google Client ID configured (${clientId.slice(0, 20)}…)`);
