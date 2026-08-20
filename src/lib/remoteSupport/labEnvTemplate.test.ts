import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("RS-4D lab env template (Slice A)", () => {
  const example = readFileSync(join(ROOT, "scripts/lab/remote-support-lab.env.example"), "utf8");
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");

  it("documents the Electron process vars without secrets", () => {
    expect(example).toContain("WAKA_REMOTE_SUPPORT_TRANSPORT=lab");
    expect(example).toContain("WAKA_REMOTE_SUPPORT_LAB_DIR=");
    expect(example).toContain("WAKA_RUSTDESK_ID_SERVER=");
    expect(example).toContain("WAKA_RUSTDESK_RELAY_SERVER=");
    expect(example).toContain("WAKA_RUSTDESK_KEY=");
    expect(example).toContain("REPLACE_WITH_ISOLATED_HBBS_HOST");
    expect(example).toContain("REPLACE_WITH_ISOLATED_SERVER_PUBLIC_KEY");
    expect(example).not.toMatch(/^VITE_/m);
    expect(example).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  });

  it("keeps filled lab env gitignored and out of Vite", () => {
    expect(gitignore).toContain("scripts/lab/remote-support-lab.env");
    expect(example.toLowerCase()).toContain("vite");
  });
});
