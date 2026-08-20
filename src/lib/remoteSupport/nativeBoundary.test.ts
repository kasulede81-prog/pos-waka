import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { getWakaDesktopRemoteSupport, nativeStatusFromControlPlane } from "./nativeBoundary";

const require = createRequire(import.meta.url);
const {
  isRemoteSupportChannel,
  REMOTE_SUPPORT_CHANNELS,
} = require("../../../electron/remoteSupport/channels.cjs") as {
  isRemoteSupportChannel: (name: unknown) => boolean;
  REMOTE_SUPPORT_CHANNELS: Record<string, string>;
};
const {
  decideFromControlPlane,
  ignoreRendererAuthorizationInput,
  validateCurrentRemoteSupportAuthorization,
} = require("../../../electron/remoteSupport/authorizationProvider.cjs") as {
  decideFromControlPlane: (snapshot: unknown, bound?: string | null) => {
    authorized: boolean;
    status?: string;
    error?: string;
    reason?: string;
    fingerprint?: string;
  };
  ignoreRendererAuthorizationInput: (raw: unknown) => null;
  validateCurrentRemoteSupportAuthorization: (input: {
    snapshot?: unknown;
    boundFingerprint?: string | null;
    rendererPayload?: unknown;
  }) => Promise<{ authorized: boolean; status?: string; error?: string; reason?: string }>;
};
const { createRemoteSupportAgentStub } = require("../../../electron/remoteSupport/agentStub.cjs") as {
  createRemoteSupportAgentStub: (deps?: {
    loadSnapshot?: () => Promise<unknown>;
    transportMode?: string;
  }) => {
    getStatus: () => { ok: boolean; status: string; transportInstalled: boolean; transportStatus?: string; uiPhase?: string };
    requestAuthorizationCheck: (raw?: unknown) => Promise<{
      ok: boolean;
      status: string;
      error?: string;
      transportInstalled: boolean;
      transportStatus?: string;
      uiPhase?: string;
    }>;
    startAuthorizedTransport: (raw?: unknown) => Promise<{
      ok: boolean;
      status: string;
      error?: string;
      transportStatus?: string;
      uiPhase?: string;
    }>;
    stopSession: () => Promise<{ ok: boolean; status: string; transportInstalled: boolean }>;
    stopTransport: () => Promise<{ ok: boolean; status: string; transportInstalled: boolean }>;
  };
};
const { isAllowlistedControlPlaneUrl, controlPlaneUrlForRef } = require(
  "../../../electron/remoteSupport/controlPlaneConfig.cjs",
) as {
  isAllowlistedControlPlaneUrl: (url: string) => boolean;
  controlPlaneUrlForRef: (ref: string) => string | null;
};
const { snapshotFromLocalStorageMap } = require("../../../electron/remoteSupport/partitionReader.cjs") as {
  snapshotFromLocalStorageMap: (map: Record<string, string>) => {
    deviceFingerprint: string;
    supabaseUrl: string | null;
    accessToken: string | null;
  };
};

const deviceA = "device-aaaa-1111";
const deviceB = "device-bbbb-2222";

function snapshot(fp: string, sessionStatus?: string, requestStatus?: string) {
  return {
    deviceFingerprint: fp,
    remoteSupportEnabled: true,
    inbox: {
      request: requestStatus
        ? { status: requestStatus, device_fingerprint: fp }
        : null,
      session: sessionStatus ? { status: sessionStatus } : null,
    },
  };
}

describe("Remote Support IPC channels", () => {
  it("accepts only the fixed channels", () => {
    expect(isRemoteSupportChannel(REMOTE_SUPPORT_CHANNELS.GET_STATUS)).toBe(true);
    expect(isRemoteSupportChannel(REMOTE_SUPPORT_CHANNELS.END)).toBe(true);
    expect(isRemoteSupportChannel(REMOTE_SUPPORT_CHANNELS.AUTHORIZATION_CHECK)).toBe(true);
    expect(isRemoteSupportChannel(REMOTE_SUPPORT_CHANNELS.START_TRANSPORT)).toBe(true);
    expect(isRemoteSupportChannel(REMOTE_SUPPORT_CHANNELS.STOP_TRANSPORT)).toBe(true);
    expect(isRemoteSupportChannel(REMOTE_SUPPORT_CHANNELS.GET_TRANSPORT_STATUS)).toBe(true);
    expect(REMOTE_SUPPORT_CHANNELS.AUTHORIZATION_CHECK).toBe("waka:remote-support:authorization-check");
    expect(REMOTE_SUPPORT_CHANNELS.START_TRANSPORT).toBe("waka:remote-support:start-transport");
  });

  it("rejects unknown channels", () => {
    expect(isRemoteSupportChannel("waka:remote-support:authorized-start")).toBe(false);
    expect(isRemoteSupportChannel("waka:remote-support:spawn")).toBe(false);
    expect(isRemoteSupportChannel("waka:remote-support:rustdesk")).toBe(false);
    expect(isRemoteSupportChannel("")).toBe(false);
  });
});

