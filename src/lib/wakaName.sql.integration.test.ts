import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asMerchant,
  createMerchantSqlHarness,
} from "../test/sqlIntegration/merchantPgHarness";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

/**
 * WHY THE CLIENT MUST NEVER HAND A PROVIDER NAME TO THE BOOTSTRAP.
 *
 * This file is the database half of the name-authority work. It exists to pin the property that
 * forces the design in `src/lib/nameReview.ts`, and the property that keeps a confirmed name safe
 * once it is there.
 *
 * The hardening migration's upsert is
 *     set full_name = coalesce (nullif (trim (p_full_name), ''), public.profiles.full_name)
 * which reads as "fill only when empty" and is NOT: `nullif(...)` is non-null whenever a name is
 * supplied, so `coalesce` returns it. A non-empty incoming name always WINS. The first test below
 * demonstrates that against the real function body, because it is the entire reason a raw Google
 * name may not be passed to `bootstrap_owner_workspace`, `repair_owner_workspace` or the bundle
 * self-heal.
 *
 * No migration is required for any of this: the guarantee is that we stop SENDING provider names,
 * and that a confirmed name is carried by the client instead.
 */

const T = 120_000;

let exec: SqlExec;
let districtKampala: string;

async function newUser(slug: string, metadata: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${slug}-${id.slice(0, 6)}@merchant.test`,
    JSON.stringify(metadata),
  ]);
  return id;
}

/** `bootstrap_owner_workspace` as the client calls it: with a name, or with none at all. */
async function bootstrap(userId: string, orgName: string, fullName: string | null): Promise<void> {
  await asMerchant(exec, userId, async () =>
    exec.query(`SELECT * FROM public.bootstrap_owner_workspace($1::text, 'kiosk_duka', $2::text)`, [
      orgName,
      fullName,
    ]),
  );
}

async function saveBundle(userId: string, shopName: string): Promise<Record<string, unknown>> {
  const r = await asMerchant(exec, userId, async () =>
    exec.query<{ result: Record<string, unknown> }>(
      `SELECT public.save_owner_business_profile_bundle($1::text, 'kiosk_duka', $2::uuid, $3::text, 'UGX') AS result`,
      [shopName, districtKampala, "+256772" + String(Math.floor(100000 + Math.random() * 899999))],
    ),
  );
  return r.rows[0]!.result;
}

async function profileName(userId: string): Promise<string | null> {
  const r = await exec.query<{ full_name: string | null }>(
    `SELECT full_name FROM public.profiles WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.full_name ?? null;
}

async function profileRowExists(userId: string): Promise<boolean> {
  const r = await exec.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.profiles WHERE id = $1`,
    [userId],
  );
  return Number(r.rows[0]!.n) > 0;
}

/**
 * The exact statement `confirmWakaName` sends: `supabase.from("profiles").upsert({id, full_name},
 * {onConflict:"id"})`, which PostgREST compiles to this. `wakaName.test.ts` asserts the client
 * really does use that upsert, so this mirror cannot drift from the code it stands for.
 */
async function confirmNameWrite(userId: string, fullName: string): Promise<void> {
  await asMerchant(exec, userId, async () =>
    exec.query(
      `INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
      [userId, fullName],
    ),
  );
}

/** `declareMerchantIntent`'s metadata merge, for a Google merchant who has just confirmed. */
async function declareIntent(userId: string, shopName: string, fullName: string): Promise<void> {
  await exec.query(
    `UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || $2::jsonb WHERE id = $1`,
    [
      userId,
      JSON.stringify({
        pos_role: "owner",
        business_name: shopName,
        organization_name: shopName,
        shop_display_name: shopName,
        full_name: fullName,
        waka_full_name: fullName,
        waka_name_confirmed_at: new Date().toISOString(),
      }),
    ],
  );
}

beforeAll(async () => {
  exec = await createMerchantSqlHarness();
  districtKampala = crypto.randomUUID();
  await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtKampala]);
}, T);

afterAll(async () => {
  await exec?.close();
});

