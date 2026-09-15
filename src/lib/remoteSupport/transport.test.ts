import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { remoteSupportUiPhase } from "./transport";

const require = createRequire(import.meta.url);
const { createMockRemoteSupportTransport } = require("../../../electron/remoteSupport/mockTransport.cjs") as {
  createMockRemoteSupportTransport: () => {
    isAvailable: () => boolean;
    startAuthorizedSession: () => Promise<{ ok: boolean; transportStatus: string }>;
    stopSession: () => Promise<{ ok: boolean; transportStatus: string }>;
    disconnectSession: () => Promise<{ ok: boolean; transportStatus: string }>;
    rotateCredentials: () => Promise<{ ok: boolean; credentialRotationUnsupported?: boolean }>;
    getSessionStatus: () => { transportStatus: string };
    shutdown: () => Promise<unknown>;
    crash: () => void;
    _testCredential: () => string | null;
  };
};
const { createRustDeskTransportAdapter } = require("../../../electron/remoteSupport/rustdeskAdapter.cjs") as {
  createRustDeskTransportAdapter: (opts?: {
    labEnabled?: boolean;
    env?: Record<string, string>;
  }) => {
    isAvailable: () => boolean;
    startAuthorizedSession: () => Promise<{
      ok: boolean;
      transportStatus: string;
      error?: string;
      credentialRotationUnsupported?: boolean;
    }>;
    rotateCredentials: () => Promise<{ credentialRotationUnsupported?: boolean }>;
  };
};
const { createTransportFromFlag } = require("../../../electron/remoteSupport/transportFactory.cjs") as {
  createTransportFromFlag: (env?: Record<string, string>, overrides?: Record<string, unknown>) => {
    isAvailable: () => boolean;
    getSessionStatus: () => { transportStatus: string; transportInstalled?: boolean };
  };
};
const { createSupportAgent } = require("../../../electron/remoteSupport/supportAgent.cjs") as {
  createSupportAgent: (deps?: Record<string, unknown>) => {
    requestAuthorizationCheck: () => Promise<{ ok: boolean; status: string }>;
    startAuthorizedTransport: (raw?: unknown) => Promise<{
      ok: boolean;
      transportStatus?: string;
      uiPhase?: string;
      error?: string;
    }>;
    stopTransport: () => Promise<{ ok: boolean; status: string; transportStatus?: string }>;
    getStatus: () => { transportStatus?: string; uiPhase?: string };
    _testAgentState: () => string;
    _testTransport: () => { crash: () => void; _testCredential?: () => string | null };
  };
};
const { sanitizePublicResult } = require("../../../electron/remoteSupport/transportTypes.cjs") as {
  sanitizePublicResult: (raw: Record<string, unknown>) => Record<string, unknown>;
};
const { readTransportFlag } = require("../../../electron/remoteSupport/transportFlag.cjs") as {
  readTransportFlag: (env?: Record<string, string>) => string;
};

const deviceA = "device-aaaa-1111";

function snapshot(sessionStatus?: string) {
  return {
    deviceFingerprint: deviceA,
    inbox: {
      request: null,
      session: sessionStatus ? { status: sessionStatus } : null,
    },
  };
}

describe("transport feature flag", () => {
  it("defaults to off and ignores unknown values", () => {
    expect(readTransportFlag({})).toBe("off");
    expect(readTransportFlag({ WAKA_REMOTE_SUPPORT_TRANSPORT: "on" })).toBe("off");
    expect(readTransportFlag({ WAKA_REMOTE_SUPPORT_TRANSPORT: "mock" })).toBe("mock");
  });
});

describe("MockRemoteSupportTransport", () => {
  it("simulates start → connect → active → stop", async () => {
    const mock = createMockRemoteSupportTransport();
    expect(mock.getSessionStatus().transportStatus).toBe("transport_stopped");
    const started = await mock.startAuthorizedSession();
    expect(started).toMatchObject({ ok: true, transportStatus: "transport_active" });
    await mock.disconnectSession();
    expect(mock.getSessionStatus().transportStatus).toBe("transport_stopped");
    await mock.stopSession();
    expect(mock.getSessionStatus().transportStatus).toBe("transport_stopped");
  });

  it("rotates the in-memory credential and does not auto-restart after crash", async () => {
    const mock = createMockRemoteSupportTransport();
    await mock.startAuthorizedSession();
    const first = mock._testCredential();
    await mock.rotateCredentials();
    expect(mock._testCredential()).not.toBe(first);
    mock.crash();
    expect(mock.getSessionStatus().transportStatus).toBe("transport_failed");
    expect(mock.isAvailable()).toBe(false);
    const again = await mock.startAuthorizedSession();
    expect(again.ok).toBe(false);
    expect(again.transportStatus).not.toBe("transport_active");
  });
});