describe("compromised renderer cannot manufacture authorization", () => {
  it("ignores renderer controlPlaneStatus = approved", async () => {
    expect(ignoreRendererAuthorizationInput({ controlPlaneStatus: "approved" })).toBeNull();
    const result = await validateCurrentRemoteSupportAuthorization({
      snapshot: snapshot(deviceA),
      rendererPayload: { controlPlaneStatus: "approved", deviceFingerprint: deviceA },
    });
    expect(result.authorized).toBe(false);
    expect(result.status).toBe("not_authorized");
  });

  it("ignores renderer authorized = true", async () => {
    const result = await validateCurrentRemoteSupportAuthorization({
      snapshot: snapshot(deviceA),
      rendererPayload: { authorized: true },
    });
    expect(result.authorized).toBe(false);
  });

  it("denies when the renderer supplies another device fingerprint", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceB),
    });
    const result = await stub.requestAuthorizationCheck({
      deviceFingerprint: deviceA,
      controlPlaneStatus: "approved",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_authorized");
  });

  it("ignores a renderer-supplied fake session id", async () => {
    const result = await validateCurrentRemoteSupportAuthorization({
      snapshot: snapshot(deviceA),
      rendererPayload: { session_id: "sess-forged", controlPlaneStatus: "active" },
    });
    expect(result.authorized).toBe(false);
    expect(result.status).toBe("not_authorized");
  });

  it("denies when the server session is revoked even if the renderer claims approved", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA, "revoked"),
    });
    const result = await stub.requestAuthorizationCheck({ controlPlaneStatus: "approved", authorized: true });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("revoked");
    expect(stub.getStatus().status).toBe("revoked");
  });

  it("denies when the server session is ended even if the renderer claims active", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA, "ended"),
    });
    const result = await stub.requestAuthorizationCheck({ controlPlaneStatus: "active" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("not_authorized");
  });

  it("denies a Device A server session when the current native device is Device B", async () => {
    const result = decideFromControlPlane(
      {
        deviceFingerprint: deviceB,
        remoteSupportEnabled: true,
        inbox: {
          request: { status: "approved", device_fingerprint: deviceA },
          session: { status: "connecting" },
        },
      },
      null,
    );
    expect(result.authorized).toBe(false);
    expect(result.error).toBe("wrong_device");
  });
});

describe("control-plane authorization", () => {
  it("authorizes only when the server inbox has a connecting/active session for this device", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA, "connecting"),
    });
    expect(stub.getStatus().status).toBe("idle");
    const started = await stub.requestAuthorizationCheck();
    expect(started).toMatchObject({
      ok: true,
      status: "authorized_stub",
      transportInstalled: false,
      transportEnabled: false,
      transportStatus: "transport_unavailable",
      uiPhase: "unavailable",
    });
  });

  it("does not start the stub for a pending request", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA, undefined, "requested"),
    });
    const denied = await stub.requestAuthorizationCheck();
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe("authorization_pending");
    expect(stub.getStatus().status).not.toBe("authorized_stub");
  });

  it("rejects a later localStorage device switch in this process", async () => {
    let fp = deviceA;
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(fp, "connecting"),
    });
    expect((await stub.requestAuthorizationCheck()).ok).toBe(true);
    fp = deviceB;
    const wrong = await stub.requestAuthorizationCheck();
    expect(wrong).toMatchObject({ ok: false, error: "wrong_device" });
  });

  it("stops pretending an agent is running after endSession", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA, "connecting"),
    });
    await stub.requestAuthorizationCheck();
    expect(await stub.stopSession()).toMatchObject({ ok: true, status: "stopped", transportInstalled: false });
    expect(stub.getStatus().status).toBe("stopped");
  });
});

describe("RS-FREEZE-1 master switch", () => {
  it("denies native authorization when the platform switch is off", async () => {
    const result = decideFromControlPlane(
      {
        deviceFingerprint: deviceA,
        remoteSupportEnabled: false,
        inbox: {
          request: null,
          session: { status: "connecting" },
        },
      },
      null,
    );
    expect(result.authorized).toBe(false);
    expect(result.error).toBe("remote_support_disabled");
  });

  it("does not start transport when the platform switch is missing (fail closed)", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => ({
        deviceFingerprint: deviceA,
        inbox: { request: null, session: { status: "connecting" } },
      }),
    });
    const started = await stub.startAuthorizedTransport();
    expect(started.ok).toBe(false);
    expect(started.error).toBe("remote_support_disabled");
    expect(started.transportStatus).not.toBe("transport_active");
  });
});

