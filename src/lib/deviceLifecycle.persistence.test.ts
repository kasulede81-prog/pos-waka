import { describe, expect, it } from "vitest";
import {
  heartbeatPolicy,
  loginRegistrationPolicy,
  type ShopDeviceStatus,
} from "./deviceLifecycle";

/** In-memory model of server device row for policy regression tests. */
function simulateLifecycle() {
  let status: ShopDeviceStatus | null = null;

  return {
    get status() {
      return status;
    },
    disconnect() {
      status = "disconnected";
    },
    heartbeat() {
      if (heartbeatPolicy(status) === "reject") return "rejected" as const;
      if (status === null) status = "active";
      return "updated" as const;
    },
    syncStartup() {
      return this.heartbeat();
    },
    appRestart() {
      return this.heartbeat();
    },
    login() {
      const action = loginRegistrationPolicy(status);
      if (action === "reject_revoked") return "rejected" as const;
      if (action === "reactivate" || action === "insert") status = "active";
      return action;
    },
  };
}

describe("disconnect persistence simulation", () => {
  it("disconnect survives heartbeat", () => {
    const d = simulateLifecycle();
    d.heartbeat();
    expect(d.status).toBe("active");
    d.disconnect();
    expect(d.status).toBe("disconnected");
    expect(d.heartbeat()).toBe("rejected");
    expect(d.status).toBe("disconnected");
  });

  it("disconnect survives sync startup", () => {
    const d = simulateLifecycle();
    d.heartbeat();
    d.disconnect();
    expect(d.syncStartup()).toBe("rejected");
    expect(d.status).toBe("disconnected");
  });

  it("disconnect survives app restart", () => {
    const d = simulateLifecycle();
    d.heartbeat();
    d.disconnect();
    expect(d.appRestart()).toBe("rejected");
    expect(d.status).toBe("disconnected");
  });

  it("fresh login reactivates disconnected device", () => {
    const d = simulateLifecycle();
    d.heartbeat();
    d.disconnect();
    expect(d.login()).toBe("reactivate");
    expect(d.status).toBe("active");
    expect(d.heartbeat()).toBe("updated");
  });

  it("active heartbeat still works", () => {
    const d = simulateLifecycle();
    expect(d.heartbeat()).toBe("updated");
    expect(d.status).toBe("active");
    expect(d.heartbeat()).toBe("updated");
  });
});
