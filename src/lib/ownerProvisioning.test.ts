import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

/**
 * What happens on the way back from an email confirmation or an OAuth round trip — the moment a
 * brand-new merchant either gets a workspace or silently does not.
 *
 * The defect this pins: `withTimeout(..., undefined)` RESOLVED with `undefined` when the bootstrap
 * hung, so a workspace that was never created looked exactly like one that was, and the callback
 * walked the merchant into the app. A failure now has to be a failure.
 */

const ensure = vi.hoisted(() => vi.fn());
const marker = vi.hoisted(() => vi.fn());
const wizardRequired = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const timeoutMs = vi.hoisted(() => ({ value: 1_000 }));

vi.mock("./ownerWorkspaceOnSignIn", () => ({ ensureOwnerWorkspaceIfNeeded: ensure }));
vi.mock("./firstTimeOwnerDevice", () => ({
  hasFirstTimeOwnerMarker: marker,
  isOnboardingWizardRequiredLocally: wizardRequired,
}));
vi.mock("./ownerOnboarding", () => ({ fetchOwnerOnboardingStatus: status }));
vi.mock("./promiseTimeout", () => ({
  withTimeout: <T,>(promise: Promise<T>, _ms: number, fallback: T) =>
    Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs.value)),
    ]),
}));

import {
  destinationFor,
  PROVISION_FAILED_MESSAGE,
  PROVISION_TIMEOUT_MESSAGE,
  provisionOwnerWorkspace,
} from "./ownerProvisioning";

const session = { user: { id: "owner-1" } } as unknown as Session;

beforeEach(() => {
  ensure.mockReset();
  marker.mockReset();
  wizardRequired.mockReset();
  status.mockReset();
  timeoutMs.value = 1_000;
});

describe("5 & 11. the bootstrap outcome is reported, never assumed", () => {
  it("reports success when the guarded bootstrap succeeds", async () => {
    ensure.mockResolvedValue(undefined);
    await expect(provisionOwnerWorkspace(session)).resolves.toEqual({ ok: true });
  });

  it("a bootstrap that HANGS is a failure, not a silent success", async () => {
    timeoutMs.value = 5;
    ensure.mockImplementation(() => new Promise(() => undefined));

    const outcome = await provisionOwnerWorkspace(session);
    expect(outcome).toEqual({ ok: false, message: PROVISION_TIMEOUT_MESSAGE });
  });

  it("a thrown bootstrap failure is reported, and the raw RPC message is not leaked", async () => {
    ensure.mockRejectedValue(new Error('duplicate key value violates unique constraint "shops_pkey"'));

    const outcome = await provisionOwnerWorkspace(session);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toBe(PROVISION_FAILED_MESSAGE);
      expect(outcome.message).not.toContain("shops_pkey");
      expect(outcome.message).not.toContain("duplicate key");
    }
  });

  it("a retry after a failure is safe — the bootstrap is idempotent by design", async () => {
    ensure.mockRejectedValueOnce(new Error("network"));
    expect((await provisionOwnerWorkspace(session)).ok).toBe(false);

    ensure.mockResolvedValueOnce(undefined);
    expect((await provisionOwnerWorkspace(session)).ok).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it("a confirmed merchant who never completed the callback recovers on the next attempt", async () => {
    // Nothing was created the first time; the same call is what repairs it, and it is the ONLY
    // thing that repairs it — which is why the retry must be offered rather than hidden.
    ensure.mockResolvedValue(undefined);
    const first = await provisionOwnerWorkspace(session);
    const second = await provisionOwnerWorkspace(session);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });
});

describe("post-provisioning destination", () => {
  it("a brand-new owner on this device goes to the wizard", async () => {
    marker.mockReturnValue(true);
    const target = await destinationFor({
      userId: "owner-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: false,
      inviteAccepted: false,
      memberOnly: false,
      landing: "/welcome",
    });
    expect(target).toBe("/onboarding");
  });

  it("16. a returning merchant on a SECOND device is not sent through onboarding again", async () => {
    // No marker, no local preferences — the device knows nothing. The server does.
    marker.mockReturnValue(false);
    wizardRequired.mockReturnValue(true);
    status.mockResolvedValue({ complete: true, missing: [] });

    const target = await destinationFor({
      userId: "owner-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: false,
      inviteAccepted: false,
      memberOnly: false,
      landing: "/welcome",
    });
    expect(target).toBe("/");
  });

  it("a merchant the server says is unfinished goes to the wizard", async () => {
    marker.mockReturnValue(false);
    wizardRequired.mockReturnValue(true);
    status.mockResolvedValue({ complete: false, missing: ["phone"] });

    const target = await destinationFor({
      userId: "owner-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: false,
      inviteAccepted: false,
      memberOnly: false,
      landing: "/welcome",
    });
    expect(target).toBe("/onboarding");
  });

  it("when the status RPC fails the device's own answer stands", async () => {
    marker.mockReturnValue(false);
    wizardRequired.mockReturnValue(true);
    status.mockRejectedValue(new Error("offline"));

    const target = await destinationFor({
      userId: "owner-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: false,
      inviteAccepted: false,
      memberOnly: false,
      landing: "/welcome",
    });
    expect(target).toBe("/onboarding");
  });

  it("a member is never routed into merchant onboarding", async () => {
    const target = await destinationFor({
      userId: "member-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: false,
      inviteAccepted: false,
      memberOnly: true,
      landing: "/member",
    });
    expect(target).toBe("/member");
    expect(status).not.toHaveBeenCalled();
  });

  it("a staff invitee lands on the invite, and never gets an owner workspace", async () => {
    const accepted = await destinationFor({
      userId: "staff-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: true,
      inviteAccepted: true,
      memberOnly: false,
      landing: "/welcome",
    });
    expect(accepted).toBe("/");

    const pending = await destinationFor({
      userId: "staff-1",
      pendingJoinPath: null,
      skipOwnerBootstrap: true,
      inviteAccepted: false,
      memberOnly: false,
      landing: "/welcome",
    });
    expect(pending).toBe("/staff/accept");
  });

  it("a pending loyalty join wins over everything — it is the most specific reason we have", async () => {
    const target = await destinationFor({
      userId: "member-1",
      pendingJoinPath: "/j/WPL2026001",
      skipOwnerBootstrap: false,
      inviteAccepted: false,
      memberOnly: true,
      landing: "/member",
    });
    expect(target).toBe("/j/WPL2026001");
  });
});
