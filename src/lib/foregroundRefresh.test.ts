import { describe, expect, it } from "vitest";
import {
  createForegroundRefresher,
  DEFAULT_REFRESH_INTERVAL_MS,
  type RefreshClock,
  type TimerHandle,
} from "./foregroundRefresh";

/**
 * A clock the test drives by hand. No real elapsed time is involved, so these
 * assertions are about the schedule itself rather than about how fast the
 * machine running them happens to be.
 */
function createTestClock() {
  let seq = 0;
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();

  const clock: RefreshClock = {
    setInterval: (fn, ms) => {
      const id = ++seq;
      intervals.set(id, { fn, ms });
      return id as unknown as TimerHandle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as unknown as number);
    },
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timeouts.set(id, { fn, ms });
      return id as unknown as TimerHandle;
    },
    clearTimeout: (handle) => {
      timeouts.delete(handle as unknown as number);
    },
  };

  return {
    clock,
    timeouts: () => timeouts.size,
    intervals: () => intervals.size,
    intervalDelay: () => [...intervals.values()][0]?.ms ?? null,
    coalesceDelay: () => [...timeouts.values()][0]?.ms ?? null,
    fireTimeout: () => {
      const entry = [...timeouts.entries()][0];
      if (!entry) throw new Error("no timeout scheduled");
      timeouts.delete(entry[0]);
      entry[1].fn();
    },
    fireInterval: () => {
      const live = [...intervals.values()];
      if (live.length === 0) throw new Error("no interval armed");
      for (const timer of live) timer.fn();
    },
  };
}

/** Let every queued microtask settle, so an awaited run can finish. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/** A promise the test settles by hand, so "still in flight" is a real state. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("foregroundRefresh — periodic tick", () => {
  it("re-reads on each tick while the surface stays visible", () => {
    const c = createTestClock();
    const runs: string[] = [];
    const refresher = createForegroundRefresher({
      run: () => void runs.push("tick"),
      intervalMs: DEFAULT_REFRESH_INTERVAL_MS,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(true);

    expect(c.intervals()).toBe(1);
    expect(c.intervalDelay()).toBe(60_000);

    c.fireInterval();
    c.fireInterval();

    expect(runs).toHaveLength(2);
  });

  it("does not arm the tick when the surface starts hidden", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(false);

    expect(c.intervals()).toBe(0);
    expect(refresher.polling()).toBe(false);
  });

  it("never runs on start — the caller owns its own initial load", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(true);

    expect(runs).toBe(0);
  });
});

describe("foregroundRefresh — visibility", () => {
  it("stops polling while hidden and re-arms on return", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(true);
    expect(c.intervals()).toBe(1);

    refresher.hide();
    expect(c.intervals()).toBe(0);
    expect(refresher.polling()).toBe(false);

    refresher.resume();
    expect(c.intervals()).toBe(1);
  });

  it("drops a queued read when the surface goes hidden before it fires", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 400,
    });

    refresher.resume();
    expect(c.timeouts()).toBe(1);

    refresher.hide();
    expect(c.timeouts()).toBe(0);

    expect(runs).toBe(0);
  });

  it("refreshes once for a visibility transition, not once per caller", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 400,
    });

    refresher.start(true);
    refresher.resume();

    expect(c.timeouts()).toBe(1);
    expect(c.coalesceDelay()).toBe(400);
  });
});

/**
 * `poke` is the signal a REMOTE source sends — a Realtime event, today. It differs from
 * every other signal in one way that matters: it can arrive while the surface is hidden,
 * because the socket does not care whether anyone is looking. These tests pin that a poke
 * can never wake a hidden surface, and can never arm the tick.
 */
