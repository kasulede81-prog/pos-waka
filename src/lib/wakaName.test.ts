import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The write that makes a name the person's own, plus the wiring that keeps a provider name out of
 * every path that can reach `profiles.full_name`.
 *
 * The database half of this — that a non-empty incoming name always wins the bootstrap upsert — is
 * pinned in `wakaName.sql.integration.test.ts`. This file covers the client: what confirmation
 * writes, and that the four provisioning call sites and four display sites go through the
 * name-authority helpers rather than reading `user_metadata.full_name` directly.
 */

const getUser = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
const profileUpsert = vi.hoisted(() => vi.fn());
/** Present only so a test can prove it is NOT used — an UPDATE cannot create the row. */
const profileUpdate = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getUser, updateUser },
    from: () => ({ upsert: profileUpsert, update: profileUpdate }),
  },
}));

profileUpsert.mockImplementation(async () => ({ error: null }));

import { confirmWakaName } from "./wakaName";
import { WAKA_FULL_NAME_KEY, WAKA_NAME_CONFIRMED_AT_KEY } from "./nameReview";

const GOOGLE_USER = {
  id: "u1",
  email: "john@example.test",
  user_metadata: {
    name: "John Smith",
    full_name: "John Smith",
    pos_role: "owner",
    business_name: "Kampala Pharmacy",
  },
};

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: GOOGLE_USER } });
  updateUser.mockResolvedValue({ error: null });
  profileUpsert.mockImplementation(async () => ({ error: null }));
});

