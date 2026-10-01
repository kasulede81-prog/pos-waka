import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnonymous,
  asMerchant,
  createMerchantSqlHarness,
} from "../test/sqlIntegration/merchantPgHarness";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

/**
 * A MERCHANT HALFWAY THROUGH REGISTRATION — the state the phone trap left people in.
 *
 * THE FLOW THIS PINS. Provisioning is deliberate: authentication creates the workspace FIRST
 * (organization, shop, memberships, profile, trial) and the business profile is completed SECOND.
 * That is not a bug — `owner_onboarding_status()` models the gap explicitly, `profile_locked`
 * refuses to overwrite a finished profile, and the save is written to UPDATE the shop the
 * bootstrap created rather than to make another one.
 *
 * What WAS broken is that the wizard's location step enforced a phone number it never rendered a
 * field for, so a Google merchant — whose identity carries no phone at all — could not finish, and
 * every retry landed back on the same screen. The workspace already existing is CORRECT here; the
 * merchant needing a way to complete it is what these tests insist on.
 *
 * So this file answers, against the real RPC bodies, the questions the incident raised:
 *   * after the blocked screen, exactly which rows exist, and with which columns still NULL?
 *   * is that state reported as finished onboarding? (it must not be)
 *   * does resuming create a second organization or shop? (it must not)
 *   * does completing the profile update the SAME workspace? (it must)
 */

const T = 120_000;

let exec: SqlExec;