describe("the hazard that makes provider isolation mandatory", () => {
  it("C. a later bootstrap carrying another name REPLACES a name the merchant already has", async () => {
    // The exact John -> Jonathan regression. Reproduced against the real function body so that
    // nobody re-introduces the pattern on the assumption it only fills empty values.
    const uid = await newUser("hazard", { name: "John Smith" });
    await bootstrap(uid, "Hazard Shop", "John Smith");
    expect(await profileName(uid)).toBe("John Smith");

    // The merchant changes their WAKA name.
    await exec.query(`UPDATE public.profiles SET full_name = 'Jonathan Smith' WHERE id = $1`, [uid]);
    expect(await profileName(uid)).toBe("Jonathan Smith");

    // A repair login passes Google's CURRENT name — which is why the client must pass a confirmed
    // name or nothing at all.
    await bootstrap(uid, "Hazard Shop", "John Smith");
    expect(await profileName(uid)).toBe("John Smith");
  });

  it("…while a NULL/blank incoming name never blanks or changes the stored one", async () => {
    // The safe half of the same expression, and the behaviour the client now relies on when it
    // passes nothing for a merchant who has not confirmed a name.
    const uid = await newUser("noblank", { name: "John Smith" });
    await bootstrap(uid, "No Blank Shop", "John Smith");
    await exec.query(`UPDATE public.profiles SET full_name = 'Jonathan Smith' WHERE id = $1`, [uid]);

    await bootstrap(uid, "No Blank Shop", null);
    expect(await profileName(uid)).toBe("Jonathan Smith");
    await bootstrap(uid, "No Blank Shop", "   ");
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });
});