describe("confirming a WAKA name", () => {
  it("A. stores the confirmed name under our own keys, and in the profile", async () => {
    const result = await confirmWakaName({ fullName: "John Smith" });
    expect(result).toMatchObject({ ok: true, fullName: "John Smith" });

    const sent = updateUser.mock.calls[0]![0].data as Record<string, unknown>;
    expect(sent.full_name).toBe("John Smith");
    expect(sent[WAKA_FULL_NAME_KEY]).toBe("John Smith");
    expect(typeof sent[WAKA_NAME_CONFIRMED_AT_KEY]).toBe("string");
    expect(String(sent[WAKA_NAME_CONFIRMED_AT_KEY]).length).toBeGreaterThan(0);

    expect(profileUpsert).toHaveBeenCalledWith({ id: "u1", full_name: "John Smith" }, { onConflict: "id" });
  });

  /**
   * THE REGRESSION THIS FIX EXISTS FOR. A brand-new Google merchant confirms their name before any
   * workspace exists, so there is no `profiles` row yet. An UPDATE would silently affect zero rows;
   * the merchant would then complete onboarding without reloading, the wizard's
   * `save_owner_business_profile_bundle` call would CREATE the row, and its INSERT branch seeds
   * `full_name` from the SHOP name — leaving the shop's name as the person's, permanently, because
   * that same call also makes `owner_workspace_health()` report ok and `repair_owner_workspace`
   * then short-circuits forever.
   *
   * `wakaName.sql.integration.test.ts` replays that whole sequence against the real RPC bodies;
   * this asserts the client really sends the upsert it mirrors.
   */
  it("CREATES the row when it does not exist — upsert, never update", async () => {
    await confirmWakaName({ fullName: "Jonathan Smith" });
    expect(profileUpsert).toHaveBeenCalledTimes(1);
    expect(profileUpdate).not.toHaveBeenCalled();
    // Only these two columns, so the update path cannot blank anything else and the insert path
    // takes the table's own defaults for `role`, `default_currency`, `locale` and timestamps.
    expect(Object.keys(profileUpsert.mock.calls[0]![0] as object).sort()).toEqual(["full_name", "id"]);
    expect(profileUpsert.mock.calls[0]![1]).toEqual({ onConflict: "id" });
  });

  it("confirmation grants no tenancy — it writes the profile row and nothing else", () => {
    // The page must not become a second provisioning path.
    const source = src("src/lib/wakaName.ts");
    expect(source).not.toContain("bootstrap_owner_workspace");
    expect(source).not.toContain("bootstrapOwnerWorkspace");
    expect(source).not.toContain("organization_members");
    expect(source).not.toContain("shop_members");
  });

  it("B. stores the EDITED name, not the provider's suggestion", async () => {
    const result = await confirmWakaName({ fullName: "Jonathan Smith" });
    expect(result).toMatchObject({ ok: true, fullName: "Jonathan Smith" });

    const sent = updateUser.mock.calls[0]![0].data as Record<string, unknown>;
    expect(sent[WAKA_FULL_NAME_KEY]).toBe("Jonathan Smith");
    // Google still says John Smith in the merge source; the confirmed name wins.
    expect(sent.full_name).toBe("Jonathan Smith");
    expect(profileUpsert).toHaveBeenCalledWith({ id: "u1", full_name: "Jonathan Smith" }, { onConflict: "id" });
  });

  it("MERGE, never replace — the account keeps its intent and identity keys", async () => {
    await confirmWakaName({ fullName: "Jonathan Smith" });
    const sent = updateUser.mock.calls[0]![0].data as Record<string, unknown>;
    expect(sent.pos_role).toBe("owner");
    expect(sent.business_name).toBe("Kampala Pharmacy");
    expect(sent.name).toBe("John Smith");
  });

  it("normalizes what it stores", async () => {
    await confirmWakaName({ fullName: "  Jonathan   Smith  " });
    const sent = updateUser.mock.calls[0]![0].data as Record<string, unknown>;
    expect(sent[WAKA_FULL_NAME_KEY]).toBe("Jonathan Smith");
  });

  it("refuses an empty name rather than confirming one", async () => {
    expect(await confirmWakaName({ fullName: "   " })).toEqual({ ok: false, error: "invalid_name" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does not fail the person when only the profile write fails", async () => {
    // The confirmed name is already durable in metadata, and the guarded bootstrap carries it into
    // the profile when the row is created — so a failed profile write must not read as "your name
    // was not saved".
    profileUpsert.mockResolvedValueOnce({ error: { message: "permission denied" } });
    const result = await confirmWakaName({ fullName: "Jonathan Smith" });
    expect(result).toMatchObject({ ok: true, fullName: "Jonathan Smith", profileUpdated: false });
  });

  it("reports a metadata failure as a failure", async () => {
    updateUser.mockResolvedValueOnce({ error: { message: "network" } });
    expect(await confirmWakaName({ fullName: "Jonathan Smith" })).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});

/**
 * PROVIDER ISOLATION. Every path that can write `profiles.full_name` must ask for a CONFIRMED name.
 * If any of these reverts to reading `meta.full_name` / `meta.name`, a Google rename silently
 * replaces a merchant's chosen name on the next login.
 */
describe("C/D. no provisioning path reads the provider's name", () => {
  const SITES: Array<[string, string]> = [
    ["src/hooks/useAuth.ts", "useAuth's post-sign-in bootstrap"],
    ["src/lib/ownerWorkspaceOnSignIn.ts", "the auth-callback bootstrap"],
    ["src/lib/workspaceHealth.ts", "the repair path"],
    ["src/lib/businessProfile.ts", "the bundle self-heal"],
  ];

  for (const [file, label] of SITES) {
    it(`${label} asks for a confirmed name`, () => {
      const source = src(file);
      // The belt: it must use the authority helper…
      expect({ file, uses: source.includes("provisionableWakaName") }).toEqual({ file, uses: true });
      // …and the braces: it must not pass a raw provider name to a bootstrap RPC.
      expect(source).not.toMatch(/fullName:\s*String\(meta\??\.full_name/);
      expect(source).not.toMatch(/p_full_name:\s*String\(meta\??\.full_name/);
      expect(source).not.toMatch(/String\(\s*meta\??\.full_name\s*\?\?\s*meta\??\.name/);
    });
  }

  it("the bundle self-heal no longer invents a name from the e-mail or the literal 'Owner'", () => {
    // "jdoe" and "Owner" are not names anybody chose.
    expect(src("src/lib/businessProfile.ts")).not.toContain('split("@")[0] || "Owner"');
  });
});

/**
 * DISPLAY AUTHORITY. The name shown throughout WAKA must be the confirmed one, and must need no
 * extra request — the session already carries its metadata.
 */
describe("D. display paths read the confirmed name first", () => {
  const DISPLAY_SITES = [
    "src/lib/sessionActor.ts",
    "src/components/layout/AppShell.tsx",
    "src/hooks/useTerminalIdentity.ts",
    "src/components/settings/ShopProfileForm.tsx",
  ];

  for (const file of DISPLAY_SITES) {
    it(`${file} uses displayWakaName`, () => {
      expect(src(file)).toContain("displayWakaName");
    });
  }

  it("and none of them reads full_name straight off the session any more", () => {
    for (const file of DISPLAY_SITES) {
      const source = src(file);
      expect(source).not.toMatch(/user_metadata[^\n]*\)\??\.full_name/);
      expect(source).not.toMatch(/meta\??\.full_name\?\.trim\(\)/);
    }
  });
});

/**
 * NAME INTEGRITY. An omitted owner name is "nothing to say about the name", not "erase it".
 */
describe("I. a missing owner name cannot null an existing profile name", () => {
  it("saveBusinessProfileToCloud omits the key instead of writing null", () => {
    const source = src("src/lib/businessProfile.ts");
    // Anchored to a property position inside the patch object, so the explanatory comment that
    // quotes the old line (mid-sentence) cannot satisfy or defeat this.
    expect(source).not.toMatch(/^\s*full_name:\s*input\.ownerName/m);
    expect(source).toMatch(/if \(ownerName\) profilePatch\.full_name = ownerName;/);
  });

  it("it still writes the name when one IS supplied", () => {
    const source = src("src/lib/businessProfile.ts");
    expect(source).toContain("const ownerName = normalizeNamePart(input.ownerName);");
  });
});

/**
 * EMAIL/PASSWORD is unchanged: /register asks for the name in a field the person fills in, so it is
 * already their own choice and is marked confirmed at signup.
 */
describe("G. the email/password signup path is unchanged", () => {
  it("still writes the typed name, and marks it confirmed so nobody is re-asked", () => {
    const source = src("src/lib/merchantRegistration.ts");
    expect(source).toContain("meta.full_name = input.fullName.trim();");
    expect(source).toContain("meta.waka_full_name = input.fullName.trim();");
    expect(source).toContain("meta.waka_name_confirmed_at = new Date().toISOString();");
  });

  it("does none of that when no name was given", () => {
    // The guard is what keeps the "writes exactly what the classifier reads" key-set assertion
    // true for a signup with no name.
    const source = src("src/lib/merchantRegistration.ts");
    expect(source).toMatch(/if \(input\.fullName\?\.trim\(\)\) \{/);
  });
});
