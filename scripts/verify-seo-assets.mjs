import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const required = ["sitemap.xml", "robots.txt"];

for (const file of required) {
  const path = resolve(dist, file);
  try {
    await access(path, constants.R_OK);
  } catch {
    console.error(`[seo] Missing required production asset: dist/${file}`);
    process.exit(1);
  }
}

console.log("[seo] dist/sitemap.xml and dist/robots.txt present");
