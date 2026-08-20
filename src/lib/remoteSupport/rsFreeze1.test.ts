import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { canRemoteSupport } from "../../components/internal-admin/v2/adminRoles";
import {
  DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS,
  isRemoteSupportPlatformEnabled,
  parseRemoteSupportPlatformSettings,
  remoteSupportErrorMessage,
} from "./index";

const require = createRequire(import.meta.url);
const { createSupportAgent } = require("../../../electron/remoteSupport/supportAgent.cjs") as {
  createSupportAgent: (deps?: Record<string, unknown>) => {
    startAuthorizedTransport: () => Promise<{ ok: boolean; error?: string; transportStatus?: string }>;
    _testAgentState: () => string;
  };
};
const { createProcessSupervisor } = require("../../../electron/remoteSupport/processSupervisor.cjs") as {
  createProcessSupervisor: (deps?: Record<string, unknown>) => {
    start: (exe: string, args: string[]) => { ok: boolean };
    isRunning: () => boolean;
  };
};
const { fetchRemoteSupportInboxFromControlPlane } = require(
  "../../../electron/remoteSupport/controlPlaneClient.cjs",
) as {
  fetchRemoteSupportInboxFromControlPlane: (input: Record<string, unknown>) => Promise<{
    request: unknown;
    session: unknown;
    enabled?: boolean;
  }>;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SQL = readFileSync(join(ROOT, "supabase/migrations/155_remote_support_master_switch.sql"), "utf8");
const labDir = "/tmp/waka-rs-freeze-lab";
const labExe = `${labDir}/rustdesk.exe`;
const deviceA = "device-aaaa-1111";

function labEnv() {
  return {
    WAKA_REMOTE_SUPPORT_TRANSPORT: "lab",
    WAKA_REMOTE_SUPPORT_LAB_DIR: labDir,
    WAKA_RUSTDESK_EXECUTABLE_PATH: labExe,
    WAKA_RUSTDESK_ID_SERVER: "127.0.0.1",
    WAKA_RUSTDESK_RELAY_SERVER: "127.0.0.1",
    WAKA_RUSTDESK_KEY: "nLemXVaIMI89rZpwPtUqDo0YlayHK8zJsEzOcaqZWCI=",
  };
}

function fakeFs() {
  const files = new Map<string, string>();
  return {
    existsSync: (value: string) => String(value) === labExe || files.has(String(value)),
    statSync: () => ({ isFile: () => true, isSymbolicLink: () => false }),
    mkdirSync: () => undefined,
    writeFileSync: (p: string, body: string) => {
      files.set(String(p), String(body));
    },
    chmodSync: () => undefined,
    lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }),
    realpathSync: (value: string) => String(value),
  };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
    exitCode: number | null;
    pid: number;
    killed?: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.pid = 99;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit("exit", 0);
  };
  return child;
}

describe("RS-FREEZE-1 default OFF", () => {
  it("parses missing and false payloads as disabled", () => {
    expect(DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS.enabled).toBe(false);
    expect(parseRemoteSupportPlatformSettings(null).enabled).toBe(false);
    expect(parseRemoteSupportPlatformSettings({}).enabled).toBe(false);
    expect(parseRemoteSupportPlatformSettings({ enabled: false }).enabled).toBe(false);
    expect(isRemoteSupportPlatformEnabled({ enabled: "true" })).toBe(false);
  });

  it("parses enabled: true only when explicitly true", () => {
    expect(parseRemoteSupportPlatformSettings({ enabled: true }).enabled).toBe(true);
    expect(isRemoteSupportPlatformEnabled({ enabled: true })).toBe(true);
  });

  it("SQL default insert is enabled false", () => {
    expect(SQL).toContain("jsonb_build_object('enabled', false)");
    expect(SQL).toContain("remote_support_disabled");
    expect(SQL).toContain("if not public.remote_support_is_enabled ()");
  });
});

describe("RS-FREEZE-1 admin permission", () => {
  it("super_admin and support_admin can change the switch", () => {
    expect(canRemoteSupport("super_admin")).toBe(true);
    expect(canRemoteSupport("support_admin")).toBe(true);
  });

  it("normal roles cannot change the switch", () => {
    expect(canRemoteSupport("operations_admin")).toBe(false);
    expect(canRemoteSupport("finance_admin")).toBe(false);
    expect(canRemoteSupport("field_agent")).toBe(false);
    expect(canRemoteSupport("owner")).toBe(false);
    expect(canRemoteSupport("cashier")).toBe(false);
  });

  it("admin update RPC requires waka_can_remote_support", () => {
    expect(SQL).toContain("admin_update_remote_support_platform_settings");
    expect(SQL).toMatch(/if not public\.waka_can_remote_support \(\)/);
  });
});

describe("RS-FREEZE-1 disabled blocks request and transport", () => {
  it("request_start is gated in SQL", () => {
    expect(SQL).toContain("remote_support_request_start");
    expect(SQL).toContain("'remote_support_disabled'");
    expect(remoteSupportErrorMessage({ ok: false, error: "remote_support_disabled" })).toMatch(/turned off/i);
  });

  it("Electron transport does not spawn when the switch is off", async () => {
    const launches: string[][] = [];
    const supervisor = createProcessSupervisor({
      spawn: (exe: string, args: string[]) => {
        launches.push([exe, ...args]);
        return fakeChild();
      },
    });
    const agent = createSupportAgent({
      loadSnapshot: async () => ({
        deviceFingerprint: deviceA,
        remoteSupportEnabled: false,
        inbox: { request: null, session: { status: "connecting" } },
      }),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor,
      watchdogMs: 0,
    });
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(false);
    expect(started.error).toBe("remote_support_disabled");
    expect(launches).toHaveLength(0);
    expect(agent._testAgentState()).toBe("not_running");
  });

  it("native control plane skips inbox when the switch RPC is off", async () => {
    const urls: string[] = [];
    const inbox = await fetchRemoteSupportInboxFromControlPlane({
      supabaseUrl: "https://wdirxwvbgsfzbdurmkbf.supabase.co",
      accessToken: "aaa.bbb.ccc",
      deviceFingerprint: deviceA,
      fetch: async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("get_remote_support_platform_settings")) {
          return { ok: true, json: async () => ({ enabled: false }) };
        }
        return { ok: true, json: async () => ({ request: null, session: { status: "connecting" } }) };
      },
    });
    expect(inbox.enabled).toBe(false);
    expect(inbox.session).toBeNull();
    expect(urls.some((u) => u.includes("remote_support_customer_inbox"))).toBe(false);
  });
});

describe("RS-FREEZE-1 enabled preserves existing flow", () => {
  it("authorized connecting session still starts lab transport when enabled", async () => {
    const launches: string[][] = [];
    const supervisor = createProcessSupervisor({
      spawn: (exe: string, args: string[]) => {
        launches.push([exe, ...args]);
        return fakeChild();
      },
    });
    const agent = createSupportAgent({
      loadSnapshot: async () => ({
        deviceFingerprint: deviceA,
        remoteSupportEnabled: true,
        inbox: { request: null, session: { status: "connecting" } },
      }),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor,
      watchdogMs: 0,
    });
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(true);
    expect(launches).toHaveLength(1);
    expect(launches[0][0]).toBe(labExe);
  });

  it("does not replace Need Help or remote_support tables", () => {
    expect(SQL).not.toContain("create table");
    expect(SQL).toContain("platform_settings");
    const needHelp = readFileSync(join(ROOT, "src/lib/posSupportRequest.ts"), "utf8");
    expect(needHelp).toContain("Creates a support_requests row only");
  });
});
