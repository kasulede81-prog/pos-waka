/**
 * PHASE 0A — a fake `@supabase/supabase-js` client for the offline test project.
 *
 * SCOPE: this fakes the NETWORK BOUNDARY only. It is a stand-in for a remote
 * Postgres/PostgREST server, in the same spirit as the PGLite harness used by
 * the `*.sql.integration.test.ts` files.
 *
 * It must never be used to stub out application code. The functions under test
 * (`pullShopDataFromCloud`, `pullCloudAndMergeIntoStore`, `flushSyncQueue`, the
 * merge helpers, the checkpoint logic) all run for real against it.
 *
 * Behaviour:
 *   - `from(table)` returns rows configured for that table, or `[]`.
 *   - Filter/order/pagination methods are accepted and chainable but do not
 *     filter. Tests configure the exact rows the server should return, which
 *     keeps the assertion about client behaviour rather than about a
 *     reimplementation of PostgREST.
 *   - Writes are recorded in `writes` so a test can assert what was pushed.
 *   - `rpc(name, args)` is routed to a per-test handler; unknown RPCs resolve
 *     `{ data: null, error: null }`, which every caller in `cloudSync.ts`
 *     already treats as "no rows".
 */

import {
  parseIncrementalKeysetOr,
  rowMatchesIncrementalKeyset,
} from "../../lib/incrementalKeyset";

export type FakeSupabaseWrite = {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: unknown;
};

export type FakeSupabaseRpcCall = {
  fn: string;
  args: Record<string, unknown> | undefined;
};

export type FakeSupabaseOptions = {
  /** Auth user returned by `auth.getSession()` / `auth.getUser()`. */
  user?: {
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  } | null;
  /** Rows the fake server returns for each table name. */
  tables?: Record<string, unknown[]>;
  /** Optional per-RPC results, keyed by function name. */
  rpc?: Record<string, unknown>;
  /**
   * Opt-in keyset semantics for `.gt()` / `.order()` / `.limit()`.
   *
   * OFF by default, so every existing test keeps the "server returns exactly
   * the rows I configured" behaviour. Turn it ON to exercise cursor
   * advancement and multi-page pagination, where the point under test is
   * precisely that the client re-queries with a moved cursor and the server
   * answers with the *next* slice. Only the operators the incremental pullers
   * actually use are implemented; everything else stays a no-op.
   */
  keyset?: boolean;
  /**
   * Opt-in PostgREST `.eq()` / `.in()` filtering, per table.
   *
   * OFF by default so existing tests keep "the server returns exactly the rows
   * I configured". Turn it ON for tables where the test's point is that the
   * client sent a status/shop filter and the server honoured it (WAKA-09).
   */
  columnFilterTables?: string[];
};

type QueryOutcome = { data: unknown; error: null };

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "or",
  "not",
  "filter",
  "match",
  "contains",
  "order",
  "limit",
  "range",
  "abortSignal",
  "throwOnError",
  "returns",
  "overrideTypes",
  "explain",
] as const;

class FakeQueryBuilder implements PromiseLike<QueryOutcome> {
  // Plain fields, not constructor parameter properties: tsconfig.app.json sets
  // `erasableSyntaxOnly`, which forbids TypeScript-only constructor syntax.
  private rows: unknown[];
  private readonly table: string;
  private readonly writes: FakeSupabaseWrite[];
  private readonly keyset: boolean;
  private readonly columnFilters: boolean;
  private eqFilters: Array<{ column: string; value: unknown }> = [];
  private inFilters: Array<{ column: string; values: unknown[] }> = [];
  private gtColumn: string | null = null;
  private gtValue: string | null = null;
  private orFilter: string | null = null;
  private orderColumn: string | null = null;
  private orderAscending = true;
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private rowLimit: number | null = null;

  constructor(
    table: string,
    rows: unknown[],
    writes: FakeSupabaseWrite[],
    keyset = false,
    columnFilters = false,
  ) {
    this.table = table;
    this.rows = rows;
    this.writes = writes;
    this.keyset = keyset;
    this.columnFilters = columnFilters;
    for (const method of CHAIN_METHODS) {
      (this as unknown as Record<string, unknown>)[method] = () => this;
    }
    if (columnFilters) {
      (this as unknown as Record<string, unknown>).eq = (column: string, value: unknown) => {
        this.eqFilters.push({ column, value });
        return this;
      };
      (this as unknown as Record<string, unknown>).in = (column: string, values: unknown[]) => {
        this.inFilters.push({ column, values: [...values] });
        return this;
      };
    }
    if (!keyset) return;
    (this as unknown as Record<string, unknown>).gt = (column: string, value: unknown) => {
      this.gtColumn = column;
      this.gtValue = value == null ? null : String(value);
      return this;
    };
    (this as unknown as Record<string, unknown>).order = (
      column: string,
      opts?: { ascending?: boolean },
    ) => {
      const ascending = opts?.ascending !== false;
      this.orderColumn = column;
      this.orderAscending = ascending;
      this.orders.push({ column, ascending });
      return this;
    };
    (this as unknown as Record<string, unknown>).or = (filters: string) => {
      this.orFilter = filters;
      return this;
    };
    (this as unknown as Record<string, unknown>).limit = (n: number) => {
      this.rowLimit = n;
      return this;
    };
  }

