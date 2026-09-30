import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wizard save, WITH a cloud configured — the mode every real merchant is in.
 *
 * The failure this file exists for: the old implementation wrote the LOCAL "onboarding complete"
 * flags first and then skipped or failed the cloud save, leaving a device that believed setup was
 * finished and a server that had no business profile. Everything below asserts the same two
 * things from different angles — the cloud is written first, and a save that did not happen never
 * marks the device complete.
 */

const rpc = vi.hoisted(() => vi.fn());
const finalize = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
  },
}));

vi.mock("./businessProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./businessProfile")>();
  return {
    ...actual,
    saveOwnerBusinessProfileBundleRpc: rpc,
    finalizeOwnerOnboardingAfterCloudSave: finalize,
  };
});

import { OnboardingIncompleteError, persistOnboardingChoices } from "./shopOnboardingPersist";
import { usePosStore } from "../store/usePosStore";

const INPUT = {
  shopName: "Kampala Pharmacy",
  businessType: "pharmacy" as const,
  sellingStyle: "piece" as const,
  phone: "0772123456",
  districtId: "district-kla",
  gpsSkipped: true,
};

/** True when the device currently claims the wizard is finished. */
const locallyComplete = () => usePosStore.getState().preferences.onboardingWizardDone === true;

/** Await a save that MUST be refused, and hand back the refusal. */
async function refusalFrom(promise: Promise<unknown>): Promise<OnboardingIncompleteError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof OnboardingIncompleteError) return e;
    throw e;
  }
  throw new Error("expected the onboarding save to be refused, but it resolved");
}

beforeEach(() => {
  rpc.mockReset();
  finalize.mockReset();
  (globalThis as { window?: { dispatchEvent: (event: Event) => void } }).window = {
    dispatchEvent: () => undefined,
  };
  usePosStore.setState({
    preferences: {
      ...usePosStore.getState().preferences,
      shopDisplayName: "My Shop",
      shopPhoneE164: "",
      onboardingDone: false,
      onboardingWizardDone: false,
      schemaVersion: 0,
    },
  });
});

describe("7. a missing phone stops the step instead of silently skipping the save", () => {
  it("refuses, names the phone, and marks nothing complete", async () => {
    await expect(persistOnboardingChoices({ ...INPUT, phone: "" })).rejects.toBeInstanceOf(
      OnboardingIncompleteError,
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(locallyComplete()).toBe(false);
  });

  it("the message tells the merchant what to do, and is not a machine code", async () => {
    const err = await refusalFrom(persistOnboardingChoices({ ...INPUT, phone: "not-a-number" }));
    expect(err).toBeInstanceOf(OnboardingIncompleteError);
    expect(err.message).toMatch(/phone number and district/i);
    expect(err.missing).toContain("phone");
    expect(err.message).not.toMatch(/[a-z]+_[a-z_]+/);
  });
});

describe("8. a missing district stops the step", () => {
  it("refuses, names the district, and marks nothing complete", async () => {
    const err = await refusalFrom(persistOnboardingChoices({ ...INPUT, districtId: "" }));
    expect(err).toBeInstanceOf(OnboardingIncompleteError);
    expect(err.missing).toContain("district");
    expect(rpc).not.toHaveBeenCalled();
    expect(locallyComplete()).toBe(false);
  });
});

describe("18. a failed cloud save can never produce local 'complete'", () => {
  it("does not mark the wizard done when the RPC refuses", async () => {
    rpc.mockResolvedValue({ ok: false, message: "not_authorized_for_workspace" });

    await expect(persistOnboardingChoices(INPUT)).rejects.toBeInstanceOf(OnboardingIncompleteError);
    expect(locallyComplete()).toBe(false);
  });

  it("shows a human sentence, never the server's code", async () => {
    rpc.mockResolvedValue({ ok: false, message: "not_authorized_for_workspace" });

    const err = await refusalFrom(persistOnboardingChoices(INPUT));
    expect(err.message).not.toContain("not_authorized_for_workspace");
    expect(err.message).toMatch(/not set up to run a shop|try again|contact support/i);
  });

  it("maps a raw database message too — no 'profiles_phone_e164' ever reaches a merchant", async () => {
    rpc.mockResolvedValue({
      ok: false,
      message: 'duplicate key value violates unique constraint "profiles_phone_e164_key"',
    });

    const err = await refusalFrom(persistOnboardingChoices(INPUT));
    expect(err.message).not.toContain("profiles_phone_e164");
    expect(err.message).toMatch(/already on another Waka account/i);
  });

  it("a thrown transport error is still reported and still marks nothing complete", async () => {
    rpc.mockRejectedValue(new Error("Failed to fetch"));
    await expect(persistOnboardingChoices(INPUT)).rejects.toBeTruthy();
    expect(locallyComplete()).toBe(false);
  });
});

describe("the cloud is written BEFORE the device says it is finished", () => {
  it("on success, the local flags flip only after the save is accepted", async () => {
    let completeAtRpcTime: boolean | null = null;
    rpc.mockImplementation(async () => {
      completeAtRpcTime = locallyComplete();
      return { ok: true, shopId: "shop-1", organizationId: "org-1" };
    });

    await persistOnboardingChoices(INPUT);

    expect(completeAtRpcTime).toBe(false); // cloud first…
    expect(locallyComplete()).toBe(true); // …device second
    expect(finalize).toHaveBeenCalledWith("owner-1");
  });

  it("sends the business type the merchant chose, not a default", async () => {
    rpc.mockResolvedValue({ ok: true });
    await persistOnboardingChoices({ ...INPUT, businessType: "hospitality" });
    expect(rpc.mock.calls[0]![0]).toMatchObject({ businessType: "hospitality" });
  });

  it("normalises the phone before it is stored or sent", async () => {
    rpc.mockResolvedValue({ ok: true });
    await persistOnboardingChoices({ ...INPUT, phone: "0772 123 456" });
    expect(rpc.mock.calls[0]![0]).toMatchObject({ phoneE164: "+256772123456" });
  });
});
