import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveLabExecutable } = require("../../../electron/remoteSupport/processAllowlist.cjs") as {
  resolveLabExecutable: (input?: Record<string, unknown>) => { ok: boolean; path?: string; error?: string };
};
const { pinIsolatedServer, normalizeLabHost, buildLabLaunchPlan } = require(
  "../../../electron/remoteSupport/labConfig.cjs",
) as {
  pinIsolatedServer: (env?: Record<string, string>) => { ok: boolean; error?: string };
  normalizeLabHost: (value: string) => { ok: boolean; host?: string; error?: string };
  buildLabLaunchPlan: (input?: Record<string, unknown>) => {
    ok: boolean;
    args?: string[];
    configPath?: string | null;
    childEnv?: Record<string, string>;
    error?: string;
  };
};
const { createSupportAgent } = require("../../../electron/remoteSupport/supportAgent.cjs") as {
  createSupportAgent: (deps?: Record<string, unknown>) => {
    startAuthorizedTransport: () => Promise<{ ok: boolean; status?: string; error?: string }>;
    stopTransport: () => Promise<{ ok: boolean; status: string }>;
    _testAgentState: () => string;
  };
};
const { createProcessSupervisor } = require("../../../electron/remoteSupport/processSupervisor.cjs") as {
  createProcessSupervisor: (deps?: Record<string, unknown>) => {
    start: (exe: string, args: string[], opts?: Record<string, unknown>) => { ok: boolean };
    stop: () => Promise<{ ok: boolean }>;
    isRunning: () => boolean;
  };
};
const { trackRemoteSupportAgent, stopAllRemoteSupportTransports } = require(
  "../../../electron/remoteSupport/ipcHandlers.cjs",
) as {
  trackRemoteSupportAgent: (agent: { stopTransport: () => Promise<unknown> }, webContents?: { once: Function }) => void;
  stopAllRemoteSupportTransports: () => Promise<void>;
};
const { fetchRemoteSupportInboxFromControlPlane } = require(
  "../../../electron/remoteSupport/controlPlaneClient.cjs",
) as {
  fetchRemoteSupportInboxFromControlPlane: (input: Record<string, unknown>) => Promise<{
    request: unknown;
    session: unknown;
    error?: string;
  }>;
};

const labDir = "/tmp/waka-rs4e-lab";
const labExe = `${labDir}/rustdesk.exe`;
const deviceA = "device-aaaa-1111";
const labKey = "nLemXVaIMI89rZpwPtUqDo0YlayHK8zJsEzOcaqZWCI=";

function labEnv(extra: Record<string, string> = {}) {
  return {
    WAKA_REMOTE_SUPPORT_TRANSPORT: "lab",
    WAKA_REMOTE_SUPPORT_LAB_DIR: labDir,
    WAKA_RUSTDESK_EXECUTABLE_PATH: labExe,
    WAKA_RUSTDESK_ID_SERVER: "127.0.0.1",
    WAKA_RUSTDESK_RELAY_SERVER: "127.0.0.1",
    WAKA_RUSTDESK_KEY: labKey,
    ...extra,
  };
}

function fakeFs(overrides: Record<string, unknown> = {}) {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (value: string) => String(value) === labExe || files.has(String(value)),
    statSync: () => ({ isFile: () => true, isSymbolicLink: () => false }),
    mkdirSync: () => undefined,
    writeFileSync: (p: string, body: string) => {
      files.set(String(p), String(body));
    },
    chmodSync: () => undefined,
    lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }),
    realpathSync: (value: string) => String(value),
    ...overrides,
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
  child.pid = 4242;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit("exit", 0);
  };
  return child;
}

function trackingSupervisor() {
  const launches: string[][] = [];
  let current: ReturnType<typeof fakeChild> | null = null;
  const supervisor = createProcessSupervisor({
    spawn: (exe: string, args: string[]) => {
      launches.push([exe, ...args]);
      current = fakeChild();
      return current;
    },
  });
  return { supervisor, launches };
}

function snapshot(sessionStatus: string) {
  return {
    deviceFingerprint: deviceA,
    remoteSupportEnabled: true,
    inbox: { request: null, session: { status: sessionStatus } },
  };
}

