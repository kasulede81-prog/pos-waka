import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrCreateDeviceId } = vi.hoisted(() => ({
  getOrCreateDeviceId: vi.fn(() => "device-aaaa-1111"),
}));
const { getDeviceOnline } = vi.hoisted(() => ({
  getDeviceOnline: vi.fn(() => true),
}));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./deviceId", () => ({ getOrCreateDeviceId }));
vi.mock("./deviceOnline", () => ({ getDeviceOnline }));
vi.mock("./supabase", () => ({
  supabase: { rpc },
}));

import {
  POS_SUPPORT_CATEGORIES,
  buildPosSupportDiagnostics,
  canSeePosNeedHelp,
  normalizePosSupportCategory,
  posSupportSubject,
  submitPosSupportTicket,
  tryBeginPosHelpSubmit,
  validatePosSupportForm,
} from "./posSupportRequest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("POS Need Help visibility", () => {
  it("lets a cashier see Help on the POS", () => {
    expect(canSeePosNeedHelp({ authenticated: true, internalAdminRoute: false })).toBe(true);
    expect(canSeePosNeedHelp({ authenticated: true })).toBe(true);
  });

  it("lets any authenticated POS user open the form", () => {
    for (const role of ["cashier", "waiter", "manager", "owner"]) {
      expect(canSeePosNeedHelp({ authenticated: true }), role).toBe(true);
    }
  });

  it("hides Help when signed out, on internal admin, or when the POS is locked", () => {
    expect(canSeePosNeedHelp({ authenticated: false })).toBe(false);
    expect(canSeePosNeedHelp({ authenticated: true, internalAdminRoute: true })).toBe(false);
    expect(canSeePosNeedHelp({ authenticated: true, posLocked: true })).toBe(false);
  });
});

describe("POS Need Help form", () => {
  it("requires a description", () => {
    expect(validatePosSupportForm({ description: "" }).ok).toBe(false);
    expect(validatePosSupportForm({ description: "  hi  " }).ok).toBe(false);
    expect(validatePosSupportForm({ description: "Printer is not working" }).ok).toBe(true);
  });

  it("treats category as optional", () => {
    const parsed = validatePosSupportForm({ description: "Printer is not working" });
    expect(parsed.ok).toBe(true);
    expect(parsed.category).toBeNull();
    expect(normalizePosSupportCategory("printer")).toBe("printer");
    expect(normalizePosSupportCategory("not-a-category")).toBeNull();
    expect(POS_SUPPORT_CATEGORIES).toContain("printer");
  });
});

describe("POS Need Help submission", () => {
  beforeEach(() => {
    rpc.mockReset();
    getDeviceOnline.mockReturnValue(true);
    getOrCreateDeviceId.mockReturnValue("device-aaaa-1111");
  });

  it("sends a ticket with the existing device id and no Remote Support fields", async () => {
    rpc.mockResolvedValue({ data: { ok: true, ticket_id: "ticket-1" }, error: null });
    const result = await submitPosSupportTicket({
      shopId: "shop-1",
      description: "Printer is not working",
      category: "printer",
      role: "cashier",
    });
    expect(result).toEqual({ ok: true, ticketId: "ticket-1" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("shop_submit_pos_support_ticket", {
      p_shop_id: "shop-1",
      p_subject: "printer: Printer is not working",
      p_body: "Printer is not working",
      p_issue_type: "printer",
      p_diagnostics: {
        deviceId: "device-aaaa-1111",
        appVersion: expect.any(String),
        source: "pos_need_help",
        category: "printer",
        role: "cashier",
      },
    });
    const payload = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("p_assigned_internal_admin_id");
    expect(payload).not.toHaveProperty("password");
    expect(JSON.stringify(payload)).not.toMatch(/remote_support_request_start|rustdesk|grant_jti/i);
  });

  it("prevents double submission with a submit lock", () => {
    const lock = { current: false };
    expect(tryBeginPosHelpSubmit(lock)).toBe(true);
    expect(tryBeginPosHelpSubmit(lock)).toBe(false);
    lock.current = false;
    expect(tryBeginPosHelpSubmit(lock)).toBe(true);
  });

  it("returns failed when the server rejects the ticket", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "forbidden" }, error: null });
    const result = await submitPosSupportTicket({ shopId: "shop-1", description: "Need help with sync" });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("does not pretend a ticket was sent while offline", async () => {
    getDeviceOnline.mockReturnValue(false);
    const result = await submitPosSupportTicket({ shopId: "shop-1", description: "Need help with sync" });
    expect(result).toEqual({ ok: false, error: "offline" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses getOrCreateDeviceId for context only", () => {
    const diagnostics = buildPosSupportDiagnostics({ category: "scanner", role: "cashier" });
    expect(diagnostics.deviceId).toBe("device-aaaa-1111");
    expect(getOrCreateDeviceId).toHaveBeenCalled();
    expect(posSupportSubject("Scanner will not beep", "scanner")).toBe("scanner: Scanner will not beep");
  });
});

describe("RS-CI-0 isolation", () => {
  const client = readFileSync(join(ROOT, "src/lib/posSupportRequest.ts"), "utf8");
  const ui = readFileSync(join(ROOT, "src/components/support/PosNeedHelpHost.tsx"), "utf8");
  const sql = readFileSync(join(ROOT, "supabase/migrations/153_shop_submit_pos_support_ticket.sql"), "utf8");
  const shell = readFileSync(join(ROOT, "src/components/layout/AppShell.tsx"), "utf8");
  const blob = `${client}\n${ui}\n${sql}`;

  it("mounts Help in AppShell without owner or settings permissions", () => {
    expect(shell).toContain("PosNeedHelpHost");
    expect(shell).not.toContain("canSeePosNeedHelp({ authenticated: actor.role === \"owner\"");
    expect(shell).not.toMatch(/PosNeedHelpHost[\s\S]{0,400}settings\.view/);
    expect(shell).not.toMatch(/PosNeedHelpHost[\s\S]{0,400}nav\.office/);
  });

  it("does not start Remote Support, Electron transport, or RustDesk", () => {
    expect(blob).not.toContain("remote_support_request_start");
    expect(blob).not.toContain("remote_support_customer_approve");
    expect(blob).not.toContain("remote_support_sessions");
    expect(blob).not.toContain("startAuthorizedTransport");
    expect(blob).not.toContain("createRustDeskTransportAdapter");
    expect(blob).not.toContain("electron/remoteSupport");
    expect(blob).not.toContain("requestRemoteSupport");
  });

  it("does not collect passwords or payment secrets", () => {
    expect(blob).not.toMatch(/password|card_number|cvv|grant_jti|service_role/i);
    expect(sql).toContain("auth.uid ()");
    expect(sql).toContain("user_can_access_shop");
    expect(sql).not.toContain("assigned_internal_admin_id");
  });
});
