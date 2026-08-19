import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HW = join(ROOT, "electron/hardware");

const {
  validatePrinterHost,
  validatePrinterPort,
  validateEscPosPayload,
  validatePrinterArgs,
  MAX_PAYLOAD_BYTES,
  DEFAULT_PORT,
} = require(join(HW, "lanHostValidation.cjs")) as {
  validatePrinterHost: (host: unknown) => { ok: boolean; code?: string; host?: string };
  validatePrinterPort: (port: unknown) => { ok: boolean; code?: string; port?: number };
  validateEscPosPayload: (data: unknown) => { ok: boolean; code?: string };
  validatePrinterArgs: (
    raw: unknown,
    opts: { requireData: boolean },
  ) => { ok: boolean; code?: string; host?: string; port?: number };
  MAX_PAYLOAD_BYTES: number;
  DEFAULT_PORT: number;
};

const {
  printEscPos,
  testConnection,
  getStatus,
} = require(join(HW, "escPosNetwork.cjs")) as {
  printEscPos: (args: unknown, deps?: unknown) => Promise<{ ok: boolean; code?: string }>;
  testConnection: (args: unknown, deps?: unknown) => Promise<{ ok: boolean; code?: string; message?: string }>;
  getStatus: (args: unknown, deps?: unknown) => Promise<{ ok: boolean; status?: string }>;
};

const { PRINTER_CHANNELS } = require(join(HW, "channels.cjs")) as {
  PRINTER_CHANNELS: Record<string, string>;
};

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("LAN host / port / payload validation", () => {
  it("accepts private LAN IPv4 hosts", () => {
    expect(validatePrinterHost("192.168.1.50")).toEqual({ ok: true, host: "192.168.1.50" });
    expect(validatePrinterHost("10.0.0.8").ok).toBe(true);
    expect(validatePrinterHost("172.16.4.2").ok).toBe(true);
    expect(validatePrinterHost("169.254.10.2").ok).toBe(true);
  });

  it("rejects localhost", () => {
    expect(validatePrinterHost("localhost").code).toBe("localhost_rejected");
  });

  it("rejects loopback", () => {
    expect(validatePrinterHost("127.0.0.1").code).toBe("localhost_rejected");
    expect(validatePrinterHost("127.0.0.2").code).toBe("localhost_rejected");
  });

  it("rejects public internet destinations", () => {
    expect(validatePrinterHost("8.8.8.8").code).toBe("public_host_rejected");
    expect(validatePrinterHost("1.1.1.1").code).toBe("public_host_rejected");
  });

  it("rejects malformed hosts and URLs", () => {
    expect(validatePrinterHost("").ok).toBe(false);
    expect(validatePrinterHost("not an ip").ok).toBe(false);
    expect(validatePrinterHost("http://192.168.1.50").ok).toBe(false);
    expect(validatePrinterHost("192.168.1.50:9100").ok).toBe(false);
    expect(validatePrinterHost("printer.local").ok).toBe(false);
  });

  it("validates ports", () => {
    expect(validatePrinterPort(9100)).toEqual({ ok: true, port: 9100 });
    expect(validatePrinterPort(1).ok).toBe(true);
    expect(validatePrinterPort(65535).ok).toBe(true);
    expect(validatePrinterPort(0).code).toBe("invalid_port");
    expect(validatePrinterPort(65536).code).toBe("invalid_port");
    expect(validatePrinterPort("abc").code).toBe("invalid_port");
  });

  it("rejects oversized and malformed payloads", () => {
    expect(validateEscPosPayload([0x1b, 0x40]).ok).toBe(true);
    expect(validateEscPosPayload([]).code).toBe("malformed_payload");
    expect(validateEscPosPayload("hi").code).toBe("malformed_payload");
    expect(validateEscPosPayload([1.5]).code).toBe("malformed_payload");
    expect(validateEscPosPayload([-1]).code).toBe("malformed_payload");
    expect(validateEscPosPayload([256]).code).toBe("malformed_payload");
    expect(validateEscPosPayload(Array(MAX_PAYLOAD_BYTES + 1).fill(0)).code).toBe("payload_too_large");
  });

  it("rejects non-allowlisted IPC argument keys", () => {
    expect(
      validatePrinterArgs(
        { host: "192.168.1.50", port: 9100, data: [1], command: "rm" },
        { requireData: true },
      ).code,
    ).toBe("invalid_args");
    expect(
      validatePrinterArgs({ host: "192.168.1.50", port: 9100, data: [1, 2] }, { requireData: true }),
    ).toMatchObject({ ok: true, host: "192.168.1.50", port: 9100 });
    expect(validatePrinterArgs({ host: "192.168.1.50" }, { requireData: false })).toMatchObject({
      ok: true,
      port: DEFAULT_PORT,
    });
  });
});

