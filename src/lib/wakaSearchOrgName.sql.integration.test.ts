/**
 * Shop discovery — searching by ORGANIZATION name and owner business name.
 *
 * The reported symptom was "searching for a known shop returns nothing". The
 * text mode of `internal_ops_search_shops` matched only `shops.name`,
 * `shops.shop_number` and `profiles.full_name`, so an operator searching the
 * ACCOUNT name — the name they see in billing — got an empty list that looks
 * exactly like "this shop does not exist".
 *
 * These tests run 187 and then the re-declaration, which is the pair production
 * actually has. The hardened behaviours that must NOT drift (exact shop-number
 * matching, the sub-2-character empty result, the role gate, the response
 * contract) are pinned here as well, because this migration re-declares the
 * whole function and could quietly drop any of them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  applyInternalOpsSearchShopsOrgName,
  applyWakaInternalOpsSearchShops,
  asUser,
  createWakaSecuritySqlHarness,
  INTERNAL_OPS_SEARCH_FIXTURE as F,
  seedInternalOpsSearchShopsCatalog,
} from "../test/sqlIntegration/wakaSecurityHotfixPgHarness";

/** A second account whose name appears on NO shop, so a match proves the join. */
const ORG_NAME = "Gulu Wholesale Holdings Ltd";
const ORG_ID = "a2000000-0000-4000-8000-0000000000a1";
const ORG_SHOP_ID = "a2000000-0000-4000-8000-0000000000b1";
const ORG_SHOP_NAME = "Corner Kiosk"; // deliberately unrelated to ORG_NAME
const ORG_SHOP_NUMBER = "A9500";

/** Set on the fixture owner's profile; must be findable, and is already displayed. */
const OWNER_BUSINESS_NAME = "Nakato Trading Enterprises";

/** Returned by the RPC but never a search mode — see the negative test below. */
const UNSEARCHABLE_PHONE = "+256700123456";

/** The exact column contract. Searching for more must not widen what is returned. */
const RETURNED_COLUMNS = [
  "id",
  "shop_number",
  "name",
  "district",
  "city",
  "is_active",
  "created_at",
  "organization_id",
  "plan_code",
  "trial_ends_at",
  "subscription_status",
  "owner_label",
  "owner_email",
  "owner_full_name",
  "phone_e164",
  "business_type",
  "gps_missing",
  "last_seen_at",
  "product_count",
  "sale_count_30d",
].sort();

