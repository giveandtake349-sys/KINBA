/**
 * Pool lifecycle regression tests for server/db.ts.
 *
 * These cover the concurrency contract of getDb()/withDb()/invalidateDbPool():
 * single-flight creation, ownership-safe retirement, and the bounded retry.
 * The pg/drizzle/databaseConfig/storage boundaries are replaced with fakes so
 * the real module state machine runs against a controllable Pool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const pools: Array<{
    options: unknown;
    queryCalls: string[];
    endCalls: number;
    ended: boolean;
    dead: boolean;
    on: (event: string, listener: (payload: unknown) => void) => void;
    listenerCount: (event: string) => number;
    emit: (event: string, payload: unknown) => void;
    query: (text: string) => Promise<{ rows: unknown[] }>;
    end: () => Promise<void>;
  }> = [];

  class FakePool {
    readonly options: unknown;
    readonly queryCalls: string[] = [];
    endCalls = 0;
    ended = false;
    // Simulates a pool whose connections are unusable (probe must fail).
    dead = false;
    private readonly listeners = new Map<string, Array<(payload: unknown) => void>>();

    constructor(options: unknown) {
      this.options = options;
      pools.push(this);
    }

    on(event: string, listener: (payload: unknown) => void): void {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
    }

    listenerCount(event: string): number {
      return this.listeners.get(event)?.length ?? 0;
    }

    emit(event: string, payload: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
    }

    async query(text: string): Promise<{ rows: unknown[] }> {
      this.queryCalls.push(text);
      if (this.dead || this.ended) {
        throw new Error("Cannot use a pool after calling end on the pool");
      }
      return { rows: [] };
    }

    end(): Promise<void> {
      this.endCalls += 1;
      if (this.endCalls > 1) {
        return Promise.reject(new Error("Called end on pool more than once"));
      }
      this.ended = true;
      return Promise.resolve();
    }
  }

  return { pools, FakePool, state: { url: "postgresql://fake" as string | null } };
});

vi.mock("pg", () => ({ Pool: h.FakePool }));
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: (config: { client: unknown }) => ({ $client: config.client }),
}));
vi.mock("./databaseConfig", () => ({
  resolvePostgresDatabaseUrl: () => h.state.url,
}));
vi.mock("./storage", () => ({ storageDelete: vi.fn() }));

import * as db from "./db";

type PoolInstance = InstanceType<typeof h.FakePool>;

const poolOf = (instance: unknown): PoolInstance =>
  (instance as { $client: PoolInstance }).$client;

function connectionError(code: string): Error & { code: string } {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

beforeEach(() => {
  // The module holds singleton pool state; drain it before every case so each
  // test starts from a cold getDb().
  db.invalidateDbPool();
  h.pools.length = 0;
  h.state.url = "postgresql://fake";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server/db — single-flight pool creation", () => {
  it("creates exactly one Pool for concurrent cold getDb() calls", async () => {
    await Promise.all([db.getDb(), db.getDb(), db.getDb(), db.getDb(), db.getDb()]);
    expect(h.pools).toHaveLength(1);
  });

  it("gives every concurrent cold caller the same DB instance", async () => {
    const [a, b, c] = await Promise.all([db.getDb(), db.getDb(), db.getDb()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(h.pools).toHaveLength(1);
  });

  it("issues no health-check query on the warm path", async () => {
    const first = await db.getDb();
    expect(h.pools[0].queryCalls).toEqual(["SELECT 1"]);

    const before = h.pools[0].queryCalls.length;
    for (let i = 0; i < 25; i += 1) {
      expect(await db.getDb()).toBe(first);
    }
    expect(h.pools[0].queryCalls.length).toBe(before);
    expect(h.pools).toHaveLength(1);
  });

  it("never returns a different or null pool than the one it observed", async () => {
    const first = await db.getDb();

    // The warm path must resolve without awaiting anything: a probe-based
    // implementation would observe the cleared global and return null here.
    const pending = db.getDb();
    db.invalidateDbPool();
    const resolved = await pending;

    expect(resolved).toBe(first);
    expect(resolved).not.toBeNull();
    expect(h.pools[0].queryCalls).toEqual(["SELECT 1"]);
  });
});

describe("server/db — ownership-safe retirement", () => {
  it("keeps _db/_pool consistent across interleaved retirement and publication", async () => {
    await db.getDb();
    const warm = db.getDb();
    db.invalidateDbPool();
    const cold = db.getDb();

    const [fromWarm, fromCold] = await Promise.all([warm, cold]);

    expect(poolOf(fromWarm)).toBe(h.pools[0]);
    expect(poolOf(fromCold)).toBe(h.pools[1]);
    expect(h.pools[0].endCalls).toBe(1);
    expect(h.pools[1].endCalls).toBe(0);
    expect(poolOf(await db.getDb())).toBe(h.pools[1]);
    expect(h.pools).toHaveLength(2);
  });

  it("cannot end or unregister a newer pool when an old operation fails", async () => {
    await db.getDb();
    const oldPool = h.pools[0];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      let calls = 0;
      const out = await db.withDb(async (used) => {
        calls += 1;
        if (calls === 1) {
          expect(poolOf(used)).toBe(oldPool);
          // Another request retires the old pool and publishes a new one while
          // this operation is still running.
          db.invalidateDbPool();
          const newer = await db.getDb();
          expect(poolOf(newer)).toBe(h.pools[1]);
          expect(h.pools).toHaveLength(2);
          throw new Error("Cannot use a pool after calling end on the pool");
        }
        expect(poolOf(used)).toBe(h.pools[1]);
        return "recovered";
      });

      expect(out).toBe("recovered");
      expect(calls).toBe(2);
      // The probe fails on the old pool, so retirePool() targets that pool
      // again: the second end() rejection is swallowed, and the newer pool is
      // neither ended nor cleared from the module globals.
      expect(oldPool.endCalls).toBe(2);
      expect(h.pools[1].endCalls).toBe(0);
      expect(h.pools[1].ended).toBe(false);
      expect(poolOf(await db.getDb())).toBe(h.pools[1]);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("server/db — withDb retry policy", () => {
  it("retries once when the pool is unusable and replaces only that pool", async () => {
    await db.getDb();
    h.pools[0].dead = true;

    let calls = 0;
    const out = await db.withDb(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Cannot use a pool after calling end on the pool");
      return "ok";
    });

    expect(out).toBe("ok");
    expect(calls).toBe(2);
    expect(h.pools).toHaveLength(2);
    expect(h.pools[0].endCalls).toBe(1);
    expect(h.pools[1].dead).toBe(false);
    expect(poolOf(await db.getDb())).toBe(h.pools[1]);
  });

  it("does not retire a healthy pool after a transient query error", async () => {
    await db.getDb();

    let calls = 0;
    const out = await db.withDb(async () => {
      calls += 1;
      if (calls === 1) throw connectionError("ECONNRESET");
      return "ok";
    });

    expect(out).toBe("ok");
    expect(calls).toBe(2);
    expect(h.pools).toHaveLength(1);
    expect(h.pools[0].endCalls).toBe(0);
    expect(h.pools[0].ended).toBe(false);
    // creation probe + failure-path probe only
    expect(h.pools[0].queryCalls).toEqual(["SELECT 1", "SELECT 1"]);
  });

  it("does not retry application errors", async () => {
    await db.getDb();

    let messageCalls = 0;
    await expect(
      db.withDb(async () => {
        messageCalls += 1;
        throw new Error("Conversation not found.");
      })
    ).rejects.toThrow("Conversation not found.");
    expect(messageCalls).toBe(1);

    let pgCodeCalls = 0;
    await expect(
      db.withDb(async () => {
        pgCodeCalls += 1;
        throw Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
        });
      })
    ).rejects.toThrow("duplicate key value violates unique constraint");
    expect(pgCodeCalls).toBe(1);

    expect(h.pools).toHaveLength(1);
    expect(h.pools[0].endCalls).toBe(0);
  });

  it("bounds the retry to exactly once while the pool stays healthy", async () => {
    await db.getDb();

    let calls = 0;
    await expect(
      db.withDb(async () => {
        calls += 1;
        throw connectionError("ECONNREFUSED");
      })
    ).rejects.toThrow("simulated ECONNREFUSED");
    expect(calls).toBe(2);
    expect(h.pools).toHaveLength(1);
    expect(h.pools[0].endCalls).toBe(0);
  });

  it("bounds the retry to exactly once even when the pool must be replaced", async () => {
    await db.getDb();
    h.pools[0].dead = true;

    let calls = 0;
    await expect(
      db.withDb(async () => {
        calls += 1;
        throw new Error("timeout exceeded when trying to connect");
      })
    ).rejects.toThrow("timeout exceeded when trying to connect");
    expect(calls).toBe(2);
    expect(h.pools).toHaveLength(2);
    expect(h.pools[0].endCalls).toBe(1);
  });

  it("propagates a getDb() failure during retry", async () => {
    h.state.url = null;

    let calls = 0;
    await expect(
      db.withDb(async () => {
        calls += 1;
        return "never";
      })
    ).rejects.toThrow("PostgreSQL is not configured");
    expect(calls).toBe(0);
  });

  it("propagates a getDb() failure raised while preparing the retry", async () => {
    await db.getDb();
    // The pool is proven unusable, but no replacement can be created.
    h.pools[0].dead = true;
    h.state.url = null;

    let calls = 0;
    await expect(
      db.withDb(async () => {
        calls += 1;
        throw new Error("Cannot use a pool after calling end on the pool");
      })
    ).rejects.toThrow("PostgreSQL is not configured");

    expect(calls).toBe(1);
    expect(h.pools[0].endCalls).toBe(1);
    expect(h.pools).toHaveLength(1);
  });
});

describe("server/db — configuration and lifecycle listeners", () => {
  it("rejects getDb() when PostgreSQL is not configured", async () => {
    h.state.url = null;

    await expect(db.getDb()).rejects.toThrow("PostgreSQL is not configured");
    expect(h.pools).toHaveLength(0);

    expect(() => db.invalidateDbPool()).not.toThrow();
    await expect(db.getDb()).rejects.toThrow("PostgreSQL is not configured");
  });

  it("attaches an error listener so pool 'error' events are never unhandled", async () => {
    await db.getDb();
    const pool = h.pools[0];

    expect(pool.listenerCount("error")).toBe(1);
    expect(() => pool.emit("error", new Error("idle client died"))).not.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      "[Database] Pool error:",
      "idle client died"
    );
  });
});