describe("foregroundRefresh — poke (a remote source signalled a change)", () => {
  it("does nothing while the surface is hidden", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(false);
    refresher.poke();

    expect(c.timeouts()).toBe(0);
    expect(c.intervals()).toBe(0);
    expect(runs).toBe(0);
  });

  it("does nothing on a refresher nobody has started", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.poke();

    expect(c.timeouts()).toBe(0);
  });

  it("never arms the tick", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    // The shape of the real hazard: a poke delivered to a surface that HAS gone
    // hidden. Arming the tick here would leave it polling once a minute until
    // unmount, because `hide()` already ran for that transition and nothing will
    // call it again.
    refresher.start(true);
    refresher.hide();
    refresher.poke();

    expect(refresher.polling()).toBe(false);
    expect(c.intervals()).toBe(0);
    expect(c.timeouts()).toBe(0);
  });

  it("coalesces a burst into a single read", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 400,
    });

    refresher.start(true);
    refresher.poke();
    refresher.poke();
    refresher.poke();

    expect(c.timeouts()).toBe(1);
    c.fireTimeout();
    expect(runs).toBe(1);
  });

  it("shares one coalesce timer with resume, so a pair of signals is one read", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 400,
    });

    // Capacitor fires appStateChange AND visibilitychange on Android resume, and a
    // remote event often lands in the same window. One timer collapses all of them.
    refresher.start(true);
    refresher.poke();
    refresher.resume();

    expect(c.timeouts()).toBe(1);
    expect(c.intervals()).toBe(1);
    c.fireTimeout();
    expect(runs).toBe(1);
  });

  it("drops a replayed read when the surface goes hidden mid-flight", async () => {
    const c = createTestClock();
    let pending = deferred();
    let calls = 0;
    const refresher = createForegroundRefresher({
      run: () => {
        calls += 1;
        pending = deferred();
        return pending.promise;
      },
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.resume();
    c.fireTimeout();
    expect(calls).toBe(1);

    // A remote event arrives while that read is still out, and its coalesce window
    // elapses — which is what marks a replay as wanted (`execute` finds the run in
    // flight). THEN the user leaves, mid-flight.
    refresher.poke();
    c.fireTimeout();
    refresher.hide();

    pending.resolve();
    await flush();

    // Without the fix this is 2: the requested replay fires into a hidden surface
    // moments after it went away.
    expect(calls).toBe(1);
  });

  it("bounds a flood to one queued read, not one read per event", async () => {
    const c = createTestClock();
    let pending = deferred();
    let calls = 0;
    const refresher = createForegroundRefresher({
      run: () => {
        calls += 1;
        pending = deferred();
        return pending.promise;
      },
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.resume();
    c.fireTimeout();
    expect(calls).toBe(1);

    // A bulk admin update emits one event per row. Event volume must not become
    // read volume: the five pokes share one coalesce window (the first armed it,
    // the rest found it already armed), and that window elapses while the read is
    // still out — which asks for ONE replay, not five.
    for (let i = 0; i < 5; i += 1) refresher.poke();
    expect(c.timeouts()).toBe(1);

    c.fireTimeout();
    pending.resolve();
    await flush();

    expect(calls).toBe(2);
  });

  it("ignores a poke that arrives after stop()", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(true);
    refresher.stop();
    refresher.poke();

    expect(c.timeouts()).toBe(0);
    expect(c.intervals()).toBe(0);
  });
});

describe("foregroundRefresh — native resume coalescing", () => {
  it("collapses a visibility/resume pair into a single read", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 400,
    });

    // Android fires both of these on resume.
    refresher.resume();
    refresher.resume();
    refresher.resume();

    expect(c.timeouts()).toBe(1);

    c.fireTimeout();

    expect(runs).toBe(1);
  });

  it("arms the tick on resume as well as scheduling the immediate read", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.resume();

    expect(c.intervals()).toBe(1);
    expect(c.timeouts()).toBe(1);
  });
});

describe("foregroundRefresh — overlap and ordering", () => {
  it("never stacks a second run on top of one still in flight", async () => {
    const c = createTestClock();
    let pending = deferred();
    let calls = 0;
    const refresher = createForegroundRefresher({
      run: () => {
        calls += 1;
        pending = deferred();
        return pending.promise;
      },
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.resume();
    c.fireTimeout();
    expect(calls).toBe(1);

    // A tick and a resume arriving mid-flight must not start a second request.
    c.fireInterval();
    refresher.resume();
    c.fireTimeout();
    expect(calls).toBe(1);

    pending.resolve();
    await flush();
  });

  it("replays a signal that arrived mid-flight, so a resume is delayed and not lost", async () => {
    const c = createTestClock();
    let pending = deferred();
    let calls = 0;
    const refresher = createForegroundRefresher({
      run: () => {
        calls += 1;
        pending = deferred();
        return pending.promise;
      },
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.resume();
    c.fireTimeout();
    expect(calls).toBe(1);

    refresher.resume();
    c.fireTimeout();
    expect(calls).toBe(1);

    pending.resolve();
    await flush();

    expect(calls).toBe(2);
  });

  it("reports a thrown run instead of letting it escape, and keeps polling", async () => {
    const c = createTestClock();
    const errors: unknown[] = [];
    const refresher = createForegroundRefresher({
      run: () => {
        throw new Error("read failed");
      },
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
      onError: (error) => errors.push(error),
    });

    refresher.start(true);
    expect(() => c.fireInterval()).not.toThrow();
    await flush();

    expect(errors).toHaveLength(1);
    expect(refresher.polling()).toBe(true);
  });
});

describe("foregroundRefresh — teardown", () => {
  it("leaves no timer behind after stop()", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 400,
    });

    refresher.start(true);
    refresher.resume();

    expect(c.intervals()).toBe(1);
    expect(c.timeouts()).toBe(1);

    refresher.stop();

    expect(c.intervals()).toBe(0);
    expect(c.timeouts()).toBe(0);
    expect(refresher.busy()).toBe(false);
  });

  it("ignores signals that arrive after stop()", () => {
    const c = createTestClock();
    let runs = 0;
    const refresher = createForegroundRefresher({
      run: () => void (runs += 1),
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.stop();
    refresher.resume();
    refresher.start(true);

    expect(c.intervals()).toBe(0);
    expect(c.timeouts()).toBe(0);
    expect(runs).toBe(0);
  });

  it("is idempotent", () => {
    const c = createTestClock();
    const refresher = createForegroundRefresher({
      run: () => {},
      intervalMs: 60_000,
      clock: c.clock,
      coalesceMs: 0,
    });

    refresher.start(true);
    refresher.stop();
    refresher.stop();

    expect(c.intervals()).toBe(0);
  });
});