describe("shop discovery by organization and business name", () => {
  let exec: SqlExec;

  beforeAll(async () => {
    exec = await createWakaSecuritySqlHarness();
    await seedInternalOpsSearchShopsCatalog(exec);
    await applyWakaInternalOpsSearchShops(exec);
    await applyInternalOpsSearchShopsOrgName(exec);

    await exec.exec(`
      INSERT INTO public.organizations (id, name)
      VALUES ('${ORG_ID}'::uuid, '${ORG_NAME}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.shops (id, organization_id, name, shop_number, is_active, created_at, district, city, gps_missing)
      VALUES (
        '${ORG_SHOP_ID}'::uuid, '${ORG_ID}'::uuid, '${ORG_SHOP_NAME}', '${ORG_SHOP_NUMBER}',
        true, now(), 'Gulu', 'Center', false
      )
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.profiles
         SET business_name = '${OWNER_BUSINESS_NAME}',
             phone_e164 = '${UNSEARCHABLE_PHONE}'
       WHERE id = '${F.ownerId}'::uuid;
    `);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function search(query: string, limit = 25, offset = 0) {
    return asUser(exec, F.staffId, () =>
      exec.query<{ id: string; name: string; shop_number: string | null }>(
        `SELECT id::text AS id, name, shop_number FROM public.internal_ops_search_shops($1, $2, $3)`,
        [query, limit, offset],
      ),
    );
  }

  it("finds a shop by its ORGANIZATION name when the shop name does not contain it", async () => {
    const { rows } = await search(ORG_NAME);
    expect(rows.map((r) => r.id)).toEqual([ORG_SHOP_ID]);
    // The guard: the shop's own name shares no substring with the org name, so
    // this can only have matched through the organizations join.
    expect(ORG_SHOP_NAME.toLowerCase()).not.toContain(ORG_NAME.toLowerCase());
  });

  it("matches a distinctive fragment of the organization name", async () => {
    const { rows } = await search("Wholesale Holdings");
    expect(rows.map((r) => r.id)).toEqual([ORG_SHOP_ID]);
  });

  it("is case-insensitive on the organization name", async () => {
    const { rows } = await search("gulu wholesale holdings ltd");
    expect(rows.map((r) => r.id)).toEqual([ORG_SHOP_ID]);
  });

  it("finds a shop by the owner's business name", async () => {
    const { rows } = await search(OWNER_BUSINESS_NAME);
    expect(rows.map((r) => r.id)).toEqual([F.oldShopId]);
  });

  it("still finds the same shop by its own name, unchanged", async () => {
    const { rows } = await search(F.oldShopName);
    expect(rows.map((r) => r.id)).toEqual([F.oldShopId]);
  });

  it("still finds the owner by full name and by email", async () => {
    const byName = await search(F.ownerFullName);
    expect(byName.rows.map((r) => r.id)).toEqual([F.oldShopId]);

    const byEmail = await search(F.ownerEmail);
    expect(byEmail.rows.map((r) => r.id)).toEqual([F.oldShopId]);
  });

  describe("hardened behaviour that must not drift", () => {
    it("keeps shop-number matching EXACT", async () => {
      const exact = await search(F.oldShopNumber);
      expect(exact.rows.map((r) => r.id)).toEqual([F.oldShopId]);

      // A partial number is NOT a prefix search — it is an exact miss, by design.
      const partial = await search("A900");
      expect(partial.rows).toEqual([]);

      // ...and the digits without the leading A fall through to text mode, where
      // the substring DOES match. Both behaviours are deliberate.
      const digits = await search("9001");
      expect(digits.rows.map((r) => r.id)).toEqual([F.oldShopId]);
    });

    it("still returns nothing for a query shorter than two characters", async () => {
      expect((await search("a")).rows).toEqual([]);
      expect((await search("7")).rows).toEqual([]);
    });

    it("does NOT match a phone number — searching by phone is not a supported mode", async () => {
      // phone_e164 is RETURNED by this RPC but has never been displayed in the
      // admin shop list nor searchable. Matching on it would hand every internal
      // staff member a phone-number lookup over the whole customer base, which
      // is a new capability rather than a repair. Pinned so it cannot appear by
      // accident.
      const { rows } = await search(UNSEARCHABLE_PHONE);
      expect(rows).toEqual([]);

      const withoutPlus = await search("256700123456");
      expect(withoutPlus.rows).toEqual([]);
    });

    it("returns exactly the documented columns — searching org name exposes no new data", async () => {
      const { rows } = await asUser(exec, F.staffId, () =>
        exec.query<Record<string, unknown>>(
          `SELECT * FROM public.internal_ops_search_shops($1, 1, 0)`,
          [ORG_NAME],
        ),
      );
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!).sort()).toEqual(RETURNED_COLUMNS);
      // In particular: the organization NAME is not returned, only its id.
      expect(Object.keys(rows[0]!)).not.toContain("organization_name");
    });

    it("still refuses a caller who is not internal staff", async () => {
      await expect(
        asUser(exec, F.outsiderId, () =>
          exec.query(`SELECT id FROM public.internal_ops_search_shops($1, 10, 0)`, [ORG_NAME]),
        ),
      ).rejects.toThrow(/forbidden/i);
    });

    it("keeps browse paginating newest-first and still reports has_more via the extra row", async () => {
      const first = await search("", 5, 0);
      // 110 fixture shops + 1 added here.
      expect(first.rows).toHaveLength(6); // limit + 1
      const second = await search("", 5, 5);
      expect(second.rows).toHaveLength(6);
      // No overlap between pages.
      const overlap = first.rows.slice(0, 5).map((r) => r.id).filter((id) => second.rows.some((r) => r.id === id));
      expect(overlap).toEqual([]);
    });
  });
});
