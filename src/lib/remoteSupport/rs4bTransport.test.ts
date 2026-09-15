import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { readTransportFlag } = require("../../../electron/remoteSupport/transportFlag.cjs") as {
  readTransportFlag: (env?: Record<string, string>) => string;
};
const { createTransportFromFlag } = require("../../../electron/remoteSupport/transportFactory.cjs") as {
  createTransportFromFlag: (env?: Record<string, string>, overrides?: Record<string, unknown>) => {
    isAvailable: () => boolean;
    startAuthorizedSession: (raw?: unknown) => Promise<{ ok: boolean; transportStatus: string; error?: string }>;
    getSessionStatus: () => { transportStatus: string };
  };
};
const { createSupportAgent } = require("../../../electron/remoteSupport/supportAgent.cjs") as {
  createSupportAgent: (deps?: Record<string, unknown>) => {
    startAuthorizedTransport: (raw?: unknown) => Promise<{
      ok: boolean;
      status?: string;
      transportStatus?: string;
      uiPhase?: string;
      error?: string;
    }>;
    stopTransport: () => Promise<{ ok: boolean; status: string; transportStatus?: string }>;
    requestAuthorizationCheck: () => Promise<{ ok: boolean; status: string; transportStatus?: string }>;
    getStatus: () => { transportStatus?: string; uiPhase?: string };
    _testAgentState: () => string;
    _testTransport: () => { getSessionStatus: () => { transportStatus: string } };
  };
};
const { createProcessSupervisor } = require("../../../electron/remoteSupport/processSupervisor.cjs") as {
  createProcessSupervisor: (deps?: Record<string, unknown>) => {
    start: (exe: string, args: string[]) => { ok: boolean; error?: string };
    stop: () => Promise<{ ok: boolean }>;
    isRunning: () => boolean;
    hasCrashed: () => boolean;
    setOnCrash: (handler: () => void) => void;
  };
};
const { resolveLabExecutable, ignoreRendererLaunchInput } = require(
  "../../../electron/remoteSupport/processAllowlist.cjs",
) as {
  resolveLabExecutable: (input?: Record<string, unknown>) => { ok: boolean; path?: string; error?: string };
  ignoreRendererLaunchInput: (raw: unknown) => null;
};
const { buildLabLaunchPlan, hasBootPersistenceArgs, pinIsolatedServer } = require(
  "../../../electron/remoteSupport/labConfig.cjs",
) as {
  buildLabLaunchPlan: (input?: Record<string, unknown>) => {
    ok: boolean;
    args?: string[];
    error?: string;
    bootPersistence?: boolean;
    credentialLifecycleUnsupported?: boolean;
  };
  hasBootPersistenceArgs: (args: string[]) => boolean;
  pinIsolatedServer: (env?: Record<string, string>) => { ok: boolean; error?: string };
};

const deviceA = "device-aaaa-1111";
const deviceB = "device-bbbb-2222";
const labDir = "/tmp/waka-rs4b-lab";
const labExe = `${labDir}/rustdesk.exe`;

function snapshot(fp: string, sessionStatus?: string) {
  return {
    deviceFingerprint: fp,
    inbox: {
      request: null,
      session: sessionStatus ? { status: sessionStatus } : null,
    },
  };
}

function labEnv(extra: Record<string, string> = {}) {
  return {
    WAKA_REMOTE_SUPPORT_TRANSPORT: "lab",
    WAKA_REMOTE_SUPPORT_LAB_DIR: labDir,
    WAKA_RUSTDESK_EXECUTABLE_PATH: labExe,
    WAKA_RUSTDESK_ID_SERVER: "127.0.0.1",
    WAKA_RUSTDESK_RELAY_SERVER: "127.0.0.1",
    WAKA_RUSTDESK_KEY: "nLemXVaIMI89rZpwPtUqDo0YlayHK8zJsEzOcaqZWCI=",
    ...extra,
  };
}