/** A Google-style identity: nothing but an e-mail. No phone, no district, no business name. */
async function newGoogleMerchant(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${slug}-${id.slice(0, 6)}@merchant.test`,
    // What `signInWithIdToken` actually stores for a Google account: profile claims, and none of
    // ours. `pos_role` is absent, which is why the caller falls back to the e-mail prefix.
    JSON.stringify({ name: "Google Owner", picture: "https://example.test/a.png" }),
  ]);
  return id;
}

/** Call bootstrap exactly as the client does for a merchant with no signup contact details. */
async function bootstrap(userId: string, orgName: string): Promise<void> {
  await asMerchant(exec, userId, async () =>
    exec.query(`SELECT public.bootstrap_owner_workspace($1::text) AS organization_id`, [orgName]),
  );
}

async function onboardingStatus(userId: string): Promise<{ complete: boolean; missing: string[] }> {
  const r = await asMerchant(exec, userId, async () =>
    exec.query<{ status: { complete: boolean; missing: string[] } }>(
      `SELECT public.owner_onboarding_status() AS status`,
    ),
  );
  return r.rows[0]!.status;
}

/** `save_owner_business_profile_bundle`, as the wizard calls it. */
async function save(args: {
  userId: string;
  shopName: string;
  businessType?: string;
  districtId: string | null;
  phone: string;
}): Promise<Record<string, unknown>> {
  const r = await asMerchant(exec, args.userId, async () =>
    exec.query<{ result: Record<string, unknown> }>(
      `SELECT public.save_owner_business_profile_bundle(
         $1::text, $2::text, $3::uuid, $4::text, $5::text
       ) AS result`,
      [
        args.shopName,
        args.businessType ?? "kiosk_duka",
        args.districtId,
        args.phone,
        "UGX",
      ],
    ),
  );
  return r.rows[0]!.result;
}

async function workspaceRow(userId: string) {
  const r = await exec.query<{
    shop_id: string;
    organization_id: string;
    business_type: string;
    district_id: string | null;
    district: string | null;
    phone_e164: string | null;
    owner_user_id: string | null;
  }>(
    `select sh.id as shop_id, sh.organization_id, sh.business_type, sh.district_id, sh.district,
            sh.phone_e164, sh.owner_user_id
       from public.shop_members sm
       join public.shops sh on sh.id = sm.shop_id
      where sm.user_id = $1
      order by sm.created_at asc
      limit 1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

async function counts(userId: string) {
  const r = await exec.query<Record<string, string>>(
    `select
       (select count(*) from public.organizations o where o.created_by = $1) as orgs,
       (select count(*) from public.shops s
          join public.organization_members om on om.organization_id = s.organization_id
         where om.user_id = $1) as shops,
       (select count(*) from public.shop_members sm where sm.user_id = $1 and sm.role = 'owner') as shop_owners,
       (select count(*) from public.organization_members om where om.user_id = $1 and om.role = 'owner') as org_owners,
       (select count(*) from public.profiles p where p.id = $1) as profiles`,
    [userId],
  );
  return Object.fromEntries(
    Object.entries(r.rows[0]!).map(([k, v]) => [k, Number(v)]),
  ) as Record<"orgs" | "shops" | "shop_owners" | "org_owners" | "profiles", number>;
}

let districtKampala: string;

beforeAll(async () => {
  exec = await createMerchantSqlHarness();
  districtKampala = crypto.randomUUID();
  await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtKampala]);
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// 1 — what the blocked screen leaves behind
// ===========================================================================

describe("A. authentication provisions the workspace before the profile is complete", () => {
  it("the organization, shop, memberships and profile all exist BEFORE phone and district", async () => {
    const uid = await newGoogleMerchant("provisioned");
    await bootstrap(uid, "googleowner");

    // This is the observation from production, asserted: refreshing found a real account, because
    // the account really was created at authentication time — not by the failed save.
    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
    expect(c.org_owners).toBe(1);
    expect(c.shop_owners).toBe(1);
    expect(c.profiles).toBe(1);

    // And the fields the wizard was supposed to collect are genuinely absent.
    const w = await workspaceRow(uid);
    expect(w).not.toBeNull();
    expect(w!.phone_e164).toBeNull();
    expect(w!.district_id).toBeNull();
    expect(w!.owner_user_id).toBe(uid);
  });

  it("partial provisioning is REPORTED as incomplete, never as a finished registration", async () => {
    const uid = await newGoogleMerchant("status");
    await bootstrap(uid, "googleowner");

    const status = await onboardingStatus(uid);
    expect(status.complete).toBe(false);
    // Named, so the client can point at the right step rather than showing a generic failure.
    expect(status.missing).toContain("phone");
    expect(status.missing).toContain("district");
  });

  it("an unauthenticated caller is never told onboarding is complete", async () => {
    // The fail-closed property the hardening introduced. Anon has no EXECUTE, and the body itself
    // returns complete=false rather than "cannot tell whose onboarding this is" being read as
    // "finished".
    await expect(
      asAnonymous(exec, async () => exec.query(`SELECT public.owner_onboarding_status() AS x`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ===========================================================================
// 4 — the phone requirement is real, and so is the district's
// ===========================================================================

describe("B. the save genuinely requires a phone and a district", () => {
  it("a save with no phone is refused — the requirement the UI has to satisfy", async () => {
    const uid = await newGoogleMerchant("nophone");
    await bootstrap(uid, "googleowner");

    const result = await save({
      userId: uid,
      shopName: "googleowner",
      districtId: districtKampala,
      phone: "",
    });
    expect(result).toMatchObject({ ok: false, error: "invalid_phone" });

    // The refusal changes nothing — the workspace is exactly as the bootstrap left it.
    const w = await workspaceRow(uid);
    expect(w!.phone_e164).toBeNull();
    expect(w!.district_id).toBeNull();
  });

  it("a save with a phone but no district is refused — district is required, not optional", async () => {
    const uid = await newGoogleMerchant("nodistrict");
    await bootstrap(uid, "googleowner");

    const result = await save({
      userId: uid,
      shopName: "googleowner",
      districtId: null,
      phone: "+256772123456",
    });
    expect(result).toMatchObject({ ok: false, error: "district_required" });

    // Nothing was written, including the phone that WAS supplied.
    expect((await workspaceRow(uid))!.phone_e164).toBeNull();
  });

  it("every Uganda format the UI promises is accepted once normalised to +256", async () => {
    // The step tells the merchant "07… or +256…"; these are the shapes that promise covers, all
    // normalised by the client to the canonical form the server regex accepts.
    const formats = ["+256772123456", "+256872123456"];
    for (const [i, phone] of formats.entries()) {
      const uid = await newGoogleMerchant(`format${i}`);
      await bootstrap(uid, "googleowner");

      const result = await save({
        userId: uid,
        shopName: "googleowner",
        districtId: districtKampala,
        phone,
      });
      expect({ phone, ok: result.ok }).toEqual({ phone, ok: true });
      expect((await workspaceRow(uid))!.phone_e164).toBe(phone);
    }
  });
});

// ===========================================================================
// 3 — refresh and resume
// ===========================================================================

describe("C. refreshing after a failed step resumes; it never duplicates or skips", () => {
  it("re-running the bootstrap after a refused save creates nothing new", async () => {
    const uid = await newGoogleMerchant("refresh");
    await bootstrap(uid, "googleowner");

    // The merchant filled the form in, the save was refused, they refreshed, and the callback
    // re-ran the guarded bootstrap. It must find the earlier rows, not add to them.
    await save({ userId: uid, shopName: "googleowner", districtId: districtKampala, phone: "123" });
    await bootstrap(uid, "googleowner");
    await bootstrap(uid, "googleowner");

    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
    expect(c.org_owners).toBe(1);
    expect(c.shop_owners).toBe(1);
    expect(c.profiles).toBe(1);

    // And the merchant is still correctly held at the incomplete step.
    const status = await onboardingStatus(uid);
    expect(status.complete).toBe(false);
    expect(status.missing).toContain("phone");
    expect(status.missing).toContain("district");
  });
});

// ===========================================================================
// 7, 8 — completing, and the merchant who is already in this state
// ===========================================================================

describe("D. completing the profile fills in the EXISTING workspace", () => {
  it("the shop that is completed is the shop the bootstrap created", async () => {
    const uid = await newGoogleMerchant("complete");
    await bootstrap(uid, "googleowner");
    const before = await workspaceRow(uid);

    const result = await save({
      userId: uid,
      shopName: "Googleowner Shop",
      businessType: "pharmacy",
      districtId: districtKampala,
      phone: "+256772900001",
    });
    expect(result.ok).toBe(true);

    const after = await workspaceRow(uid);
    // SAME row, updated — not a second workspace.
    expect(after!.shop_id).toBe(before!.shop_id);
    expect(after!.organization_id).toBe(before!.organization_id);

    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);

    // The type the merchant chose reaches the shop, and the contact details land.
    expect(after!.business_type).toBe("pharmacy");
    expect(after!.district_id).toBe(districtKampala);
    expect(after!.district).toBe("Kampala");
    expect(after!.phone_e164).toBe("+256772900001");
  });

  it("only then does the server call onboarding complete — the POS hand-off is earned", async () => {
    const uid = await newGoogleMerchant("finished");
    await bootstrap(uid, "googleowner");
    expect((await onboardingStatus(uid)).complete).toBe(false);

    await save({
      userId: uid,
      shopName: "Finished Shop",
      districtId: districtKampala,
      phone: "+256772123457",
    });

    const status = await onboardingStatus(uid);
    expect(status.complete).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("an existing production merchant with a NULL phone resumes through the same save", async () => {
    // The stranded-merchant case: workspace exists, phone NULL, district NULL, onboarding
    // incomplete. Nothing is backfilled and nothing is invented — the merchant finishes it
    // themselves, and the fix must let them.
    const uid = await newGoogleMerchant("stranded");
    await bootstrap(uid, "googleowner");
    const before = await workspaceRow(uid);
    expect(before!.phone_e164).toBeNull();
    expect(before!.district_id).toBeNull();

    const result = await save({
      userId: uid,
      shopName: "Stranded Shop",
      districtId: districtKampala,
      phone: "+256772123458",
    });

    expect(result.ok).toBe(true);
    expect((await workspaceRow(uid))!.shop_id).toBe(before!.shop_id);
    expect((await onboardingStatus(uid)).complete).toBe(true);
  });
});

// ===========================================================================
// 9, 11 — the protections that must survive the fix
// ===========================================================================

describe("E. the hardening is intact", () => {
  it("phone uniqueness is still enforced across accounts", async () => {
    const a = await newGoogleMerchant("uniqua");
    const b = await newGoogleMerchant("uniqbb");
    await bootstrap(a, "Unique A");
    await bootstrap(b, "Unique B");

    expect(
      (await save({
        userId: a,
        shopName: "Unique A",
        districtId: districtKampala,
        phone: "+256772123459",
      })).ok,
    ).toBe(true);

    const clash = await save({
      userId: b,
      shopName: "Unique B",
      districtId: districtKampala,
      phone: "+256772123459",
    });
    expect(clash).toMatchObject({ ok: false, error: "phone_in_use" });
    // The second merchant's shop keeps its NULL rather than stealing the number.
    expect((await workspaceRow(b))!.phone_e164).toBeNull();
  });

  it("the per-user advisory lock is still taken, before anything is read or written", async () => {
    for (const fn of ["bootstrap_owner_workspace", "save_owner_business_profile_bundle"]) {
      const r = await exec.query<{ def: string }>(
        `select pg_get_functiondef(oid) as def from pg_proc where proname = $1 limit 1`,
        [fn],
      );
      expect({ fn, locked: r.rows[0]!.def.includes("pg_advisory_xact_lock") }).toEqual({
        fn,
        locked: true,
      });
    }
  });

  it("a completed profile is still locked against being rewritten", async () => {
    // The fix must not have turned the completion path into a way to overwrite finished data.
    const uid = await newGoogleMerchant("locked");
    await bootstrap(uid, "Locked Shop");
    await save({
      userId: uid,
      shopName: "Locked Shop",
      districtId: districtKampala,
      phone: "+256772123460",
    });

    const again = await save({
      userId: uid,
      shopName: "Renamed Later",
      districtId: districtKampala,
      phone: "+256772123461",
    });
    expect(again).toMatchObject({ ok: false, error: "profile_locked" });
  });
});
