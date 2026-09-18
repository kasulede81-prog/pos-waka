import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Hospitality business-type validation regression test.
 *
 * Bug: migration 20260918003000 added 'hospitality' to the shops /
 * organizations CHECK constraints but left public.is_valid_shop_business_type
 * (078) without it, so every validating write path (admin profile override,
 * owner business-profile bundle) rejected Hospitality with
 * invalid_business_type. This test pins the validator to the CHECK
 * constraint list.
 */

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  const dir = join(process.cwd(), "supabase", "migrations");
  // 078 creates the original validator (and the RPCs that call it);
  // the fix migration must bring it in line with the CHECK constraints.
  await db.exec(readFileSync(join(dir, "078_business_type_persistence.sql"), "utf8"));
  await db.exec(
    readFileSync(join(dir, "20260918143000_hospitality_business_type_validation.sql"), "utf8"),
  );
}, 60_000);

afterAll(async () => {
  await db.close();
});

const VALID_TYPES = [
  "kiosk_duka",
  "wholesale",
  "mini_supermarket",
  "hardware",
  "hospitality",
  "restaurant",
  "bar",
  "restaurant_bar",
  "hotel",
  "salon",
  "pharmacy",
  "boutique",
  "electronics",
  "produce_market",
  "mobile_money_agent",
  "other",
];

async function isValid(type: string): Promise<boolean> {
  const res = await db.query<{ ok: boolean }>("SELECT public.is_valid_shop_business_type($1) AS ok", [
    type,
  ]);
  return Boolean(res.rows[0]?.ok);
}

describe("is_valid_shop_business_type", () => {
  it("accepts every business type allowed by the CHECK constraints, including hospitality", async () => {
    for (const type of VALID_TYPES) {
      expect(await isValid(type), `expected ${type} to be valid`).toBe(true);
    }
  });

  it("rejects unknown, empty, and blank values", async () => {
    expect(await isValid("spa")).toBe(false);
    expect(await isValid("")).toBe(false);
    expect(await isValid("   ")).toBe(false);
    expect(await isValid("Hospitality")).toBe(false); // case-sensitive, stored values are snake_case
  });
});
