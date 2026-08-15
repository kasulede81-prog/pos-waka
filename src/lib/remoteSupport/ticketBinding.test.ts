import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canRemoteSupport } from "../../components/internal-admin/v2/adminRoles";
import { assertRemoteSupportTicketShopBinding } from "./ticketBinding";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sql154 = readFileSync(join(ROOT, "supabase/migrations/154_remote_support_ticket_shop_binding.sql"), "utf8");
const sql152 = readFileSync(join(ROOT, "supabase/migrations/152_remote_support_security_hardening.sql"), "utf8");

const shopA = "shop-a";
const shopB = "shop-b";
const ticketA = { id: "ticket-a", shop_id: shopA };
const ticketB = { id: "ticket-b", shop_id: shopB };

function startFn(sql: string): string {
  const start = sql.indexOf("create or replace function public.remote_support_request_start");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("RS-CI-0.2 ticket shop-binding", () => {
  it("A. Shop A device with no ticket is allowed", () => {
    expect(
      assertRemoteSupportTicketShopBinding({
        shopId: shopA,
        deviceShopId: shopA,
        supportRequestId: undefined,
        ticket: null,
      }),
    ).toEqual({ ok: true, attachTicket: false, createRow: true });
  });

  it("B. Shop A device with Shop A ticket is allowed", () => {
    expect(
      assertRemoteSupportTicketShopBinding({
        shopId: shopA,
        deviceShopId: shopA,
        supportRequestId: ticketA.id,
        ticket: ticketA,
      }),
    ).toEqual({ ok: true, attachTicket: true, createRow: true });
  });

  it("C. Shop A device with Shop B ticket is denied", () => {
    expect(
      assertRemoteSupportTicketShopBinding({
        shopId: shopA,
        deviceShopId: shopA,
        supportRequestId: ticketB.id,
        ticket: ticketB,
      }),
    ).toEqual({ ok: false, createRow: false, error: "support_request_shop_mismatch" });
  });

  it("D. nonexistent ticket is denied", () => {
    expect(
      assertRemoteSupportTicketShopBinding({
        shopId: shopA,
        deviceShopId: shopA,
        supportRequestId: "missing-ticket",
        ticket: null,
      }),
    ).toEqual({ ok: false, createRow: false, error: "support_request_not_found" });
  });

  it("E. NULL supportRequestId still works", () => {
    expect(
      assertRemoteSupportTicketShopBinding({
        shopId: shopA,
        deviceShopId: shopA,
        supportRequestId: null,
        ticket: ticketB,
      }),
    ).toEqual({ ok: true, attachTicket: false, createRow: true });
  });

  it("F. Device Shop A + ticket Shop B creates no remote_support_requests row", () => {
    const result = assertRemoteSupportTicketShopBinding({
      shopId: shopA,
      deviceShopId: shopA,
      supportRequestId: ticketB.id,
      ticket: ticketB,
    });
    expect(result.ok).toBe(false);
    expect(result.createRow).toBe(false);
  });

  it("G. existing Remote Support authorization remains unchanged", () => {
    expect(canRemoteSupport("support_admin")).toBe(true);
    expect(canRemoteSupport("super_admin")).toBe(true);
    expect(canRemoteSupport("operations_admin")).toBe(false);
    expect(canRemoteSupport("field_agent")).toBe(false);
    expect(canRemoteSupport("finance_admin")).toBe(false);

    const start = startFn(sql154);
    expect(start).toContain("waka_can_remote_support");
    expect(start).toContain("device_not_found");
    expect(start).toContain("device_shop_mismatch");
    expect(start).toContain("_remote_support_device_is_eligible");
    expect(start).toContain("request_exists");
    expect(start).toContain("auth.uid ()");
    expect(start).toContain("security definer");
    expect(start).toContain("set search_path = public");
    expect(start).not.toContain("p_technician");
  });
});

describe("RS-CI-0.2 SQL contract", () => {
  it("checks ticket existence and shop_id before insert", () => {
    const start = startFn(sql154);
    const ticketCheck = start.indexOf("if p_support_request_id is not null");
    const insert = start.indexOf("insert into public.remote_support_requests");
    expect(ticketCheck).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(ticketCheck);
    expect(start).toContain("support_request_not_found");
    expect(start).toContain("support_request_shop_mismatch");
    expect(start).toContain("from public.support_requests sr");
    expect(start).toContain("v_ticket_shop is distinct from p_shop_id");
  });

  it("does not require ticket device_fingerprint to match the POS", () => {
    const start = startFn(sql154);
    expect(start).not.toContain("sr.device_fingerprint");
    expect(start).not.toMatch(/support_requests sr[\s\S]{0,200}device_fingerprint/);
  });

  it("does not change customer approval or grant logic", () => {
    expect(sql154).not.toContain("remote_support_customer_approve");
    expect(sql154).not.toContain("remote_support_grant_assert");
    expect(sql154).not.toContain("create table");
    expect(sql154).not.toContain("alter table public.support_requests");
    expect(sql154).not.toContain("alter table public.shop_devices");
  });

  it("leaves 152 start function historically unbound so 154 is the additive fix", () => {
    const start152 = startFn(sql152);
    expect(start152).toContain("p_support_request_id");
    expect(start152).not.toContain("support_request_shop_mismatch");
    expect(start152).not.toContain("from public.support_requests");
  });
});