describe("RustDesk adapter stays disabled without lab config", () => {
  it("never reports active when the executable and server are not pinned", async () => {
    const adapter = createRustDeskTransportAdapter({ labEnabled: true, env: {} });
    expect(adapter.isAvailable()).toBe(false);
    const started = await adapter.startAuthorizedSession();
    expect(started.ok).toBe(false);
    expect(started.transportStatus).not.toBe("transport_active");
    expect(started.credentialRotationUnsupported).toBe(true);
  });
});

describe("transport factory", () => {
  it("uses the disabled adapter by default", () => {
    const transport = createTransportFromFlag({});
    expect(transport.isAvailable()).toBe(false);
    expect(transport.getSessionStatus().transportStatus).toBe("transport_unavailable");
  });
});

describe("Support Agent + mock transport", () => {
  it("reaches transport_active only after native authorization", async () => {
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot("connecting"),
      transportMode: "mock",
    });
    expect(agent._testAgentState()).toBe("not_running");
    const started = await agent.startAuthorizedTransport();
    expect(started.ok).toBe(true);
    expect(started.transportStatus).toBe("transport_active");
    expect(started.uiPhase).toBe("active");
    expect(agent._testAgentState()).toBe("running");
  });

  it("stops transport and exits the agent on customer end", async () => {
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot("connecting"),
      transportMode: "mock",
    });
    await agent.startAuthorizedTransport();
    const stopped = await agent.stopTransport();
    expect(stopped.status).toBe("stopped");
    expect(stopped.transportStatus).not.toBe("transport_active");
    expect(agent._testAgentState()).toBe("not_running");
  });

  it("fail-closes an active transport when authorization is later denied", async () => {
    let sessionStatus = "connecting";
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot(sessionStatus),
      transportMode: "mock",
    });
    await agent.startAuthorizedTransport();
    expect(agent.getStatus().transportStatus).toBe("transport_active");
    sessionStatus = "revoked";
    const checked = await agent.requestAuthorizationCheck();
    expect(checked.ok).toBe(false);
    expect(checked.status).toBe("revoked");
    expect(agent.getStatus().transportStatus).not.toBe("transport_active");
    expect(agent._testAgentState()).toBe("not_running");
  });

  it("does not silently restart after a transport crash", async () => {
    const agent = createSupportAgent({
      loadSnapshot: async () => snapshot("active"),
      transportMode: "mock",
    });
    await agent.startAuthorizedTransport();
    agent._testTransport().crash();
    expect(agent.getStatus().transportStatus).toBe("transport_failed");
    expect(agent.getStatus().uiPhase).not.toBe("active");
  });
});

describe("public result sanitizer", () => {
  it("strips transport secrets and vendor fields", () => {
    const clean = sanitizePublicResult({
      ok: true,
      status: "authorized_stub",
      transportStatus: "transport_active",
      grant_jti: "must-not-leak",
      password: "secret",
      rustdeskId: "123456789",
      hbbs: "example.com",
    });
    expect(clean).toMatchObject({
      ok: true,
      status: "authorized_stub",
      transportStatus: "transport_active",
      uiPhase: "active",
    });
    expect(clean).not.toHaveProperty("grant_jti");
    expect(clean).not.toHaveProperty("password");
    expect(clean).not.toHaveProperty("rustdeskId");
    expect(clean).not.toHaveProperty("hbbs");
  });
});

describe("renderer UI phase", () => {
  it("never maps to active unless transport_active", () => {
    expect(
      remoteSupportUiPhase({
        controlPlaneSessionStatus: "active",
        transportStatus: "transport_unavailable",
      }),
    ).toBe("unavailable");
    expect(
      remoteSupportUiPhase({
        controlPlaneSessionStatus: "connecting",
        transportStatus: "transport_active",
      }),
    ).toBe("active");
    expect(remoteSupportUiPhase({ controlPlaneRequestStatus: "requested" })).toBe("requested");
  });
});
