import { describe, expect, it } from "vitest";
import {
  isSupportSessionOpen,
  latestRouteEvent,
  SUPPORT_SESSION_DEFAULT_MINUTES,
  SUPPORT_SESSION_MAX_MINUTES,
  SUPPORT_SESSION_MIN_MINUTES,
  SUPPORT_SESSION_ROUTES,
  supportSessionSecondsRemaining,
  type SupportSessionEventRow,
} from "./supportSessions";

describe("supportSessions route allowlist", () => {
  it("mirrors the server-side waka_support_session_allowlist()", () => {
    // Keep in sync with migration 20260917130000_support_phase3_live_sessions.sql.
    expect(SUPPORT_SESSION_ROUTES.map((r) => r.path)).toEqual([
      "/office",
      "/stock",
      "/customers",
      "/cash-expenses",
      "/reports",
      "/receipts",
      "/settings",
    ]);
  });

  it("excludes every sensitive route", () => {
    const paths = SUPPORT_SESSION_ROUTES.map((r) => r.path);
    for (const forbidden of [
      "/pos",
      "/close-day",
      "/office/cash-drawer",
      "/staff-center",
      "/settings/pin",
    ]) {
      expect(paths).not.toContain(forbidden);
    }
  });

  it("every entry carries a label key", () => {
    for (const route of SUPPORT_SESSION_ROUTES) {
      expect(route.labelKey).toMatch(/^supportSessionRoute[A-Z]/);
    }
  });

  it("defaults sit inside the server-clamped window", () => {
    expect(SUPPORT_SESSION_MIN_MINUTES).toBe(5);
    expect(SUPPORT_SESSION_MAX_MINUTES).toBe(60);
    expect(SUPPORT_SESSION_DEFAULT_MINUTES).toBe(30);
    expect(SUPPORT_SESSION_DEFAULT_MINUTES).toBeGreaterThanOrEqual(SUPPORT_SESSION_MIN_MINUTES);
    expect(SUPPORT_SESSION_DEFAULT_MINUTES).toBeLessThanOrEqual(SUPPORT_SESSION_MAX_MINUTES);
  });
});

describe("isSupportSessionOpen", () => {
  it("treats requested and active as open", () => {
    expect(isSupportSessionOpen("requested")).toBe(true);
    expect(isSupportSessionOpen("active")).toBe(true);
    expect(isSupportSessionOpen("expired")).toBe(false);
    expect(isSupportSessionOpen("revoked")).toBe(false);
    expect(isSupportSessionOpen("ended")).toBe(false);
  });
});

describe("supportSessionSecondsRemaining", () => {
  it("counts down to the expiry instant", () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    const remaining = supportSessionSecondsRemaining({ expiresAt: future });
    expect(remaining).toBeGreaterThan(298);
    expect(remaining).toBeLessThanOrEqual(300);
  });

  it("goes negative once expired", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    expect(supportSessionSecondsRemaining({ expiresAt: past })).toBeLessThan(0);
  });
});

describe("latestRouteEvent", () => {
  const event = (
    id: number,
    eventType: SupportSessionEventRow["eventType"],
    routePath: string | null,
  ): SupportSessionEventRow => ({
    id,
    sessionId: "s",
    ticketId: "t",
    shopId: "sh",
    supportUserId: null,
    eventType,
    routePath,
    label: "label",
    metadata: {},
    createdAt: new Date().toISOString(),
  });

  it("returns the first event carrying a route, ignoring route-less events", () => {
    const events = [
      event(1, "session_started", null),
      event(2, "route_changed", "/stock"),
      event(3, "dialog_opened", null),
      event(4, "route_changed", "/reports"),
    ];
    expect(latestRouteEvent(events)?.id).toBe(2);
  });

  it("returns null when no event has a route", () => {
    expect(latestRouteEvent([event(1, "session_started", null)])).toBeNull();
    expect(latestRouteEvent([])).toBeNull();
  });
});
