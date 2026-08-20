import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("complete Remote Support ticket flow wiring", () => {
  const inbox = readFileSync(join(ROOT, "src/components/internal-admin/v2/pages/AdminSupportPage.tsx"), "utf8");
  const ticketConnect = readFileSync(join(ROOT, "src/components/remote-support/RemoteSupportTicketConnect.tsx"), "utf8");
  const connect = readFileSync(join(ROOT, "src/components/remote-support/RemoteSupportConnectControl.tsx"), "utf8");
  const listener = readFileSync(join(ROOT, "src/hooks/useRemoteSupportRequestListener.ts"), "utf8");
  const host = readFileSync(join(ROOT, "src/components/layout/AppShell.tsx"), "utf8");
  const sql154 = readFileSync(join(ROOT, "supabase/migrations/154_remote_support_ticket_shop_binding.sql"), "utf8");
  const settings = readFileSync(join(ROOT, "src/pages/SettingsHubPage.tsx"), "utf8");
  const supportPage = readFileSync(join(ROOT, "src/pages/SupportPage.tsx"), "utf8");
  const statusCard = readFileSync(join(ROOT, "src/components/remote-support/RemoteSupportStatusCard.tsx"), "utf8");

  it("admin inbox offers Connect Remotely from the ticket", () => {
    expect(inbox).toContain("RemoteSupportTicketConnect");
    expect(inbox).toContain("canRemoteSupport");
    expect(ticketConnect).toContain("supportRequestId={ticket.id}");
    expect(ticketConnect).toContain("resolveTicketShopDevice");
  });

  it("technician start passes supportRequestId through the existing RPC", () => {
    expect(connect).toContain("ticketRemoteSupportPayload");
    expect(connect).toContain("requestRemoteSupport");
    expect(connect).toContain("supportRequestId");
    expect(connect).not.toContain("grant_jti");
    expect(connect).not.toContain("rustdesk");
  });

  it("customer Allow still starts the existing native transport boundary", () => {
    expect(listener).toContain("approveRemoteSupport");
    expect(listener).toContain("startAuthorizedTransport");
    expect(listener).toContain("endRemoteSupport");
    expect(listener).toContain("stopTransport");
    expect(host).toContain("RemoteSupportHost");
    expect(host).toContain("PosNeedHelpHost");
  });

  it("keeps migration 154 shop-binding as the server invariant", () => {
    expect(sql154).toContain("support_request_shop_mismatch");
    expect(sql154).toContain("p_support_request_id is not null");
  });

  it("Settings/Support Remote Assistance card opens Need Help and does not start a session", () => {
    expect(settings).toContain("RemoteSupportStatusCard");
    expect(supportPage).toContain("RemoteSupportStatusCard");
    expect(statusCard).toContain("openPosNeedHelpForm");
    expect(statusCard).not.toContain("requestRemoteSupport");
    expect(statusCard).not.toContain("startAuthorizedTransport");
    expect(statusCard).not.toContain("rustdesk");
    expect(statusCard).not.toContain("WAKA_RUSTDESK");
  });
});
