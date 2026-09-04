import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { normalizeAuthDeepLinkToAppPath } from "./nativeAuthDeepLink";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const {
  extractPrintProtocolFromArgv,
  isValidSaleId,
  parsePrintProtocolUrl,
} = require(join(ROOT, "electron/printHandoff/parsePrintProtocol.cjs")) as {
  extractPrintProtocolFromArgv: (argv: unknown) => { type: "print"; version: 1; saleId: string } | null;
  isValidSaleId: (saleId: unknown) => boolean;
  parsePrintProtocolUrl: (raw: unknown) => { type: "print"; version: 1; saleId: string } | null;
};

const SALE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const VALID = `wakapos://print/v1?saleId=${SALE_ID}`;

describe("desktop print protocol parser", () => {
  it("accepts wakapos://print/v1?saleId=…", () => {
    expect(parsePrintProtocolUrl(VALID)).toEqual({ type: "print", version: 1, saleId: SALE_ID });
    expect(parsePrintProtocolUrl(`"${VALID}"`)).toEqual({ type: "print", version: 1, saleId: SALE_ID });
    expect(isValidSaleId(SALE_ID)).toBe(true);
  });

  it("rejects malformed, unknown, and oversized payloads", () => {
    expect(parsePrintProtocolUrl("")).toBeNull();
    expect(parsePrintProtocolUrl("not-a-url")).toBeNull();
    expect(parsePrintProtocolUrl("https://pos.waka.ug/print/v1?saleId=" + SALE_ID)).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://print/v2?saleId=" + SALE_ID)).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://other/v1?saleId=" + SALE_ID)).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://print/v1")).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://print/v1?saleId=")).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://print/v1?saleId=bad id")).toBeNull();
    expect(parsePrintProtocolUrl(`wakapos://print/v1?saleId=${"x".repeat(81)}`)).toBeNull();
  });

  it("rejects printer fields, extra query keys, and raw bytes", () => {
    expect(parsePrintProtocolUrl(`wakapos://print/v1?saleId=${SALE_ID}&host=192.168.1.50`)).toBeNull();
    expect(parsePrintProtocolUrl(`wakapos://print/v1?saleId=${SALE_ID}&port=9100`)).toBeNull();
    expect(parsePrintProtocolUrl(`wakapos://print/v1?saleId=${SALE_ID}&mac=AA:BB`)).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://print/v1?data=1b40")).toBeNull();
  });

  it("ignores auth URLs in the print parser", () => {
    expect(parsePrintProtocolUrl("wakapos://callback?code=abc")).toBeNull();
    expect(parsePrintProtocolUrl("wakapos://auth/callback?code=abc")).toBeNull();
  });

  it("extracts a print request from first-launch and second-instance argv", () => {
    expect(
      extractPrintProtocolFromArgv(["C:\\Program Files\\WAKA POS\\WAKA POS.exe", VALID]),
    ).toEqual({ type: "print", version: 1, saleId: SALE_ID });
    expect(extractPrintProtocolFromArgv(["electron.exe", ".", "--some-flag"])).toBeNull();
    expect(extractPrintProtocolFromArgv(["wakapos://callback?code=abc"])).toBeNull();
    expect(extractPrintProtocolFromArgv(null)).toBeNull();
  });

  it("does not send print URLs through the auth mapper", () => {
    expect(normalizeAuthDeepLinkToAppPath(VALID)).toBeNull();
    expect(normalizeAuthDeepLinkToAppPath("wakapos://callback?code=abc")).toBe("/auth/callback?code=abc");
  });
});

describe("desktop print protocol surface safety", () => {
  it("registers wakapos on Windows only and does not expose ipcRenderer", () => {
    const main = readFileSync(join(ROOT, "electron/main.cjs"), "utf8");
    const preload = readFileSync(join(ROOT, "electron/preload.cjs"), "utf8");
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      build: { appId: string; protocols?: { schemes?: string[] }[] };
    };

    expect(main).toContain('setAsDefaultProtocolClient(PRINT_PROTOCOL_SCHEME)');
    expect(main).toContain('process.platform === "win32"');
    expect(main).toContain("extractPrintProtocolFromArgv");
    expect(main).toContain("second-instance");
    expect(main).toContain("queuePrintHandoff");
    expect(main).not.toContain("loadURL(launchRequest");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");

    expect(preload).toContain("onPrintHandoff");
    expect(preload).not.toContain("ipcRenderer.on");
    expect(preload).not.toContain("ipcRenderer.send");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);

    expect(pkg.build.appId).toBe("ug.waka.pos.desktop");
    expect(pkg.build.protocols?.some((p) => p.schemes?.includes("wakapos"))).toBe(true);
  });
});