describe("a confirmed name reaches the profile and survives the rest of onboarding", () => {
  it("the confirmed name is what provisioning writes", async () => {
    const uid = await newUser("confirmed", { name: "John Smith" });
    // What the client now passes: the person's CONFIRMED choice, not Google's suggestion.
    await bootstrap(uid, "Confirmed Shop", "Jonathan Smith");
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });

  it("the platform's own behaviour is unchanged when the same confirmed name is passed again", async () => {
    // Re-provisioning is normal (repair runs on any login whose workspace is unhealthy). Passing
    // the confirmed name every time is what keeps the result stable.
    const uid = await newUser("stable", { name: "John Smith" });
    await bootstrap(uid, "Stable Shop", "Jonathan Smith");
    await bootstrap(uid, "Stable Shop", "Jonathan Smith");
    await bootstrap(uid, "Stable Shop", "Jonathan Smith");
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });

  it("J. the bundle save keeps a confirmed name — it never takes the shop's name", async () => {
    // `save_owner_business_profile_bundle` fills an EMPTY profile name from `p_shop_name`, which is
    // why the confirm step must land first. Once a name is present, the shop name cannot displace
    // it: this is the branch every real merchant is on.
    const uid = await newUser("shopname", { name: "John Smith" });
    await bootstrap(uid, "Shop Name Shop", "Jonathan Smith");

    const saved = await saveBundle(uid, "Kampala Pharmacy");
    expect(saved.ok).toBe(true);
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });

  it("J. a merchant whose name is confirmed before the wizard keeps it through the whole save", async () => {
    // The real ordering once the review is mandatory: confirm -> provision -> save bundle.
    const uid = await newUser("order", { name: "John Smith" });
    await bootstrap(uid, "Order Shop", "Jonathan Smith");
    expect((await saveBundle(uid, "Mega Store")).ok).toBe(true);
    expect(await profileName(uid)).toBe("Jonathan Smith");

    // A later repair login still cannot move it.
    await bootstrap(uid, "Order Shop", "Jonathan Smith");
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });

  /**
   * THE EXACT FAILURE, END TO END. A brand-new Google merchant confirms a name while no `profiles`
   * row exists yet, then completes onboarding WITHOUT a page reload — so no bootstrap ever runs
   * before the wizard's save.
   *
   * Before the confirmation wrote the row itself, this sequence ended with
   * `profiles.full_name = "Kampala Pharmacy"`: the bundle RPC's INSERT branch seeds the person's
   * name from `p_shop_name`, and because that same call also creates everything
   * `owner_workspace_health()` checks, `repair_owner_workspace` short-circuits from then on and
   * nothing ever corrected it.
   */
  it("REPRO. confirm -> no reload -> onboarding save keeps the confirmed name, never the shop's", async () => {
    const uid = await newUser("noreload", { name: "John Smith", picture: "https://x/y.png" });

    // 1. The name review. No profiles row exists, so this is the INSERT half of the upsert.
    expect(await profileRowExists(uid)).toBe(false);
    await confirmNameWrite(uid, "Jonathan Smith");
    expect(await profileRowExists(uid)).toBe(true);
    expect(await profileName(uid)).toBe("Jonathan Smith");

    // 2. Declaring merchant intent writes metadata only — no bootstrap, no reload.
    await declareIntent(uid, "Kampala Pharmacy", "Jonathan Smith");

    // 3. The onboarding wizard's save, which is what creates the workspace.
    const saved = await saveBundle(uid, "Kampala Pharmacy");
    expect(saved.ok).toBe(true);

    // 4. The person's name is STILL the one they confirmed.
    expect(await profileName(uid)).toBe("Jonathan Smith");
    expect(await profileName(uid)).not.toBe("Kampala Pharmacy");
  });

  it("REPRO variant: a later Settings save cannot displace the confirmed name", async () => {
    const uid = await newUser("rename", { name: "John Smith" });
    await confirmNameWrite(uid, "Jonathan Smith");
    await declareIntent(uid, "Kampala Pharmacy", "Jonathan Smith");
    expect((await saveBundle(uid, "Kampala Pharmacy")).ok).toBe(true);

    // Once the profile is complete the RPC locks it — that is its documented contract, not a
    // regression. What matters here is that the refusal changes nothing either.
    const second = await saveBundle(uid, "Mega Store");
    expect(second).toMatchObject({ ok: false, error: "profile_locked" });
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });

  it("an existing profile row keeps the confirmed name through the save", async () => {
    const uid = await newUser("existing", { name: "John Smith" });
    await exec.query(`INSERT INTO public.profiles (id, full_name) VALUES ($1, 'Old Name')`, [uid]);

    await confirmNameWrite(uid, "Jonathan Smith");
    expect(await profileName(uid)).toBe("Jonathan Smith");

    await declareIntent(uid, "Kampala Pharmacy", "Jonathan Smith");
    expect((await saveBundle(uid, "Kampala Pharmacy")).ok).toBe(true);
    expect(await profileName(uid)).toBe("Jonathan Smith");
  });

  it("re-confirming a different name updates the row rather than being ignored", async () => {
    // The upsert's UPDATE half: a person may change their mind, and that is their decision.
    const uid = await newUser("reconfirm", { name: "John Smith" });
    await confirmNameWrite(uid, "Jonathan Smith");
    await confirmNameWrite(uid, "J. Smith");
    expect(await profileName(uid)).toBe("J. Smith");
  });

  it("confirming creates ONLY the profile row — no organization, shop or membership", async () => {
    // The confirmation must not become a second provisioning path.
    const uid = await newUser("onlyprofile", { name: "John Smith" });
    await confirmNameWrite(uid, "Jonathan Smith");

    const counts = await exec.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM public.organizations o WHERE o.created_by = $1) AS orgs,
         (SELECT count(*) FROM public.shops s JOIN public.organization_members om
            ON om.organization_id = s.organization_id WHERE om.user_id = $1) AS shops,
         (SELECT count(*) FROM public.shop_members sm WHERE sm.user_id = $1) AS memberships`,
      [uid],
    );
    expect(Object.fromEntries(Object.entries(counts.rows[0]!).map(([k, v]) => [k, Number(v)]))).toEqual({
      orgs: 0,
      shops: 0,
      memberships: 0,
    });
  });

  it("I. an unconfirmed merchant is provisioned with no name, not with the shop's", async () => {
    // What the client passes when nobody has confirmed anything yet: nothing. The bootstrap does
    // not substitute the organization or shop name for the person's — an empty profile name is a
    // state the review fills, not one to guess at.
    const uid = await newUser("unconfirmed", { name: "John Smith" });
    await bootstrap(uid, "Kampala Pharmacy", null);
    expect(await profileName(uid)).toBeNull();
  });
});
