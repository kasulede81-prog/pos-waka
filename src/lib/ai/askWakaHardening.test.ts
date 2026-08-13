import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseAi } from "./canUseAi";
import { DEFAULT_PLATFORM_AI_SETTINGS_V2 } from "./platformAiSettings.v2";
import { assertOllamaBaseUrl } from "./ollamaProtocol";

function functionJwtFlag(toml: string, fn: string): boolean | null {
  const re = new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt\\s*=\\s*(true|false)`);
  const m = toml.match(re);
  if (!m) return null;
  return m[1] === "true";
}

describe("ASK-6.1 JWT pin", () => {
  it("pins ai-ask-waka verify_jwt = true and never false", () => {
    const toml = readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");
    expect(functionJwtFlag(toml, "ai-ask-waka")).toBe(true);
    expect(toml).toMatch(/\[functions\.ai-ask-waka\]\s*\nverify_jwt\s*=\s*true/);
    expect(toml).not.toMatch(/\[functions\.ai-ask-waka\]\s*\nverify_jwt\s*=\s*false/);
  });

  it("does not document --no-verify-jwt for ai-ask-waka in package.json", () => {
    const pkg = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
    const askDeploy = pkg.match(/functions deploy ai-ask-waka[^"]*/);
    expect(askDeploy?.[0] ?? "").not.toContain("--no-verify-jwt");
  });
});

describe("ASK-6.1 platform Ask WAKA remains off by default", () => {
  it("blocks Ask WAKA when platform ask_waka is false", () => {
    expect(DEFAULT_PLATFORM_AI_SETTINGS_V2.ask_waka).toBe(false);
    expect(DEFAULT_PLATFORM_AI_SETTINGS_V2.pilot_rollout_mode).toBe(false);
    expect(DEFAULT_PLATFORM_AI_SETTINGS_V2.pilot_auto_enable_new_shops).toBe(false);

    const platformOff = canUseAi("ask_waka", { settings: DEFAULT_PLATFORM_AI_SETTINGS_V2 });
    expect(platformOff.allowed).toBe(false);
    if (!platformOff.allowed) expect(platformOff.code).toBe("ai_platform_disabled");

    const featureOff = canUseAi("ask_waka", {
      settings: { ...DEFAULT_PLATFORM_AI_SETTINGS_V2, enabled: true, ask_waka: false },
    });
    expect(featureOff.allowed).toBe(false);
    if (!featureOff.allowed) expect(featureOff.code).toBe("feature_disabled");
  });
});

describe("ASK-6.1 Ollama localhost isolation", () => {
  it("rejects localhost unless explicitly allowed", () => {
    expect(() => assertOllamaBaseUrl("http://127.0.0.1:11434", false)).toThrow(
      /ollama_localhost_not_reachable_from_edge/,
    );
    expect(() => assertOllamaBaseUrl("http://localhost:11434", false)).toThrow(
      /ollama_localhost_not_reachable_from_edge/,
    );
    expect(assertOllamaBaseUrl("http://127.0.0.1:11434", true)).toBe("http://127.0.0.1:11434");
    expect(assertOllamaBaseUrl("https://ollama.example.com", false)).toBe("https://ollama.example.com");
  });
});