describe("ESC/POS TCP transport (mocked)", () => {
  function mockNet(
    behavior: "connect-ok" | "connect-fail" | "connect-hang" | "write-fail",
    track?: { destroy: number; end: number },
  ) {
    return {
      connect: (_opts: { host: string; port: number }, cb: () => void) => {
        const socket = new EventEmitter() as EventEmitter & {
          write: (data: Buffer, cb?: (err?: Error | null) => void) => void;
          end: (cb?: () => void) => void;
          destroy: () => void;
          removeAllListeners: () => EventEmitter;
        };
        socket.write = (_data, cb) => {
          if (behavior === "write-fail") cb?.(new Error("write failed"));
          else cb?.(null);
        };
        socket.end = (cb) => {
          if (track) track.end += 1;
          cb?.();
        };
        socket.destroy = () => {
          if (track) track.destroy += 1;
        };
        socket.removeAllListeners = () => {
          EventEmitter.prototype.removeAllListeners.call(socket);
          return socket;
        };

        if (behavior === "connect-fail") {
          queueMicrotask(() => socket.emit("error", new Error("ECONNREFUSED")));
          return socket;
        }
        if (behavior === "connect-hang") {
          return socket;
        }
        queueMicrotask(() => cb());
        return socket;
      },
    };
  }

  it("succeeds on mocked connection probe", async () => {
    const result = await testConnection(
      { host: "192.168.1.50", port: 9100 },
      { netModule: mockNet("connect-ok") },
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Printer connected");
  });

  it("prints on mocked successful write", async () => {
    const result = await printEscPos(
      { host: "10.0.0.5", port: 9100, data: [0x1b, 0x40, 0x0a] },
      { netModule: mockNet("connect-ok") },
    );
    expect(result.ok).toBe(true);
  });

  it("closes the socket after a successful print", async () => {
    const track = { destroy: 0, end: 0 };
    const result = await printEscPos(
      { host: "192.168.1.77", port: 9100, data: [0x1b, 0x40] },
      { netModule: mockNet("connect-ok", track) },
    );
    expect(result.ok).toBe(true);
    expect(track.end).toBeGreaterThanOrEqual(1);
    expect(track.destroy).toBeGreaterThanOrEqual(1);
  });

  it("destroys the socket after connect timeout", async () => {
    const track = { destroy: 0, end: 0 };
    const result = await testConnection(
      { host: "192.168.0.11", port: 9100 },
      { netModule: mockNet("connect-hang", track), connectTimeoutMs: 30 },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("connect_timeout");
    expect(track.destroy).toBeGreaterThanOrEqual(1);
  });

  it("maps connection failure to safe user error", async () => {
    const result = await testConnection(
      { host: "192.168.0.10", port: 9100 },
      { netModule: mockNet("connect-fail") },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("connection_failed");
  });

  it("times out hung connects", async () => {
    const result = await testConnection(
      { host: "192.168.0.11", port: 9100 },
      { netModule: mockNet("connect-hang"), connectTimeoutMs: 30 },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("connect_timeout");
  });

  it("rejects public hosts before opening a socket", async () => {
    const connect = vi.fn();
    const result = await printEscPos(
      { host: "8.8.8.8", port: 9100, data: [1] },
      { netModule: { connect } },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("public_host_rejected");
    expect(connect).not.toHaveBeenCalled();
  });

  it("getStatus reports reachable after probe success", async () => {
    const result = await getStatus(
      { host: "192.168.1.20", port: 9100 },
      { netModule: mockNet("connect-ok") },
    );
    expect(result).toMatchObject({ ok: true, status: "reachable" });
  });
});

describe("printer IPC surface safety", () => {
  it("uses dedicated named channels only", () => {
    expect(PRINTER_CHANNELS.PRINT_ESCPOS).toBe("waka:hardware:printer:print-escpos");
    expect(PRINTER_CHANNELS.TEST_CONNECTION).toBe("waka:hardware:printer:test-connection");
    expect(PRINTER_CHANNELS.GET_STATUS).toBe("waka:hardware:printer:get-status");
  });

  it("does not expose a generic network API on preload", () => {
    const preload = read(join(ROOT, "electron/preload.cjs"));
    expect(preload).toContain("hardware");
    expect(preload).toContain("printEscPos");
    expect(preload).toContain("testConnection");
    expect(preload).not.toContain("createConnection");
    expect(preload).not.toContain("node:net");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);
    expect(preload).not.toMatch(/spawn|execFile|exec\(|runCommand|openExternal/i);
  });

  it("keeps TCP sockets inside the hardware service", () => {
    const files = readdirSync(HW).map((name) => join(HW, name));
    const blob = files.map((path) => read(path)).join("\n");
    expect(blob).toContain("node:net");
    expect(blob).not.toContain("child_process");
    expect(blob).not.toContain("shell: true");
    const main = read(join(ROOT, "electron/main.cjs"));
    expect(main).toContain("registerPrinterIpc");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
  });

  it("keeps printer and Remote Support modules isolated", () => {
    const hwBlob = readdirSync(HW)
      .map((name) => read(join(HW, name)))
      .join("\n");
    expect(hwBlob).not.toMatch(/remoteSupport|rustdesk|WAKA_REMOTE_SUPPORT/i);
    const rsDir = join(ROOT, "electron/remoteSupport");
    const rsBlob = readdirSync(rsDir)
      .map((name) => read(join(rsDir, name)))
      .join("\n");
    expect(rsBlob).not.toMatch(/hardware\/|printEscPos|escPosNetwork|printerIpc/i);
  });
});
