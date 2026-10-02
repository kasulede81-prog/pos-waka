import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createLoyaltySqlHarness, type SqlExec } from "../../test/sqlIntegration/loyaltyPgHarness";

/**
 * WPL allocation under GENUINE concurrent transactions — real PostgreSQL only.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * `loyaltyProgramCode.sql.integration.test.ts` runs on PGlite, which is one connection, so its
 * allocation case is strictly SEQUENTIAL and says so. It cannot observe two transactions racing.
 * This file exists for that single property and nothing else.
 *
 * PGlite IS NOT USED FOR THE CONCURRENCY CLAIM, and neither is `@electric-sql/pglite-socket`. The
 * socket server looks like it offers concurrent connections but SERIALISES all work behind any open
 * transaction — measured directly: with one connection sitting in `BEGIN`, a second could not even
 * execute `SELECT 1`. Evidence gathered through it is a false positive, so it is deliberately
 * absent from this path. `createLoyaltySqlHarness` is imported ONLY to reuse the bootstrap and
 * migration list; its `url` branch returns before `new PGlite()` is reached, so no PGlite instance
 * exists here.
 *
 * WHAT MAKES THIS CONCURRENCY RATHER THAN SEQUENCING
 * --------------------------------------------------
 * Every competing operation is a separate pooled connection, its own `BEGIN`, and it waits on a
 * real BARRIER — `makeBarrier` — which only releases once every participant has arrived. So all
 * transactions are OPEN and about to allocate before any of them actually does. A chain of `await`s
 * that merely starts one actor after another is not this.
 *
 * The negative control is deliberately self-checking: if the database serialised the two
 * transactions, the second would read the first's committed value, compute a different number, and
 * the "duplicate" assertion would FAIL. It cannot pass by accident on a serialising harness.
 *
 * RUNNING IT
 * ----------
 *   TEST_DATABASE_URL=postgres://user@host:5432/db npx vitest run <this file>
 *
 * Point it at a DISPOSABLE database — the harness applies the bootstrap and every migration to it.
 * A guard below refuses to run against a hosted Supabase database. With `TEST_DATABASE_URL` unset
 * the suite SKIPS; it never falls back to a weaker substitute.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL?.trim();
const SKIP = !TEST_DB_URL;

/** DKASU's production Supabase project ref, as pinned in supabase/config.toml and vercel.json. */
const PRODUCTION_PROJECT_REF = "ljaedextsenbkxzzgxcg";

/**
 * The harness runs `CREATE TABLE IF NOT EXISTS` and the whole migration chain against whatever it
 * is pointed at. Aimed at production that would be catastrophic, so a hosted Supabase URL — and the
 * known production ref specifically — is refused outright rather than skipped, because the person
 * who configured it needs to be told, loudly.
 */
function assertDisposableDatabase(url: string): void {
  const lowered = url.toLowerCase();
  const problems: string[] = [];
  if (lowered.includes(PRODUCTION_PROJECT_REF)) {
    problems.push("it names the WAKA production Supabase project ref");
  }
  if (/\.supabase\.(co|com|net|in)(:\d+)?(\/|$|\?)/.test(lowered)) {
    problems.push("it is a hosted Supabase database");
  }
  if (problems.length > 0) {
    throw new Error(
      `REFUSING to run: TEST_DATABASE_URL was rejected because ${problems.join(" and ")}. ` +
        "This suite applies the bootstrap and every WPL migration to its target and must only " +
        "ever point at a disposable local PostgreSQL.",
    );
  }
}

/**
 * Isolated issuance years, so each series owns its own counter row and nothing here depends on —
 * or disturbs — how many codes the current year has already issued.
 */
const YEAR_DIRECT = 2088;
const YEAR_INSERT = 2089;
const YEAR_NAIVE = 2099;

const PROBE_TABLE = "public.wpl_naive_probe";
const CODE_RE = /^WPL[0-9]{4}[0-9]{3,9}$/;

let exec: SqlExec;
let pool: pg.Pool;

/** Sequence number out of a code: everything after `WPL` + the 4-digit year. */
function seqOf(code: string): number {
  return Number(code.slice(7));
}

/** True when `values` is a run with no gap and no repeat. Order-independent. */
function isContiguousRun(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1]! + 1) return false;
  }
  return true;
}

/**
 * A real barrier. Returns an `arrive()` that resolves only once `count` callers have reached it,
 * so every participant is provably at the same point before any of them proceeds.
 */
function makeBarrier(count: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) open();
    await gate;
  };
}

/**
 * Check out an INDEPENDENT pooled connection, run `fn`, and always hand the connection back clean.
 *
 * The unconditional `ROLLBACK` is the point: outside a transaction it is a harmless no-op, and
 * inside one it guarantees that a client is never returned to the pool with a transaction still
 * open. Without it, a test that throws mid-transaction leaves a dirty client behind and whichever
 * test checks it out next inherits the transaction.
 */