describe("control-plane URL allowlist", () => {
  it("accepts only known WAKA Supabase projects", () => {
    expect(isAllowlistedControlPlaneUrl("https://ljaedextsenbkxzzgxcg.supabase.co")).toBe(true);
    expect(isAllowlistedControlPlaneUrl("https://wdirxwvbgsfzbdurmkbf.supabase.co")).toBe(true);
    expect(isAllowlistedControlPlaneUrl("https://evil.example.com")).toBe(false);
    expect(isAllowlistedControlPlaneUrl("https://aaaaaaaaaaaaaaaaaaaa.supabase.co")).toBe(false);
    expect(controlPlaneUrlForRef("not-a-project")).toBeNull();
  });

  it("derives the control-plane URL from the partition auth key, not the renderer", () => {
    const material = snapshotFromLocalStorageMap({
      "waka-pos-device-id": deviceA,
      "sb-wdirxwvbgsfzbdurmkbf-auth-token": JSON.stringify({ access_token: "aaa.bbb.ccc" }),
    });
    expect(material.deviceFingerprint).toBe(deviceA);
    expect(material.supabaseUrl).toBe("https://wdirxwvbgsfzbdurmkbf.supabase.co");
    expect(material.accessToken).toBe("aaa.bbb.ccc");
  });

  it("rejects an unknown project ref in localStorage", () => {
    const material = snapshotFromLocalStorageMap({
      "waka-pos-device-id": deviceA,
      "sb-attackerprojectxxxx-auth-token": JSON.stringify({ access_token: "aaa.bbb.ccc" }),
    });
    expect(material.supabaseUrl).toBeNull();
    expect(material.accessToken).toBeNull();
  });
});

describe("renderer native API shape", () => {
  it("getStatus, endSession, and requestAuthorizationCheck return typed values", async () => {
    const previous = (globalThis as { window?: Window }).window;
    (globalThis as { window: Window }).window = {
      wakaDesktop: {
        remoteSupport: {
          getStatus: async () => ({ ok: true, status: "idle", transportInstalled: false }),
          endSession: async () => ({ ok: true, status: "stopped", transportInstalled: false }),
          requestAuthorizationCheck: async () => ({
            ok: true,
            status: "authorized_stub",
            transportInstalled: false,
          }),
          startAuthorizedTransport: async () => ({
            ok: false,
            status: "authorized_stub",
            transportStatus: "transport_unavailable",
          }),
          stopTransport: async () => ({ ok: true, status: "stopped", transportInstalled: false }),
          getTransportStatus: async () => ({
            ok: true,
            status: "idle",
            transportStatus: "transport_unavailable",
            uiPhase: "unavailable",
          }),
        },
      },
    } as Window;
    try {
      const api = getWakaDesktopRemoteSupport();
      expect(api).not.toBeNull();
      await expect(api!.getStatus()).resolves.toEqual({ ok: true, status: "idle", transportInstalled: false });
      await expect(api!.endSession()).resolves.toEqual({ ok: true, status: "stopped", transportInstalled: false });
      await expect(api!.requestAuthorizationCheck()).resolves.toMatchObject({ status: "authorized_stub" });
    } finally {
      if (previous) (globalThis as { window: Window }).window = previous;
      else delete (globalThis as { window?: Window }).window;
    }
  });

  it("returns null when window.wakaDesktop.remoteSupport is absent", () => {
    expect(getWakaDesktopRemoteSupport()).toBeNull();
  });

  it("maps control-plane states without claiming a live remote desktop", () => {
    expect(nativeStatusFromControlPlane("connecting")).toBe("authorized_stub");
    expect(nativeStatusFromControlPlane("active")).toBe("authorized_stub");
    expect(nativeStatusFromControlPlane("requested")).toBe("authorization_pending");
    expect(nativeStatusFromControlPlane("approved")).toBe("not_authorized");
    expect(nativeStatusFromControlPlane("revoked")).toBe("revoked");
  });
});

describe("RS-4A transport start is fail-closed", () => {
  it("does not start transport when the feature flag is off", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA, "connecting"),
      transportMode: "off",
    });
    await stub.requestAuthorizationCheck();
    const started = await stub.startAuthorizedTransport();
    expect(started.ok).toBe(false);
    expect(started.transportStatus).not.toBe("transport_active");
    expect(started.uiPhase).not.toBe("active");
  });

  it("ignores renderer authorized=true when starting transport", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => snapshot(deviceA),
    });
    const started = await stub.startAuthorizedTransport({ authorized: true, startRustDesk: true });
    expect(started.ok).toBe(false);
    expect(started.transportStatus).not.toBe("transport_active");
  });

  it("does not start transport when WAKA is unreachable", async () => {
    const stub = createRemoteSupportAgentStub({
      loadSnapshot: async () => ({
        deviceFingerprint: deviceA,
        remoteSupportEnabled: true,
        controlPlaneError: "control_plane_unavailable",
        inbox: { request: null, session: null },
      }),
    });
    const started = await stub.startAuthorizedTransport();
    expect(started.ok).toBe(false);
    expect(started.error).toBe("control_plane_unavailable");
    expect(started.transportStatus).not.toBe("transport_active");
  });
});
