import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const gradle = readFileSync(resolve(root, "android/app/build.gradle"), "utf8");

const pkgVersion = String(pkg.version ?? "").trim();
const versionNameMatch = gradle.match(/versionName\s+"([^"]+)"/);
const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);

const gradleVersionName = versionNameMatch?.[1] ?? "";
const gradleVersionCode = versionCodeMatch?.[1] ?? "";

const errors = [];
if (pkgVersion !== gradleVersionName) {
  errors.push(`package.json version (${pkgVersion}) != Gradle versionName (${gradleVersionName})`);
}
if (!gradleVersionCode) {
  errors.push("Could not read Gradle versionCode");
}

if (errors.length > 0) {
  console.error("App version alignment check failed:\n" + errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}

console.log(`App versions aligned: ${pkgVersion} / versionCode ${gradleVersionCode}`);
