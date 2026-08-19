import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const {
  classifyNavigation,
  isAllowedAppNavigation,
  isDangerousScheme,
  isHttpOrHttps,
} = require(join(ROOT, "electron/shell/navigationSecurity.cjs")) as {
  classifyNavigation: (
    url: string,
    allowed: string | string[],
  ) => { action: "allow" | "deny" | "open-external" };
  isAllowedAppNavigation: (url: string, allowed: string | string[]) => boolean;
  isDangerousScheme: (url: string) => boolean;
  isHttpOrHttps: (url: string) => boolean;
};
const { sanitizeShellError } = require(join(ROOT, "electron/shell/errors.cjs")) as {
  sanitizeShellError: (input: unknown, fallback?: string) => string;
};

describe("desktop shell navigation security", () => {
  const indexPath = join(ROOT, "dist", "index.html");
  const recoveryPath = join(ROOT, "electron", "shell", "recovery.html");
  const allowed = [indexPath, recoveryPath];

  it("allows only packaged app html file URLs", () => {
    const { pathToFileURL } = require("node:url") as typeof import("node:url");
    const indexUrl = pathToFileURL(indexPath).href + "#/pos";
    const recoveryUrl = pathToFileURL(recoveryPath).href;
    expect(isAllowedAppNavigation(indexUrl, allowed)).toBe(true);
    expect(isAllowedAppNavigation(recoveryUrl, allowed)).toBe(true);
    expect(isAllowedAppNavigation(pathToFileURL(join(ROOT, "other.html")).href, allowed)).toBe(
      false,
    );
  });

  it("classifies http(s) as external and dangerous schemes as deny", () => {
    expect(isHttpOrHttps("https://example.com/help")).toBe(true);
    expect(isDangerousScheme("javascript:alert(1)")).toBe(true);
    expect(isDangerousScheme("data:text/html,hi")).toBe(true);
    expect(classifyNavigation("https://waka.example/docs", allowed)).toEqual({
      action: "open-external",
    });
    expect(classifyNavigation("javascript:void(0)", allowed)).toEqual({ action: "deny" });
    expect(classifyNavigation("file:///etc/passwd", allowed)).toEqual({ action: "deny" });
  });
});

describe("desktop shell error sanitization", () => {
  it("strips paths and sensitive tokens", () => {
    expect(sanitizeShellError("Failed at /Users/admin/app/file.txt")).toBe("Failed at [path]");
    expect(sanitizeShellError("grant_jti=abc access_token=xyz")).toBe("Desktop action failed");
    expect(sanitizeShellError("Print failed")).toBe("Print failed");
  });
});
