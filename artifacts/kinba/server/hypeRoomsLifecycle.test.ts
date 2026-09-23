/**
 * Phase 2 M1 — pure temporary-room lifecycle tests (no DB).
 * Durations, expiry math, transitions, illegal moves.
 */
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  HYPE_ROOM_TRANSITIONS,
  HYPE_ROOM_STATUSES,
  resolveHypeRoomStatus,
} from "@shared/stateMachines";
import {
  assertRoomTransition,
  assertValidDurationHours,
  computeEndsAt,
  isValidDurationHours,
  normalizeStartsAt,
  resolveRoomLifecycle,
  ROOM_DURATION_HOURS,
  ROOM_MAX_LEAD_MS,
} from "./hypeRooms";

const HOUR_MS = 60 * 60 * 1000;

describe("temporary room durations", () => {
  it("accepts only 4, 6, 12, and 24 hour rooms", () => {
    for (const h of [4, 6, 12, 24]) {
      expect(isValidDurationHours(h)).toBe(true);
      expect(assertValidDurationHours(h)).toBe(h);
    }
    for (const h of [1, 3, 5, 7, 8, 18, 48, 0, -4, 2.5, Number.NaN]) {
      expect(isValidDurationHours(h)).toBe(false);
      expect(() => assertValidDurationHours(h)).toThrow(/duration/i);
    }
  });

  it("matches the product duration set exactly", () => {
    expect([...ROOM_DURATION_HOURS]).toEqual([4, 6, 12, 24]);
  });
});

describe("expiry calculation", () => {
  const start = new Date("2026-09-23T12:00:00.000Z");

  it("computes endsAt = startsAt + durationHours for each allowed duration", () => {
    expect(computeEndsAt(start, 4).toISOString()).toBe(
      "2026-09-23T16:00:00.000Z"
    );
    expect(computeEndsAt(start, 6).toISOString()).toBe(
      "2026-09-23T18:00:00.000Z"
    );
    expect(computeEndsAt(start, 12).toISOString()).toBe(
      "2026-09-24T00:00:00.000Z"
    );
    expect(computeEndsAt(start, 24).toISOString()).toBe(
      "2026-09-24T12:00:00.000Z"
    );
  });

  it("rejects invalid durations during endsAt computation", () => {
    expect(() => computeEndsAt(start, 5)).toThrow();
  });

  it("defaults startsAt to now and enforces 7-day lead window", () => {
    const now = new Date("2026-09-23T10:00:00.000Z");
    expect(normalizeStartsAt(null, now).getTime()).toBe(now.getTime());
    expect(
      normalizeStartsAt(new Date(now.getTime() + ROOM_MAX_LEAD_MS), now)
    ).toBeInstanceOf(Date);
    expect(() =>
      normalizeStartsAt(new Date(now.getTime() + ROOM_MAX_LEAD_MS + 1), now)
    ).toThrow(/7 days/);
    expect(() =>
      normalizeStartsAt(new Date(now.getTime() - 60_000), now)
    ).toThrow(/future/);
  });
});

describe("lifecycle transitions", () => {
  it("defines the Phase 1 temporary-room transition map", () => {
    expect(HYPE_ROOM_TRANSITIONS.scheduled).toEqual(["live", "archived"]);
    expect(HYPE_ROOM_TRANSITIONS.live).toEqual(["expired"]);
    expect(HYPE_ROOM_TRANSITIONS.expired).toEqual(["archived"]);
    expect(HYPE_ROOM_TRANSITIONS.archived).toEqual([]);
  });

  it("advances scheduled → live at startsAt", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    expect(
      resolveHypeRoomStatus(
        "scheduled",
        startsAt,
        endsAt,
        new Date("2026-09-23T11:59:59.000Z")
      )
    ).toBe("scheduled");
    expect(
      resolveHypeRoomStatus(
        "scheduled",
        startsAt,
        endsAt,
        new Date("2026-09-23T12:00:00.000Z")
      )
    ).toBe("live");
  });

  it("advances live → expired when endsAt is reached (deterministic)", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 6 * HOUR_MS);
    expect(
      resolveHypeRoomStatus(
        "live",
        startsAt,
        endsAt,
        new Date("2026-09-23T17:59:59.000Z")
      )
    ).toBe("live");
    expect(
      resolveHypeRoomStatus(
        "live",
        startsAt,
        endsAt,
        new Date("2026-09-23T18:00:00.000Z")
      )
    ).toBe("expired");
  });

  it("collapses scheduled past endsAt directly to expired", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    expect(
      resolveHypeRoomStatus(
        "scheduled",
        startsAt,
        endsAt,
        new Date("2026-09-23T20:00:00.000Z")
      )
    ).toBe("expired");
  });

  it("does not leave terminal archived/expired states via time", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const later = new Date("2026-09-24T12:00:00.000Z");
    expect(resolveHypeRoomStatus("archived", startsAt, endsAt, later)).toBe(
      "archived"
    );
    expect(resolveHypeRoomStatus("expired", startsAt, endsAt, later)).toBe(
      "expired"
    );
  });
});