  /** Apply recorded `.eq` / `.in` and, when enabled, keyset `.gt` / `.or` / `.order` / `.limit`. */
  private resolveRows(): unknown[] {
    if (!this.keyset && !this.columnFilters) return this.rows;
    let out = [...this.rows] as Record<string, unknown>[];
    if (this.columnFilters) {
      for (const filter of this.eqFilters) {
        out = out.filter((row) => row[filter.column] === filter.value);
      }
      for (const filter of this.inFilters) {
        out = out.filter((row) => filter.values.includes(row[filter.column]));
      }
    }
    if (!this.keyset) return out;
    const keysetOr = this.orFilter ? parseIncrementalKeysetOr(this.orFilter) : null;
    if (keysetOr) {
      out = out.filter((row) =>
        rowMatchesIncrementalKeyset(row, keysetOr.timeCol, { at: keysetOr.at, id: keysetOr.id }),
      );
    } else if (this.gtColumn && this.gtValue != null) {
      const column = this.gtColumn;
      const bound = this.gtValue;
      out = out.filter((row) => {
        const cell = row[column];
        return typeof cell === "string" && cell > bound;
      });
    }
    const sortKeys =
      this.orders.length > 0
        ? this.orders
        : this.orderColumn
          ? [{ column: this.orderColumn, ascending: this.orderAscending }]
          : [];
    if (sortKeys.length > 0) {
      out.sort((a, b) => {
        for (const { column, ascending } of sortKeys) {
          const av = String(a[column] ?? "");
          const bv = String(b[column] ?? "");
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (this.rowLimit != null) out = out.slice(0, this.rowLimit);
    return out;
  }

  insert(payload: unknown): this {
    this.writes.push({ table: this.table, op: "insert", payload });
    this.rows = [];
    return this;
  }

  update(payload: unknown): this {
    this.writes.push({ table: this.table, op: "update", payload });
    this.rows = [];
    return this;
  }

  upsert(payload: unknown): this {
    this.writes.push({ table: this.table, op: "upsert", payload });
    this.rows = [];
    return this;
  }

  delete(): this {
    this.writes.push({ table: this.table, op: "delete", payload: null });
    this.rows = [];
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: this.resolveRows()[0] ?? null, error: null });
  }

  single(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: this.resolveRows()[0] ?? null, error: null });
  }

  then<TResult1 = QueryOutcome, TResult2 = never>(
    onfulfilled?: ((value: QueryOutcome) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.resolveRows(), error: null } as QueryOutcome).then(
      onfulfilled,
      onrejected,
    );
  }
}

export type FakeSupabaseClient = {
  auth: {
    getSession: () => Promise<{ data: { session: unknown }; error: null }>;
    getUser: () => Promise<{ data: { user: unknown }; error: null }>;
    onAuthStateChange: () => { data: { subscription: { unsubscribe: () => void } } };
  };
  from: (table: string) => FakeQueryBuilder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: null }>;
  channel: (name: string) => {
    on: () => ReturnType<FakeSupabaseClient["channel"]>;
    subscribe: () => ReturnType<FakeSupabaseClient["channel"]>;
    unsubscribe: () => Promise<"ok">;
  };
  removeChannel: () => Promise<"ok">;
  /** Test-only: every write the client received, in order. */
  writes: FakeSupabaseWrite[];
  /** Test-only: every RPC the client received, in order. */
  rpcCalls: FakeSupabaseRpcCall[];
};

export function createFakeSupabaseClient(options: FakeSupabaseOptions = {}): FakeSupabaseClient {
  const writes: FakeSupabaseWrite[] = [];
  const rpcCalls: FakeSupabaseRpcCall[] = [];
  const tables = options.tables ?? {};
  const rpcResults = options.rpc ?? {};
  const user =
    options.user === undefined
      ? {
          id: "00000000-0000-4000-8000-000000000001",
          email: "harness@waka.test",
          email_confirmed_at: "2026-01-01T00:00:00.000Z",
          app_metadata: {},
          user_metadata: {},
        }
      : options.user;

  const session = user ? { user, access_token: "fake-access-token", expires_at: 9_999_999_999 } : null;

  const makeChannel = (): ReturnType<FakeSupabaseClient["channel"]> => {
    const channel = {
      on: () => channel,
      subscribe: () => channel,
      unsubscribe: async () => "ok" as const,
    };
    return channel as ReturnType<FakeSupabaseClient["channel"]>;
  };

  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: (table: string) =>
      new FakeQueryBuilder(
        table,
        [...(tables[table] ?? [])],
        writes,
        options.keyset === true,
        options.columnFilterTables?.includes(table) === true,
      ),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: fn in rpcResults ? rpcResults[fn] : null, error: null };
    },
    channel: () => makeChannel(),
    removeChannel: async () => "ok" as const,
    writes,
    rpcCalls,
  };
}