describe("RS-4E executable allowlist", () => {
  it("rejects a symlink or junction executable", () => {
    const resolved = resolveLabExecutable({
      env: labEnv(),
      fs: fakeFs({
        existsSync: () => true,
        lstatSync: () => ({ isSymbolicLink: () => true, isFile: () => true, isDirectory: () => false }),
      }),
    });
    expect(resolved).toEqual({ ok: false, error: "executable_symlink_rejected" });
  });

  it("rejects a realpath that escapes the lab directory", () => {
    const resolved = resolveLabExecutable({
      env: labEnv(),
      fs: fakeFs({
        existsSync: () => true,
        lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }),
        realpathSync: (value: string) =>
          String(value).includes("rustdesk") ? "/etc/evil/rustdesk.exe" : String(value),
      }),
    });
    expect(resolved).toEqual({ ok: false, error: "executable_path_rejected" });
  });
});

describe("RS-4E server pin", () => {
  it("rejects public RustDesk hosts and unknown host forms", () => {
    expect(normalizeLabHost("rs-ny.rustdesk.com").error).toBe("public_server_forbidden");
    expect(normalizeLabHost("https://127.0.0.1").error).toBe("unknown_host_forbidden");
    expect(normalizeLabHost("/tmp/evil").error).toBe("unknown_host_forbidden");
    expect(normalizeLabHost("not a host").error).toBe("unknown_host_forbidden");
    expect(normalizeLabHost("").error).toBe("unknown_host_forbidden");
    expect(normalizeLabHost("127.0.0.1").ok).toBe(true);
    expect(normalizeLabHost("127.0.0.1:21116").ok).toBe(true);
    expect(
      pinIsolatedServer({
        WAKA_RUSTDESK_ID_SERVER: "rustdesk.com",
        WAKA_RUSTDESK_RELAY_SERVER: "rustdesk.com",
        WAKA_RUSTDESK_KEY: labKey,
      }).error,
    ).toBe("public_server_forbidden");
  });
});

describe("RS-4E key is not on argv", () => {
  it("writes the isolated key to a lab config file instead of process arguments", () => {
    const fs = fakeFs();
    const plan = buildLabLaunchPlan({ env: labEnv(), fs, writeConfig: true });
    expect(plan.ok).toBe(true);
    expect(plan.args?.includes(labKey)).toBe(false);
    expect(plan.childEnv?.WAKA_RUSTDESK_KEY).toBeUndefined();
    expect(plan.configPath).toBeTruthy();
    const body = fs.files.get(String(plan.configPath));
    expect(body).toContain(`key = "${labKey}"`);
    expect(body).toContain("custom-rendezvous-server");
  });
});

describe("RS-4E watchdog and process lifetime", () => {
  it("stops RustDesk when the WAKA session expires", async () => {
    let sessionStatus = "connecting";
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(sessionStatus),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
      watchdogMs: 25,
    });
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(true);
    expect(agent._testAgentState()).toBe("running");
    expect(tracked.supervisor.isRunning()).toBe(true);
    sessionStatus = "expired";
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(agent._testAgentState()).toBe("not_running");
    expect(tracked.supervisor.isRunning()).toBe(false);
  });

  it("stopAllRemoteSupportTransports terminates a tracked agent", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot("connecting"),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
      watchdogMs: 0,
    });
    await agent.startAuthorizedTransport();
    expect(tracked.supervisor.isRunning()).toBe(true);
    trackRemoteSupportAgent(agent);
    await stopAllRemoteSupportTransports();
    expect(agent._testAgentState()).toBe("not_running");
    expect(tracked.supervisor.isRunning()).toBe(false);
  });
});

describe("RS-4E session expiry is applied before inbox", () => {
  it("calls remote_support_expire_stale then remote_support_customer_inbox", async () => {
    const urls: string[] = [];
    const inbox = await fetchRemoteSupportInboxFromControlPlane({
      supabaseUrl: "https://wdirxwvbgsfzbdurmkbf.supabase.co",
      accessToken: "aaa.bbb.ccc",
      deviceFingerprint: deviceA,
      fetch: async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("get_remote_support_platform_settings")) {
          return { ok: true, json: async () => ({ enabled: true }) };
        }
        return {
          ok: true,
          json: async () => ({ request: null, session: { status: "expired" } }),
        };
      },
    });
    expect(urls[0]).toContain("/rpc/remote_support_expire_stale");
    expect(urls.some((u) => u.includes("/rpc/get_remote_support_platform_settings"))).toBe(true);
    expect(urls.some((u) => u.includes("/rpc/remote_support_customer_inbox"))).toBe(true);
    expect(inbox.session).toEqual({ status: "expired" });
  });
});
