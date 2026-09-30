import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asAnonymous,
  asMerchant,
  createMerchantSqlHarness,
} from "../test/sqlIntegration/merchantPgHarness";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

/**
 * MERCHANT REGISTRATION — the database guarantees.
 *
 * A merchant's browser can be interrupted at any moment: the tab closes, the network dies, the
 * callback times out. These tests pin what must hold anyway — the workspace is created once and
 * only once, for the person who asked for it, and nobody else can ask for theirs.
 *
 * The functions under test are the REAL bodies: the hardening migration is generated from the live
 * definitions in the migration tree and applied here unmodified.
 */

const T = 120_000;

let exec: SqlExec;

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260930320000_merchant_registration_hardening.sql",
);

async function newUser(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await exec.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${slug}-${id.slice(0, 6)}@merchant.test`,
    JSON.stringify({ pos_role: "owner", business_name: "Registered Shop" }),
  ]);
  return id;
}

/** Call bootstrap exactly as the client does — as the merchant themselves. */
async function bootstrap(userId: string, orgName = "Registered Shop"): Promise<void> {
  await asMerchant(exec, userId, async () =>
    exec.query(`SELECT public.bootstrap_owner_workspace($1::text) AS organization_id`, [orgName]),
  );
}

async function counts(userId: string) {
  const r = await exec.query<{ orgs: string; shops: string; owners: string; profiles: string; subs: string }>(
    `select
       (select count(*) from public.organizations o where o.created_by = $1) as orgs,
       (select count(*) from public.shops s
          join public.organization_members om on om.organization_id = s.organization_id
         where om.user_id = $1) as shops,
       (select count(*) from public.shop_members sm
         where sm.user_id = $1 and sm.role = 'owner') as owners,
       (select count(*) from public.profiles p where p.id = $1) as profiles,
       (select count(*) from public.subscriptions sub
          join public.organization_members om on om.organization_id = sub.organization_id
         where om.user_id = $1) as subs`,
    [userId],
  );
  return Object.fromEntries(
    Object.entries(r.rows[0]!).map(([k, v]) => [k, Number(v)]),
  ) as Record<"orgs" | "shops" | "owners" | "profiles" | "subs", number>;
}

beforeAll(async () => {
  exec = await createMerchantSqlHarness();
}, T);

afterAll(async () => {
  await exec?.close();
});

// ===========================================================================
// 9, 10 — exactly one workspace
// ===========================================================================

describe("a merchant gets exactly one workspace", () => {
  it("9. bootstrap called twice produces one organization, one shop, one owner membership", async () => {
    const uid = await newUser("twice");

    await bootstrap(uid, "Twice Shop");
    await bootstrap(uid, "Twice Shop");

    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
    expect(c.owners).toBe(1);
    expect(c.profiles).toBe(1);
    expect(c.subs).toBe(1);
  });

  it("9b. a retry with a different display name renames rather than duplicating", async () => {
    const uid = await newUser("rename");

    await bootstrap(uid, "First Name");
    await bootstrap(uid, "Second Name");

    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
  });

  it("9c. a third call after a partial-looking state still yields one of each", async () => {
    const uid = await newUser("thrice");
    await bootstrap(uid, "Once");
    await bootstrap(uid, "Twice");
    await bootstrap(uid, "Thrice");

    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
    expect(c.owners).toBe(1);
  });

  it("10. concurrent callers are serialized by a per-user advisory lock", async () => {
    // This harness is a single connection, so it cannot literally run two transactions at once.
    // What protects production is that the function TAKES the lock, on the caller's own identity,
    // before it reads anything — two callers cannot both hold `pg_advisory_xact_lock` for one key,
    // so the second blocks and then sees the first one's rows. That property is asserted here.
    const def = await functionDef("bootstrap_owner_workspace");
    expect(def).toContain("pg_advisory_xact_lock");
    expect(def).toContain("hashtextextended (v_uid::text, 0)");
  });

  it("10b. the lock is taken before the first row is written", async () => {
    const def = await functionDef("bootstrap_owner_workspace");
    const lockAt = def.indexOf("pg_advisory_xact_lock");
    const firstWriteAt = def.indexOf("insert into public.profiles");
    expect(lockAt).toBeGreaterThan(-1);
    expect(firstWriteAt).toBeGreaterThan(lockAt);
  });

  it("10c. the lock is never keyed on anything the client supplied", async () => {
    const def = await functionDef("bootstrap_owner_workspace");
    expect(def).not.toMatch(/pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*p_/);
  });

  it("10d. the bundle save takes the same lock — it can also create the workspace", async () => {
    expect(await functionDef("save_owner_business_profile_bundle")).toContain("pg_advisory_xact_lock");
  });

  it("a real concurrent pair still yields one workspace", async () => {
    // True concurrency needs two connections. When the suite is pointed at a real Postgres
    // (TEST_DATABASE_URL) the two bootstraps genuinely race; under PGlite they are sequential and
    // this simply asserts the outcome the lock guarantees either way.
    const uid = await newUser("race");
    await Promise.all([bootstrap(uid, "Race Shop"), bootstrap(uid, "Race Shop")]);

    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
    expect(c.owners).toBe(1);
  });
});

async function functionDef(name: string): Promise<string> {
  const r = await exec.query<{ def: string }>(
    `select pg_get_functiondef(oid) as def from pg_proc where proname = $1 limit 1`,
    [name],
  );
  return r.rows[0]!.def;
}

// ===========================================================================
// 7 — the hardening did not break the flows it protects
// ===========================================================================

describe("7. the existing bootstrap and profile-save flows still work", () => {
  it("a bootstrapped merchant can save their business profile", async () => {
    const uid = await newUser("saveflow");
    await bootstrap(uid, "Save Flow Shop");

    const districtId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtId]);

    const r = await asMerchant(exec, uid, async () =>
      exec.query<{ result: Record<string, unknown> }>(
        `SELECT public.save_owner_business_profile_bundle(
           $1::text, $2::text, $3::uuid, $4::text, $5::text
         ) AS result`,
        ["Save Flow Shop", "pharmacy", districtId, "+256781000003", "UGX"],
      ),
    );
    expect(r.rows[0]!.result.ok).toBe(true);

    const shop = await exec.query<{ business_type: string; phone_e164: string; district: string }>(
      `select business_type, phone_e164, district from public.shops
        where organization_id = (select id from public.organizations where created_by = $1)`,
      [uid],
    );
    // The merchant's chosen type survives into the shop record — not coerced to kiosk_duka.
    expect(shop.rows[0]!.business_type).toBe("pharmacy");
    expect(shop.rows[0]!.phone_e164).toBe("+256781000003");
    expect(shop.rows[0]!.district).toBe("Kampala");
  });

  it("saving twice is still one shop, and the chosen type is never reverted", async () => {
    const uid = await newUser("saveflow2");
    await bootstrap(uid, "Twice Save Shop");
    const districtId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtId]);

    const save = async (type: string, phone: string) =>
      asMerchant(exec, uid, async () =>
        exec.query<{ result: Record<string, unknown> }>(
          `SELECT public.save_owner_business_profile_bundle($1::text, $2::text, $3::uuid, $4::text, $5::text) AS result`,
          ["Twice Save Shop", type, districtId, phone, "UGX"],
        ),
      );

    const first = await save("hospitality", "+256781000001");
    expect(first.rows[0]!.result.ok).toBe(true);

    // The second save is refused — a COMPLETE profile is locked, which is the documented
    // behaviour of this RPC ("shop details are locked"), not a regression. What matters is that
    // the refusal leaves the merchant's chosen type intact rather than resetting it.
    const second = await save("hospitality", "+256781000001");
    expect(second.rows[0]!.result).toMatchObject({ error: "profile_locked" });

    const c = await counts(uid);
    expect(c.shops).toBe(1);
    expect(c.orgs).toBe(1);
    const shop = await exec.query<{ business_type: string }>(
      `select business_type from public.shops
        where organization_id = (select id from public.organizations where created_by = $1)`,
      [uid],
    );
    expect(shop.rows[0]!.business_type).toBe("hospitality");
  });

  it("a phone already registered to another account is refused, not silently overwritten", async () => {
    const a = await newUser("phonea");
    const b = await newUser("phoneb");
    await bootstrap(a, "Phone A");
    await bootstrap(b, "Phone B");
    const districtId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtId]);

    const save = async (uid: string, name: string, phone: string) =>
      asMerchant(exec, uid, async () =>
        exec.query<{ result: Record<string, unknown> }>(
          `SELECT public.save_owner_business_profile_bundle($1::text, $2::text, $3::uuid, $4::text, $5::text) AS result`,
          [name, "kiosk_duka", districtId, phone, "UGX"],
        ),
      );

    expect((await save(a, "Phone A", "+256781000002")).rows[0]!.result.ok).toBe(true);
    // B may not take A's number. The client turns this into "This phone number is already on
    // another Waka account" — never the raw code.
    const clash = await save(b, "Phone B", "+256781000002");
    expect(clash.rows[0]!.result).toMatchObject({ ok: false, error: "phone_in_use" });

    const shopB = await exec.query<{ phone_e164: string | null }>(
      `select phone_e164 from public.shops
        where organization_id = (select id from public.organizations where created_by = $1)`,
      [b],
    );
    expect(shopB.rows[0]!.phone_e164).toBeNull();
  });

  it("a merchant with a shop but no bootstrap still self-heals through the save", async () => {
    // The bundle is the second creator. It must take the same lock and still produce one of each.
    const uid = await newUser("selfheal");
    const districtId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtId]);

    const r = await asMerchant(exec, uid, async () =>
      exec.query<{ result: Record<string, unknown> }>(
        `SELECT public.save_owner_business_profile_bundle($1::text, $2::text, $3::uuid, $4::text, $5::text) AS result`,
        ["Self Heal Shop", "boutique", districtId, "+256781000004", "UGX"],
      ),
    );
    // It must actually provision rather than refusing — this is the "confirmed merchant with no
    // tenancy recovers" case — and it must not create a duplicate or trip on the lock.
    expect(r.rows.length).toBe(1);
    const c = await counts(uid);
    expect(c.orgs).toBe(1);
    expect(c.shops).toBe(1);
    expect(c.owners).toBe(1);
    const shop = await exec.query<{ business_type: string; phone_e164: string }>(
      `select business_type, phone_e164 from public.shops
        where organization_id = (select id from public.organizations where created_by = $1)`,
      [uid],
    );
    expect(shop.rows[0]!.business_type).toBe("boutique");
    expect(shop.rows[0]!.phone_e164).toBe("+256781000004");
  });
});

// ===========================================================================
// isolation — one merchant cannot touch another
// ===========================================================================

describe("SECURITY: a merchant can only provision their own workspace", () => {
  it("one user's bootstrap never touches another user's rows", async () => {
    const a = await newUser("alice");
    const b = await newUser("bob");
    await bootstrap(a, "Alice Shop");
    await bootstrap(b, "Bob Shop");

    expect((await counts(a)).orgs).toBe(1);
    expect((await counts(b)).orgs).toBe(1);

    const mine = await exec.query<{ id: string }>(
      `select id from public.organizations where created_by = $1`,
      [a],
    );
    const theirs = await exec.query<{ id: string }>(
      `select id from public.organizations where created_by = $1`,
      [b],
    );
    expect(mine.rows[0]!.id).not.toBe(theirs.rows[0]!.id);
  });

  it("the created organization is owned by the caller and by nobody else", async () => {
    const uid = await newUser("solo");
    await bootstrap(uid, "Solo Shop");

    const rows = await exec.query<{ user_id: string }>(
      `select om.user_id from public.organization_members om
        join public.organizations o on o.id = om.organization_id
       where o.created_by = $1`,
      [uid],
    );
    expect(rows.rows.map((r) => r.user_id)).toEqual([uid]);
  });

  it("the profile it writes is the caller's own", async () => {
    const uid = await newUser("profile");
    await bootstrap(uid, "Profile Shop");
    const rows = await exec.query<{ id: string }>(`select id from public.profiles where role = 'owner'`);
    expect(rows.rows.map((r) => r.id)).toContain(uid);
  });
});

// ===========================================================================
// 15 — anonymous callers
// ===========================================================================

describe("SECURITY: 15. an unauthenticated caller cannot bootstrap", () => {
  const FNS = [
    "bootstrap_owner_workspace",
    "save_owner_business_profile_bundle",
    "owner_onboarding_status",
    "owner_workspace_health",
    "repair_owner_workspace",
  ];

  it("anon holds no EXECUTE on any of the bootstrap family", async () => {
    for (const fn of FNS) {
      const exists = await exec.query<{ n: string }>(
        `select count(*)::text as n from pg_proc where proname = $1`,
        [fn],
      );
      if (Number(exists.rows[0]!.n) === 0) {
        // Not created by this migration and not present in this schema: there is nothing an anon
        // caller could execute, which is the property under test. (Where it does exist — the
        // identity-hardening migration, and production — the assertion below applies.)
        continue;
      }
      const r = await exec.query<{ granted: boolean }>(
        `select has_function_privilege(
           'anon',
           (select oid from pg_proc where proname = $1 limit 1),
           'execute'
         ) as granted`,
        [fn],
      );
      expect({ fn, granted: r.rows[0]!.granted }).toEqual({ fn, granted: false });
    }
  });

  it("the GRANT refuses anon — before the function body can run", async () => {
    await expect(
      asAnonymous(exec, async () =>
        exec.query(`SELECT public.owner_onboarding_status() AS x`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated keeps execute — the application still works", async () => {
    const uid = await newUser("grants");
    const r = await asMerchant(exec, uid, async () =>
      exec.query(`SELECT public.owner_onboarding_status() AS x`),
    );
    expect(r.rows).toHaveLength(1);
  });

  it("service_role keeps execute — operational tooling still works", async () => {
    const r = await exec.query<{ granted: boolean }>(
      `select has_function_privilege(
         'service_role',
         (select oid from pg_proc where proname = 'bootstrap_owner_workspace' limit 1),
         'execute'
       ) as granted`,
    );
    expect(r.rows[0]!.granted).toBe(true);
  });

  it("a null identity is still refused by the body itself, not only by the grant", async () => {
    await exec.exec("BEGIN");
    await exec.exec("SET LOCAL ROLE authenticated");
    try {
      await expect(
        exec.query(`SELECT public.bootstrap_owner_workspace('No Identity') AS x`),
      ).rejects.toThrow(/not authenticated/i);
    } finally {
      await exec.exec("ROLLBACK");
    }
  });
});

// ===========================================================================
// 14 — onboarding status fails closed
// ===========================================================================

describe("14. owner_onboarding_status never claims a completion it cannot see", () => {
  it("a null identity is reported as NOT complete", async () => {
    await exec.exec("BEGIN");
    await exec.exec("SET LOCAL ROLE authenticated");
    try {
      const r = await exec.query<{ result: Record<string, unknown> }>(
        `SELECT public.owner_onboarding_status() AS result`,
      );
      expect(r.rows[0]!.result.complete).toBe(false);
      expect(JSON.stringify(r.rows[0]!.result.missing)).toContain("not_authenticated");
    } finally {
      await exec.exec("ROLLBACK");
    }
  });

  it("a merchant with no shop is not complete", async () => {
    const uid = await newUser("noprofile");
    const r = await asMerchant(exec, uid, async () =>
      exec.query<{ result: Record<string, unknown> }>(
        `SELECT public.owner_onboarding_status() AS result`,
      ),
    );
    expect(r.rows[0]!.result.complete).toBe(false);
    expect(JSON.stringify(r.rows[0]!.result.missing)).toContain("shop");
  });

  it("a fully set-up shop is reported complete — the check is not vacuous", async () => {
    const uid = await newUser("complete");
    await bootstrap(uid, "Complete Shop");
    const districtId = crypto.randomUUID();
    await exec.query(`INSERT INTO public.districts (id, name) VALUES ($1, 'Kampala')`, [districtId]);
    await exec.query(
      `UPDATE public.shops SET district_id = $2, phone_e164 = '+256700123456'
        WHERE organization_id = (select id from public.organizations where created_by = $1)`,
      [uid, districtId],
    );
    await exec.query(`UPDATE public.profiles SET email = $2 WHERE id = $1`, [
      uid,
      `${uid.slice(0, 6)}@complete.test`,
    ]);

    const r = await asMerchant(exec, uid, async () =>
      exec.query<{ result: Record<string, unknown> }>(
        `SELECT public.owner_onboarding_status() AS result`,
      ),
    );
    expect(r.rows[0]!.result.complete).toBe(true);
  });
});

// ===========================================================================
// Scope of the change
// ===========================================================================

describe("the hardening migration changes no data and stays in its lane", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  /**
   * What the migration EXECUTES: comments removed, and the function bodies replaced by a marker.
   * The bodies legitimately contain `insert into public.profiles` — that is the bootstrap doing
   * its job — so asserting on the raw file would only ever test the prose.
   */
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/as \$\$[\s\S]*?\$\$;/g, "\n[BODY OMITTED]\n");

  it("performs no insert, update, delete or DDL of its own", () => {
    expect(statements).not.toMatch(/\binsert into\b/i);
    expect(statements).not.toMatch(/\bupdate\b/i);
    expect(statements).not.toMatch(/\bdelete from\b/i);
    expect(statements).not.toMatch(/\btruncate\b/i);
    expect(statements).not.toMatch(/\bcreate table\b/i);
    expect(statements).not.toMatch(/\bcreate (unique )?index\b/i);
    expect(statements).not.toMatch(/\bdrop\b/i);
    expect(statements).not.toMatch(/\balter table\b/i);
  });

  it("applying it a second time is safe and changes nothing", async () => {
    // Idempotent by construction (create-or-replace + grants), which matters because it will be
    // applied by hand to a database that cannot use `db push`.
    const usersBefore = await exec.query<{ n: string }>(
      `select count(*)::text as n from auth.users`,
    );
    const orgsBefore = await exec.query<{ n: string }>(
      `select count(*)::text as n from public.organizations`,
    );

    await expect(exec.exec(sql)).resolves.toBeUndefined();

    const usersAfter = await exec.query<{ n: string }>(`select count(*)::text as n from auth.users`);
    const orgsAfter = await exec.query<{ n: string }>(
      `select count(*)::text as n from public.organizations`,
    );
    expect(usersAfter.rows[0]!.n).toBe(usersBefore.rows[0]!.n);
    expect(orgsAfter.rows[0]!.n).toBe(orgsBefore.rows[0]!.n);

    // And the protections are still in place afterwards.
    expect(await functionDef("bootstrap_owner_workspace")).toContain("pg_advisory_xact_lock");
  });

  it("touches only the merchant bootstrap family", () => {
    const created = [...sql.matchAll(/create or replace function\s+public\.([a-z_]+)/gi)].map(
      (m) => m[1],
    );
    expect(new Set(created)).toEqual(
      new Set([
        "bootstrap_owner_workspace",
        "save_owner_business_profile_bundle",
        "owner_onboarding_status",
      ]),
    );
    // Nothing loyalty, member or Wallet-shaped is created, granted or revoked here.
    expect(statements).not.toMatch(/loyalty|member_|wallet/i);
  });
});
