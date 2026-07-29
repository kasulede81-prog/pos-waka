import { describe, expect, it } from "vitest";
import { enforceHttpsOrigin, isLoopbackOrPrivateLan } from "./authConfig";

describe("authConfig native / live-reload origins", () => {
  it("detects loopback and private LAN hosts", () => {
    expect(isLoopbackOrPrivateLan("localhost")).toBe(true);
    expect(isLoopbackOrPrivateLan("127.0.0.1")).toBe(true);
    expect(isLoopbackOrPrivateLan("192.168.1.20")).toBe(true);
    expect(isLoopbackOrPrivateLan("10.0.0.5")).toBe(true);
    expect(isLoopbackOrPrivateLan("172.16.4.2")).toBe(true);
    expect(isLoopbackOrPrivateLan("pos.waka.ug")).toBe(false);
  });

  it("keeps http for LAN live-reload but upgrades public http to https", () => {
    expect(enforceHttpsOrigin("http://192.168.1.20:5173")).toBe("http://192.168.1.20:5173");
    expect(enforceHttpsOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
    expect(enforceHttpsOrigin("http://pos.waka.ug")).toBe("https://pos.waka.ug");
    expect(enforceHttpsOrigin("https://localhost")).toBe("https://localhost");
  });
});
