import { describe, expect, it } from "vitest";
import {
  formatIncrementalKeysetOr,
  incrementalKeysetFromSince,
  keysetFromLastRow,
  parseIncrementalKeysetOr,
  rowMatchesIncrementalKeyset,
} from "./incrementalKeyset";

describe("WAKA-07 incremental keyset helper", () => {
  const shared = "2026-08-01T00:00:00.000Z";

  it("first page (no id) is a strict time bound", () => {
    const cursor = incrementalKeysetFromSince("2026-07-01T00:00:00.000Z");
    expect(cursor.id).toBe("");
    expect(rowMatchesIncrementalKeyset({ updated_at: shared, id: "a" }, "updated_at", cursor)).toBe(true);
    expect(
      rowMatchesIncrementalKeyset(
        { updated_at: "2026-07-01T00:00:00.000Z", id: "a" },
        "updated_at",
        cursor,
      ),
    ).toBe(false);
  });

  it("later pages include the same timestamp after the last id", () => {
    const cursor = { at: shared, id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000499" };
    expect(
      rowMatchesIncrementalKeyset(
        { updated_at: shared, id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000500" },
        "updated_at",
        cursor,
      ),
    ).toBe(true);
    expect(
      rowMatchesIncrementalKeyset(
        { updated_at: shared, id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000499" },
        "updated_at",
        cursor,
      ),
    ).toBe(false);
    expect(
      rowMatchesIncrementalKeyset(
        { updated_at: "2026-08-02T00:00:00.000Z", id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001" },
        "updated_at",
        cursor,
      ),
    ).toBe(true);
  });

  it("round-trips the PostgREST .or() filter", () => {
    const expr = formatIncrementalKeysetOr("created_at", shared, "id-1");
    expect(parseIncrementalKeysetOr(expr)).toEqual({
      timeCol: "created_at",
      at: shared,
      id: "id-1",
    });
  });

  it("advances the in-memory cursor from the last row of a page", () => {
    const next = keysetFromLastRow(
      [
        { id: "a", updated_at: shared },
        { id: "b", updated_at: shared },
      ],
      "updated_at",
      incrementalKeysetFromSince("2026-07-01T00:00:00.000Z"),
    );
    expect(next).toEqual({ at: shared, id: "b" });
  });
});
