import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RS_DIR = join(ROOT, "electron/remoteSupport");
const SUPERVISOR = join(RS_DIR, "processSupervisor.cjs");

function listFiles(dir: string): string[] {
  return readdirSync(dir).map((name) => join(dir, name));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("RS-4B native safety", () => {
  const files = [
    ...listFiles(RS_DIR),
    join(ROOT, "electron/main.cjs"),
    join(ROOT, "electron/preload.cjs"),
  ];
  const nonSupervisor = files.filter((path) => path !== SUPERVISOR);
  const blob = nonSupervisor.map((path) => read(path)).join("\n");

  it("keeps process spawning inside the lab supervisor only", () => {
    const forbidden = [
      "child_process",
      "child_process.spawn",
      "execFile(",
      ".fork(",
      "net.createServer",
      "http.createServer",
      "dgram.createSocket",
      "WebSocketServer",
      "desktopCapturer",
      "SendInput",
      "mouse_event",
      "keybd_event",
    ];
    for (const token of forbidden) {
      expect(blob.toLowerCase().includes(token.toLowerCase()), `found ${token}`).toBe(false);
    }
    const supervisor = read(SUPERVISOR);
    expect(supervisor).toContain("node:child_process");
    expect(supervisor).toContain("shell: false");
    expect(supervisor).not.toContain("shell: true");
    expect(supervisor).not.toContain("exec(");
    expect(supervisor).not.toContain("execFile");
    expect(supervisor).not.toContain(".fork(");
  });

  it("keeps the Electron security flags", () => {
    const main = read(join(ROOT, "electron/main.cjs"));
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
  });

  it("does not expose spawn, exec, or transport credentials to the renderer", () => {
    const preload = read(join(ROOT, "electron/preload.cjs"));
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);
    expect(preload).not.toContain("ipcRenderer.send");
    expect(preload).not.toContain("ipcRenderer.on");
    expect(preload).not.toContain("controlPlaneStatus");
    expect(preload).not.toContain("grant_jti");
    expect(preload).not.toContain("access_token");
    expect(preload).not.toContain("refresh_token");
    expect(preload).not.toContain("service_role");
    expect(preload).not.toMatch(/rustdesk/i);
    expect(preload).not.toMatch(/hbbs|hbbr/i);
    expect(preload).not.toMatch(/spawn|execFile|exec\(|runCommand|shell/i);
    expect(preload).toContain("startAuthorizedTransport");
    expect(preload).toContain("stopTransport");
  });

  it("does not introduce service-role credentials", () => {
    const rs = listFiles(RS_DIR)
      .filter((path) => !path.endsWith("log.cjs"))
      .map((path) => read(path))
      .join("\n");
    expect(rs).not.toContain("SERVICE_ROLE");
    expect(rs).not.toContain("service_role");
  });

  it("does not add a generic execute IPC channel", () => {
    const channels = read(join(RS_DIR, "channels.cjs"));
    expect(channels).not.toMatch(/spawn|exec|runCommand|shell/i);
  });
});
