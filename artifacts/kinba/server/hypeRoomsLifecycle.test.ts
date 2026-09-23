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
  canHostCancelScheduled,
  canHostEndRoom,
  canJoinRoomStatus,
  canLeaveMembership,
  canSendRoomMessage,
  computeEndsAt,
  decideJoinAction,
  decideRemoveMember,
  isEligibleRoomHost,
  isRoomHost,
  isValidDurationHours,
  matchesRoomListFilter,
  normalizeStartsAt,
  resolveMemberRole,
  resolveRoomLifecycle,
  ROOM_DURATION_HOURS,
  ROOM_MAX_LEAD_MS,
  ROOM_MESSAGE_MAX_LENGTH,
  validateRoomMessageBody,
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

describe("M2 member pure helpers", () => {
  it("allows join only for scheduled/live rooms", () => {
    expect(canJoinRoomStatus("scheduled")).toBe(true);
    expect(canJoinRoomStatus("live")).toBe(true);
    expect(canJoinRoomStatus("expired")).toBe(false);
    expect(canJoinRoomStatus("archived")).toBe(false);
  });

  it("resolves host vs member role from room hostId", () => {
    expect(resolveMemberRole(41, 41)).toBe("host");
    expect(resolveMemberRole(41, 99)).toBe("member");
  });

  it("decides join actions from membership + status", () => {
    const active = { leftAt: null, bannedAt: null };
    const left = { leftAt: new Date(), bannedAt: null };
    const banned = { leftAt: null, bannedAt: new Date() };

    expect(decideJoinAction(null, "live")).toBe("insert");
    expect(decideJoinAction(null, "scheduled")).toBe("insert");
    expect(decideJoinAction(active, "live")).toBe("reject_duplicate");
    expect(decideJoinAction(left, "live")).toBe("rejoin");
    expect(decideJoinAction(banned, "live")).toBe("reject_banned");
    expect(decideJoinAction(null, "expired")).toBe("reject_closed");
    expect(decideJoinAction(null, "archived")).toBe("reject_closed");
    expect(decideJoinAction(active, "expired")).toBe("reject_closed");
  });

  it("allows only non-host active members to leave", () => {
    const member = {
      id: 1,
      userId: 99,
      roomId: 7,
      role: "member" as const,
      joinedAt: new Date(),
      leftAt: null,
      bannedAt: null,
      removedBy: null,
    };
    const host = { ...member, userId: 41, role: "host" as const };
    const left = { ...member, leftAt: new Date() };

    expect(canLeaveMembership(member, 41)).toBe(true);
    expect(canLeaveMembership(host, 41)).toBe(false);
    expect(canLeaveMembership({ ...member, userId: 41, role: "member" as const }, 41)).toBe(
      false
    );
    expect(canLeaveMembership(left, 41)).toBe(false);
    expect(canLeaveMembership(null, 41)).toBe(false);
  });
});

describe("M4 message pure helpers", () => {
  const active = { leftAt: null, bannedAt: null };
  const left = { leftAt: new Date(), bannedAt: null };
  const banned = { leftAt: null, bannedAt: new Date() };

  it("validates and trims message bodies", () => {
    expect(validateRoomMessageBody("  hello  ")).toBe("hello");
    expect(validateRoomMessageBody("x".repeat(ROOM_MESSAGE_MAX_LENGTH))).toHaveLength(
      ROOM_MESSAGE_MAX_LENGTH
    );
    expect(() => validateRoomMessageBody("")).toThrow(/required/i);
    expect(() => validateRoomMessageBody("   ")).toThrow(/required/i);
    expect(() =>
      validateRoomMessageBody("x".repeat(ROOM_MESSAGE_MAX_LENGTH + 1))
    ).toThrow(/at most/i);
  });

  it("allows send only when room is live AND membership is active (A2/A5)", () => {
    expect(canSendRoomMessage("live", active)).toBe(true);
    expect(canSendRoomMessage("live", left)).toBe(false);
    expect(canSendRoomMessage("live", banned)).toBe(false);
    expect(canSendRoomMessage("live", null)).toBe(false);
    expect(canSendRoomMessage("scheduled", active)).toBe(false);
    expect(canSendRoomMessage("expired", active)).toBe(false);
    expect(canSendRoomMessage("archived", active)).toBe(false);
  });

  it("treats host like any member for send — no host bypass (A2)", () => {
    // Host without active membership row cannot send.
    expect(canSendRoomMessage("live", null)).toBe(false);
    expect(canSendRoomMessage("live", left)).toBe(false);
    // Host with active membership can send only while live.
    expect(canSendRoomMessage("live", active)).toBe(true);
    expect(canSendRoomMessage("expired", active)).toBe(false);
  });

  it("host identity is hostId comparison", () => {
    expect(isRoomHost(41, 41)).toBe(true);
    expect(isRoomHost(41, 99)).toBe(false);
  });

  it("host end only allowed from live (A3)", () => {
    expect(canHostEndRoom("live")).toBe(true);
    expect(canHostEndRoom("scheduled")).toBe(false);
    expect(canHostEndRoom("expired")).toBe(false);
    expect(canHostEndRoom("archived")).toBe(false);
    // No scheduled cancel transition invented.
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "scheduled", "expired")).toBe(
      false
    );
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "live", "expired")).toBe(true);
  });

  it("decides removeMember with host-only authorization", () => {
    const target = {
      userId: 99,
      leftAt: null,
      bannedAt: null,
      role: "member" as const,
    };
    expect(decideRemoveMember(41, 41, target)).toBe("ok");
    expect(decideRemoveMember(41, 99, target)).toBe("not_host");
    expect(decideRemoveMember(41, 41, null)).toBe("target_missing");
    expect(
      decideRemoveMember(41, 41, {
        ...target,
        userId: 41,
        role: "host" as const,
      })
    ).toBe("cannot_remove_host");
    expect(
      decideRemoveMember(41, 41, { ...target, role: "host" as const })
    ).toBe("cannot_remove_host");
    expect(
      decideRemoveMember(41, 41, { ...target, leftAt: new Date() })
    ).toBe("target_already_left");
  });
});