async function withConnection<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {
      /* connection already broken; release below still returns it to the pool's accounting */
    });
    c.release();
  }
}

const ALLOC = `select public.next_waka_loyalty_program_code($1) as c`;

beforeAll(async () => {
  if (SKIP) return;
  assertDisposableDatabase(TEST_DB_URL!);
  exec = await createLoyaltySqlHarness();
  // `pg` is already a dependency (the SQL harness uses it); nothing was added for this file.
  pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 16 });

  // Negative-control scaffolding. NO unique constraint, deliberately: it is what lets the unsafe
  // allocator's duplicate land silently, which is the real-world failure — two merchants sharing
  // one code. A constraint would turn it into a loud error and hide the defect being demonstrated.
  await exec.exec(`
    drop table if exists ${PROBE_TABLE};
    create table ${PROBE_TABLE} (code text not null);

    create or replace function public.wpl_naive_alloc_probe() returns text
    language plpgsql as $fn$
    declare
      v_seq integer;
      v_code text;
    begin
      -- The unsafe shape, reproduced ONLY as a foil. Never used by production code.
      select coalesce(max(substring(code from 8)::integer), 0) + 1 into v_seq from ${PROBE_TABLE};
      v_code := 'WPL${YEAR_NAIVE}' || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0');
      insert into ${PROBE_TABLE} (code) values (v_code);
      return v_code;
    end;
    $fn$;
  `);
}, 180_000);

afterAll(async () => {
  if (SKIP) return;
  await exec.exec(`drop table if exists ${PROBE_TABLE}; drop function if exists public.wpl_naive_alloc_probe();`);
  await pool?.end();
  await exec?.close();
});

