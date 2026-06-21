/**
 * Unlimited cloud pull pagination — cursor/range loops until exhaustion.
 */

export type OffsetPullProgress = {
  pulled: number;
  page: number;
};

export type CursorPullProgress = {
  pulled: number;
  page: number;
  cursor: string;
};

/** Offset/range Supabase queries until a batch is empty or smaller than pageSize. */
export async function pullOffsetRangeUntilExhausted<T>(opts: {
  pageSize: number;
  fetchRange: (offset: number) => Promise<T[]>;
  onProgress?: (progress: OffsetPullProgress) => void;
}): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (let page = 0; ; page++) {
    const batch = await opts.fetchRange(offset);
    if (batch.length === 0) break;
    all.push(...batch);
    opts.onProgress?.({ pulled: all.length, page });
    if (batch.length < opts.pageSize) break;
    offset += opts.pageSize;
    const { yieldUiTick } = await import("./uiYield");
    await yieldUiTick();
  }
  return all;
}

/** Cursor (`updated_at` / checkpoint) pagination until exhaustion. */
export async function pullCursorUntilExhausted<T>(opts: {
  initialCursor: string;
  pageSizeHint: number;
  pullPage: (cursor: string) => Promise<{ rows: T[]; checkpointAt: string; bytes?: number }>;
  onProgress?: (progress: CursorPullProgress) => void;
}): Promise<{ rows: T[]; bytes: number; checkpointAt: string }> {
  const all: T[] = [];
  let bytes = 0;
  let cursor = opts.initialCursor;
  let checkpointAt = opts.initialCursor;

  for (let page = 0; ; page++) {
    const batch = await opts.pullPage(cursor);
    bytes += batch.bytes ?? 0;
    if (batch.rows.length === 0) break;
    checkpointAt = batch.checkpointAt;
    all.push(...batch.rows);
    opts.onProgress?.({ pulled: all.length, page, cursor });
    if (batch.rows.length < opts.pageSizeHint) break;
    if (batch.checkpointAt <= cursor) break;
    cursor = batch.checkpointAt;
    const { yieldUiTick } = await import("./uiYield");
    await yieldUiTick();
  }

  return { rows: all, bytes, checkpointAt };
}
