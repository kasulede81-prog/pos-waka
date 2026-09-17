import { describe, expect, it } from "vitest";
import {
  merchantTicketMatchesFilter,
  merchantTicketReference,
  merchantTicketStatusNotificationType,
} from "./merchantTicketsAdmin";

describe("merchantTicketMatchesFilter", () => {
  it("attention covers open and under_review", () => {
    expect(merchantTicketMatchesFilter("open", "attention")).toBe(true);
    expect(merchantTicketMatchesFilter("under_review", "attention")).toBe(true);
    expect(merchantTicketMatchesFilter("waiting_for_merchant", "attention")).toBe(false);
    expect(merchantTicketMatchesFilter("resolved", "attention")).toBe(false);
  });

  it("waiting covers only waiting_for_merchant", () => {
    expect(merchantTicketMatchesFilter("waiting_for_merchant", "waiting")).toBe(true);
    expect(merchantTicketMatchesFilter("open", "waiting")).toBe(false);
  });

  it("done covers resolved and closed", () => {
    expect(merchantTicketMatchesFilter("resolved", "done")).toBe(true);
    expect(merchantTicketMatchesFilter("closed", "done")).toBe(true);
    expect(merchantTicketMatchesFilter("open", "done")).toBe(false);
  });

  it("all covers everything", () => {
    for (const s of ["open", "under_review", "waiting_for_merchant", "resolved", "closed"] as const) {
      expect(merchantTicketMatchesFilter(s, "all")).toBe(true);
    }
  });
});

describe("merchantTicketReference", () => {
  it("pads to four digits with the WAKA prefix", () => {
    expect(merchantTicketReference(2)).toBe("WAKA-0002");
    expect(merchantTicketReference(1042)).toBe("WAKA-1042");
  });
});

describe("merchantTicketStatusNotificationType", () => {
  it("maps lifecycle states to their notification types", () => {
    expect(merchantTicketStatusNotificationType("under_review")).toBe("support_under_review");
    expect(merchantTicketStatusNotificationType("resolved")).toBe("support_resolved");
    expect(merchantTicketStatusNotificationType("closed")).toBe("support_closed");
  });

  it("returns null for states that need no notification", () => {
    expect(merchantTicketStatusNotificationType("open")).toBeNull();
    expect(merchantTicketStatusNotificationType("waiting_for_merchant")).toBeNull();
  });
});