describe.skipIf(SKIP)("WPL allocation under genuine concurrency (real PostgreSQL)", () => {
  it("two transactions released from a barrier allocate simultaneously and take the complete run 001..002", async () => {
    const barrier = makeBarrier(2);
    const allocateAfterBarrier = () =>
      withConnection(async (c) => {
        await c.query("begin");
        await barrier(); // both transactions are OPEN before either allocates
        const r = await c.query<{ c: string }>(ALLOC, [YEAR_DIRECT]);
        await c.query("commit");
        return r.rows[0]!.c;
      });

    const codes = await Promise.all([allocateAfterBarrier(), allocateAfterBarrier()]);

    // Compared as a SET, never by index: which transaction wins the row lock is a race, so neither
    // arrival order, completion order nor commit order may be assumed to equal allocation order.
    expect(new Set(codes)).toEqual(new Set([`WPL${YEAR_DIRECT}001`, `WPL${YEAR_DIRECT}002`]));
    expect(isContiguousRun(codes.map(seqOf))).toBe(true);
  }, 60_000);

  it("the row lock provably serialises: a second allocator cannot resolve while the first holds it", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    let bSettled = false;
    let bPromise: Promise<string | null> = Promise.resolve(null);
    try {
      await a.query("begin");
      const codeA = (await a.query<{ c: string }>(ALLOC, [YEAR_DIRECT])).rows[0]!.c;

      // B issues the identical statement against the same counter row while A's transaction is
      // still open, so it MUST block on A's row lock.
      bPromise = (async () => {
        await b.query("begin");
        const r = await b.query<{ c: string }>(ALLOC, [YEAR_DIRECT]);
        await b.query("commit");
        return r.rows[0]!.c;
      })()
        .finally(() => {
          bSettled = true;
        })
        .catch(() => null);

      await new Promise((r) => setTimeout(r, 1200));
      expect(bSettled, "B resolved while A held the row lock — allocation is not serialised").toBe(false);

      await a.query("commit");
      const codeB = await bPromise;

      expect(codeB).toBeTruthy();
      expect(new Set([codeA, codeB!]).size, "both transactions received the same code").toBe(2);
      expect(isContiguousRun([seqOf(codeA), seqOf(codeB!)])).toBe(true);
    } finally {
      // Release any lock still held first, so a blocked B can finish rather than being destroyed
      // while it is mid-query.
      await a.query("rollback").catch(() => {});
      await Promise.race([bPromise.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      // If B never settled its transaction is still in flight: destroy that connection instead of
      // returning a dirty one to the pool.
      b.release(bSettled ? undefined : new Error("concurrency test aborted with a transaction in flight"));
      a.release();
    }
  }, 60_000);

  it("8 barrier-released transactions through the REAL insert path: no duplicate, no lost allocation", async () => {
    // Drives production behaviour end to end: each transaction INSERTs a loyalty_programs row, which
    // fires the BEFORE INSERT trigger in the migration that allocates the code. The allocator is
    // never reimplemented here.
    const shopIds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = crypto.randomUUID();
      shopIds.push(id);
      await exec.query(
        `INSERT INTO public.shops (id, organization_id, name, shop_number)
         VALUES ($1, (SELECT id FROM public.organizations LIMIT 1), $2, $3)`,
        [id, `Conc Shop ${i}`, `CONC-${i}`],
      );
    }

    const barrier = makeBarrier(shopIds.length);
    const codes = await Promise.all(
      shopIds.map((shopId) =>
        withConnection(async (c) => {
          await c.query("begin");
          await barrier();
          const r = await c.query<{ public_code: string }>(
            `INSERT INTO public.loyalty_programs (shop_id, enabled) VALUES ($1, true)
             RETURNING public_code`,
            [shopId],
          );
          await c.query("commit");
          return r.rows[0]!.public_code;
        }),
      ),
    );

    // Every transaction received a well-formed code...
    expect(codes).toHaveLength(8);
    for (const code of codes) expect(code, code).toMatch(CODE_RE);
    // ...no two are the same...
    expect(new Set(codes).size).toBe(8);
    // ...and they form an unbroken run, so no allocation was skipped, lost or reused.
    expect(isContiguousRun(codes.map(seqOf))).toBe(true);

    // The database itself agrees: one row per shop, and no code reused platform-wide.
    const dups = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT public_code FROM public.loyalty_programs
         GROUP BY public_code HAVING count(*) > 1
       ) d`,
    );
    expect(dups.rows[0]?.n).toBe("0");

    const stored = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.loyalty_programs WHERE shop_id = ANY($1::uuid[])`,
      [shopIds],
    );
    expect(stored.rows[0]?.n).toBe("8");
  }, 60_000);

  it("repeats cleanly — 3 barrier-released rounds of 6, no repeat and no gap", async () => {
    const seen = new Set<string>();
    for (let round = 0; round < 3; round += 1) {
      const barrier = makeBarrier(6);
      const batch = await Promise.all(
        Array.from({ length: 6 }, () =>
          withConnection(async (c) => {
            await c.query("begin");
            await barrier();
            const r = await c.query<{ c: string }>(ALLOC, [YEAR_INSERT]);
            await c.query("commit");
            return r.rows[0]!.c;
          }),
        ),
      );
      // Contiguity is asserted per round, as a set.
      expect(isContiguousRun(batch.map(seqOf)), `round ${round} was not a contiguous run`).toBe(true);
      for (const code of batch) {
        expect(seen.has(code), `code ${code} was issued twice under concurrency`).toBe(false);
        seen.add(code);
      }
    }
    expect(seen.size).toBe(18);
  }, 120_000);

  it("NEGATIVE CONTROL: MAX()+1 duplicates under genuine mutual concurrency", async () => {
    // Without this the tests above could pass against a harness that cannot see a race at all —
    // which is exactly how the PGlite socket server's serialisation was caught.
    await exec.exec(`truncate ${PROBE_TABLE}`);

    const a = await pool.connect();
    const b = await pool.connect();
    const observer = await pool.connect();
    try {
      await a.query("begin");
      const first = (await a.query<{ c: string }>(`select public.wpl_naive_alloc_probe() as c`)).rows[0]!.c;

      // A is provably UNCOMMITTED and still holding an open transaction: a third, independent
      // connection cannot see its row. This is what makes the two transactions overlap rather than
      // merely follow one another.
      const seen = await observer.query<{ n: number }>(
        `select count(*)::int as n from ${PROBE_TABLE}`,
      );
      expect(
        seen.rows[0]?.n,
        "A's uncommitted row was already visible — the two transactions are not overlapping",
      ).toBe(0);

      await b.query("begin");
      const second = (await b.query<{ c: string }>(`select public.wpl_naive_alloc_probe() as c`)).rows[0]!.c;

      await a.query("commit");
      await b.query("commit");

      // Two different merchants, one code. Note this CANNOT pass on a serialising harness: there B
      // would run only after A committed, read max() = 1, and return 002 — so the assertion below
      // would fail and expose the harness rather than the allocator.
      expect(second).toBe(first);
      const rows = await exec.query<{ n: string; d: string }>(
        `SELECT count(*)::text AS n, count(DISTINCT code)::text AS d FROM ${PROBE_TABLE}`,
      );
      expect(rows.rows[0]?.n).toBe("2");
      expect(rows.rows[0]?.d).toBe("1");
    } finally {
      // Rollback first (a no-op when already committed), so each client is provably free of an
      // open transaction before it goes back to the pool.
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      await observer.query("rollback").catch(() => {});
      a.release();
      b.release();
      observer.release();
    }
  }, 60_000);
});