function fakeFs() {
  return {
    existsSync: (value: string) => String(value) === labExe,
    statSync: () => ({ isFile: () => true }),
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
  return {
    supervisor,
    launches,
    crash() {
      current?.emit("exit", 1);
    },
  };
}

describe("RS-4B feature flag", () => {
  it("production/default configuration is off", () => {
    expect(readTransportFlag({})).toBe("off");
    expect(readTransportFlag({ WAKA_REMOTE_SUPPORT_TRANSPORT: "" })).toBe("off");
  });

  it("unknown feature flag becomes off", () => {
    expect(readTransportFlag({ WAKA_REMOTE_SUPPORT_TRANSPORT: "on" })).toBe("off");
    expect(readTransportFlag({ WAKA_REMOTE_SUPPORT_TRANSPORT: "rustdesk" })).toBe("off");
  });
});

describe("RS-4B mode routing", () => {
  it("mode=off does not launch RustDesk", async () => {
    const tracked = trackingSupervisor();
    const transport = createTransportFromFlag(
      labEnv({ WAKA_REMOTE_SUPPORT_TRANSPORT: "off" }),
      { mode: "off", supervisor: tracked.supervisor, fs: fakeFs() },
    );
    expect(transport.isAvailable()).toBe(false);
    const started = await transport.startAuthorizedSession();
    expect(started.ok).toBe(false);
    expect(tracked.launches).toHaveLength(0);
  });

  it("mode=mock uses only the mock transport", async () => {
    const tracked = trackingSupervisor();
    const transport = createTransportFromFlag(labEnv(), {
      mode: "mock",
      supervisor: tracked.supervisor,
      fs: fakeFs(),
    });
    const started = await transport.startAuthorizedSession();
    expect(started.ok).toBe(true);
    expect(started.transportStatus).toBe("transport_active");
    expect(tracked.launches).toHaveLength(0);
  });
});

describe("RS-4B authorization gate", () => {
  it("mode=lab + authorization denied does not launch", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(false);
    expect(tracked.launches).toHaveLength(0);
  });

  it("mode=lab + authorization connecting permits launch", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA, "connecting"),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(true);
    expect(tracked.launches).toHaveLength(1);
    expect(tracked.launches[0][0]).toBe(labExe);
    expect(started.transportStatus).toBe("transport_ready");
    expect(started.uiPhase).not.toBe("active");
  });

  it("renderer fake authorization is ignored", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    const started = await agent.startAuthorizedTransport({
      authorized: true,
      controlPlaneStatus: "active",
    });
    expect(started.ok).toBe(false);
    expect(tracked.launches).toHaveLength(0);
  });

  it("wrong device denies transport", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => ({
        deviceFingerprint: deviceB,
        inbox: {
          request: { status: "approved", device_fingerprint: deviceA },
          session: { status: "connecting" },
        },
      }),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(false);
    expect(started.error).toBe("wrong_device");
    expect(tracked.launches).toHaveLength(0);
  });
});

describe("RS-4B renderer cannot supply a process", () => {
  it("ignores a renderer executable path", async () => {
    expect(ignoreRendererLaunchInput({ executable: "C:\\\\Windows\\\\System32\\\\cmd.exe" })).toBeNull();
    const resolved = resolveLabExecutable({
      env: labEnv(),
      fs: fakeFs(),
      rendererPayload: { path: "/evil/hack.exe", executable: "/evil/hack.exe" },
    });
    expect(resolved).toEqual({ ok: true, path: labExe });
  });

  it("rejects a renderer command payload at the agent", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    const started = await agent.startAuthorizedTransport({ command: "calc.exe", args: ["/c", "whoami"] });
    expect(started.ok).toBe(false);
    expect(tracked.launches).toHaveLength(0);
  });

  it("rejects a renderer-supplied password", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    const started = await agent.startAuthorizedTransport({ password: "permanent-secret" });
    expect(started.ok).toBe(false);
    expect(tracked.launches).toHaveLength(0);
  });
});

describe("RS-4B stop and crash", () => {
  it("customer End requests stop", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA, "connecting"),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    await agent.startAuthorizedTransport();
    const stopped = await agent.stopTransport();
    expect(stopped.status).toBe("stopped");
    expect(stopped.transportStatus).not.toBe("transport_active");
    expect(agent._testAgentState()).toBe("not_running");
  });

  it("admin Revoke requests stop", async () => {
    let sessionStatus = "connecting";
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA, sessionStatus),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    await agent.startAuthorizedTransport();
    sessionStatus = "revoked";
    const checked = await agent.requestAuthorizationCheck();
    expect(checked.ok).toBe(false);
    expect(checked.status).toBe("revoked");
    expect(agent.getStatus().transportStatus).not.toBe("transport_active");
    expect(agent._testAgentState()).toBe("not_running");
  });

  it("transport crash fails and does not restart", async () => {
    const tracked = trackingSupervisor();
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(deviceA, "active"),
      transportMode: "lab",
      env: labEnv(),
      fs: fakeFs(),
      supervisor: tracked.supervisor,
    });
    await agent.startAuthorizedTransport();
    tracked.crash();
    expect(agent.getStatus().transportStatus).toBe("transport_failed");
    expect(agent.getStatus().uiPhase).not.toBe("active");
    const again = await agent.startAuthorizedTransport();
    expect(again.ok).toBe(false);
    expect(tracked.launches).toHaveLength(1);
  });
});

describe("RS-4B server pin and boot persistence", () => {
  it("refuses public RustDesk infrastructure", () => {
    expect(
      pinIsolatedServer({
        WAKA_RUSTDESK_ID_SERVER: "rs-ny.rustdesk.com",
        WAKA_RUSTDESK_KEY: "nLemXVaIMI89rZpwPtUqDo0YlayHK8zJsEzOcaqZWCI=",
      }).error,
    ).toBe("public_server_forbidden");
    expect(pinIsolatedServer({}).error).toBe("server_pin_required");
  });

  it("does not create boot persistence", () => {
    const plan = buildLabLaunchPlan({ env: labEnv() });
    expect(plan.ok).toBe(true);
    expect(plan.bootPersistence).toBe(false);
    expect(hasBootPersistenceArgs(plan.args ?? [])).toBe(false);
    expect(plan.args).not.toContain("--password");
    expect(plan.args).not.toContain("--install-service");
    expect(plan.args).not.toContain("--silent-install");
    expect(plan.credentialLifecycleUnsupported).toBe(true);
  });
});