describe("M6 — host scheduled cancel pure helpers", () => {
  it("allows cancel only from scheduled (§8.4 / §19.1)", () => {
    expect(canHostCancelScheduled("scheduled")).toBe(true);
    expect(canHostCancelScheduled("live")).toBe(false);
    expect(canHostCancelScheduled("expired")).toBe(false);
    expect(canHostCancelScheduled("archived")).toBe(false);
  });

  it("scheduled → archived is a legal map transition", () => {
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "scheduled", "archived")).toBe(
      true
    );
    expect(() =>
      assertRoomTransition("scheduled", "archived")
    ).not.toThrow();
  });

  it("does not invent illegal cancel transitions", () => {
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "live", "archived")).toBe(
      false
    );
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "expired", "live")).toBe(
      false
    );
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "archived", "scheduled")).toBe(
      false
    );
    expect(() => assertRoomTransition("live", "archived")).toThrow();
  });

  it("expired → archived remains legal for archive policy/admin path", () => {
    expect(canTransition(HYPE_ROOM_TRANSITIONS, "expired", "archived")).toBe(
      true
    );
    expect(() => assertRoomTransition("expired", "archived")).not.toThrow();
  });
});

describe("M6 — list filters (§18.3)", () => {
  const scheduled = { status: "scheduled" as const, hostId: 1 };
  const live = { status: "live" as const, hostId: 1 };
  const expired = { status: "expired" as const, hostId: 1 };
  const archived = { status: "archived" as const, hostId: 1 };
  const other = { status: "live" as const, hostId: 2 };

  it("default (no filter) preserves M1 active scheduled+live set", () => {
    expect(matchesRoomListFilter(scheduled, undefined, 1)).toBe(true);
    expect(matchesRoomListFilter(live, undefined, 1)).toBe(true);
    expect(matchesRoomListFilter(expired, undefined, 1)).toBe(false);
    expect(matchesRoomListFilter(archived, undefined, 1)).toBe(false);
  });

  it("live filter keeps only live rooms", () => {
    expect(matchesRoomListFilter(live, "live", 1)).toBe(true);
    expect(matchesRoomListFilter(scheduled, "live", 1)).toBe(false);
    expect(matchesRoomListFilter(expired, "live", 1)).toBe(false);
  });

  it("upcoming filter keeps only scheduled rooms", () => {
    expect(matchesRoomListFilter(scheduled, "upcoming", 1)).toBe(true);
    expect(matchesRoomListFilter(live, "upcoming", 1)).toBe(false);
    expect(matchesRoomListFilter(expired, "upcoming", 1)).toBe(false);
  });

  it("mine filter is host ownership only (parallel to drops mine)", () => {
    expect(matchesRoomListFilter(scheduled, "mine", 1)).toBe(true);
    expect(matchesRoomListFilter(live, "mine", 1)).toBe(true);
    expect(matchesRoomListFilter(expired, "mine", 1)).toBe(true);
    expect(matchesRoomListFilter(other, "mine", 1)).toBe(false);
    expect(matchesRoomListFilter(scheduled, "mine", 2)).toBe(false);
    expect(matchesRoomListFilter(scheduled, "mine", null)).toBe(false);
    expect(matchesRoomListFilter(scheduled, "mine", undefined)).toBe(false);
  });
});

describe("M6 — host/create eligibility (§16 default verified company/creator)", () => {
  const matrix: Array<{
    profile: { accountType: string; verificationStatus: string } | null;
    expected: boolean;
    label: string;
  }> = [
    { profile: null, expected: false, label: "missing profile" },
    {
      profile: { accountType: "member", verificationStatus: "none" },
      expected: false,
      label: "member",
    },
    {
      profile: { accountType: "member", verificationStatus: "business_verified" },
      expected: false,
      label: "member business_verified",
    },
    {
      profile: { accountType: "creator", verificationStatus: "none" },
      expected: false,
      label: "creator none",
    },
    {
      profile: { accountType: "creator", verificationStatus: "pending" },
      expected: false,
      label: "creator pending",
    },
    {
      profile: { accountType: "creator", verificationStatus: "eligible" },
      expected: false,
      label: "creator eligible",
    },
    {
      profile: { accountType: "creator", verificationStatus: "verified" },
      expected: true,
      label: "creator verified",
    },
    {
      profile: { accountType: "creator", verificationStatus: "business_verified" },
      expected: true,
      label: "creator business_verified",
    },
    {
      profile: { accountType: "creator", verificationStatus: "official" },
      expected: true,
      label: "creator official",
    },
    {
      profile: { accountType: "company", verificationStatus: "none" },
      expected: false,
      label: "company none",
    },
    {
      profile: { accountType: "company", verificationStatus: "pending" },
      expected: false,
      label: "company pending",
    },
    {
      profile: { accountType: "company", verificationStatus: "verified" },
      expected: false,
      label: "company verified (legacy not business/official)",
    },
    {
      profile: { accountType: "company", verificationStatus: "business_verified" },
      expected: true,
      label: "company business_verified",
    },
    {
      profile: { accountType: "company", verificationStatus: "official" },
      expected: true,
      label: "company official",
    },
  ];

  it("matches the §16 eligibility matrix", () => {
    for (const row of matrix) {
      expect(
        isEligibleRoomHost(row.profile),
        `${row.label} → ${row.expected}`
      ).toBe(row.expected);
    }
  });
});