describe("invalid transition rejection", () => {
  it("rejects reviving an expired room through a normal mutation", () => {
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "expired", "live")).toBe(false);
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "expired", "scheduled")).toBe(
      false
    );
    expect(() =>
      assertRoomTransition("expired", "live")
    ).toThrow(/Invalid hype room transition/);
    expect(() =>
      assertTransition(HYPE_ROOM_TRANSITIONS, "expired", "live", "hype room")
    ).toThrow(/expired → live/);
  });

  it("rejects other illegal moves", () => {
    for (const [from, to] of [
      ["live", "scheduled"],
      ["live", "archived"],
      ["archived", "live"],
      ["archived", "scheduled"],
      ["scheduled", "expired"],
      ["scheduled", "live"], // legal only via time resolver — manual map check:
    ] as const) {
      // scheduled→live is legal in the map; skip negative assert for it
      if (from === "scheduled" && to === "live") {
        expect(canTransition(HYPE_ROOM_TRANSITIONS, from, to)).toBe(true);
        continue;
      }
      // scheduled→expired is legal only via time resolver, not in map
      if (from === "scheduled" && to === "expired") {
        expect(canTransition(HYPE_ROOM_TRANSITIONS, from, to)).toBe(false);
        expect(() => assertRoomTransition(from, to)).toThrow();
        continue;
      }
      if (from === "live" && to === "archived") {
        // live→archived not in map
        expect(canTransition(HYPE_ROOM_TRANSITIONS, from, to)).toBe(false);
        expect(() => assertRoomTransition(from, to)).toThrow();
        continue;
      }
      expect(canTransition(HYPE_ROOM_TRANSITIONS, from, to)).toBe(false);
      expect(() => assertRoomTransition(from, to)).toThrow();
    }
  });

  it("resolveRoomLifecycle never returns a non-map successor", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const cases = [
      {
        status: "scheduled" as const,
        now: new Date("2026-09-23T13:00:00.000Z"),
        expect: "live",
      },
      {
        status: "live" as const,
        now: new Date("2026-09-23T17:00:00.000Z"),
        expect: "expired",
      },
      {
        status: "expired" as const,
        now: new Date("2026-09-23T17:00:00.000Z"),
        expect: "expired",
      },
      {
        status: "archived" as const,
        now: new Date("2026-09-23T17:00:00.000Z"),
        expect: "archived",
      },
    ];
    for (const c of cases) {
      const result = resolveRoomLifecycle(
        { status: c.status, startsAt, endsAt },
        c.now
      );
      expect(result.status).toBe(c.expect);
      if (result.changed) {
        expect(
          canTransition(HYPE_ROOM_TRANSITIONS, c.status, result.status)
        ).toBe(true);
      }
    }
    // Expired room past endsAt stays expired (no extend/revive).
    const revived = resolveRoomLifecycle(
      { status: "expired", startsAt, endsAt },
      new Date("2026-09-25T00:00:00.000Z")
    );
    expect(revived.status).toBe("expired");
    expect(revived.changed).toBe(false);
  });

  it("collapses overdue scheduled room via resolveRoomLifecycle without map assert", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const result = resolveRoomLifecycle(
      { status: "scheduled", startsAt, endsAt },
      new Date("2026-09-23T20:00:00.000Z")
    );
    expect(result.status).toBe("expired");
    expect(result.changed).toBe(true);
    expect(result.expiredAt).toBeInstanceOf(Date);
  });

  it("marks expiredAt when status first becomes expired", () => {
    const startsAt = new Date("2026-09-23T12:00:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const now = new Date("2026-09-23T17:00:00.000Z");
    const result = resolveRoomLifecycle(
      { status: "live", startsAt, endsAt },
      now
    );
    expect(result.status).toBe("expired");
    expect(result.changed).toBe(true);
    expect(result.expiredAt?.getTime()).toBe(now.getTime());
  });

  it("exposes all four statuses", () => {
    expect([...HYPE_ROOM_STATUSES]).toEqual([
      "scheduled",
      "live",
      "expired",
      "archived",
    ]);
  });
});
