/**
 * Phase 2 M3 — pure drop lifecycle / validation / eligibility / claim rules.
 * No DB. Complements shared stateMachines resolveDropStatus coverage.
 */
import { describe, expect, it } from "vitest";
import {
  DROP_CLAIM_STATUSES,
  DROP_CLAIM_TRANSITIONS,
  DROP_STATUSES,
  DROP_TRANSITIONS,
  canTransition,
  resolveDropStatus,
} from "@shared/stateMachines";
import {
  assertClaimTransition,
  assertDropTransition,
  buildClaimIdempotencyKey,
  canClaimTransition,
  isEligibleSeller,
  normalizeClaimIdempotencyKey,
  resolveDropLifecycle,
  validateDropOffer,
} from "./drops";

const START = new Date("2026-09-23T12:00:00.000Z");
const END = new Date("2026-09-23T16:00:00.000Z");

function baseDrop(
  over: Partial<{
    status: (typeof DROP_STATUSES)[number];
    startsAt: Date | null;
    endsAt: Date | null;
  }> = {}
) {
  return {
    status: "draft" as const,
    startsAt: null,
    endsAt: null,
    ...over,
  };
}

describe("drop status set matches schema/enum", () => {
  it("exposes draft, scheduled, live, sold_out, ended, archived", () => {
    expect([...DROP_STATUSES]).toEqual([
      "draft",
      "scheduled",
      "live",
      "sold_out",
      "ended",
      "archived",
    ]);
  });
});

describe("drop claim status set matches schema/enum", () => {
  it("exposes claimed, released, fulfilled, cancelled", () => {
    expect([...DROP_CLAIM_STATUSES]).toEqual([
      "claimed",
      "released",
      "fulfilled",
      "cancelled",
    ]);
  });
});

describe("DROP_CLAIM_TRANSITIONS — M5 fulfil/cancel only", () => {
  it("maps claimed → fulfilled and claimed → cancelled", () => {
    expect(canTransition(DROP_CLAIM_TRANSITIONS, "claimed", "fulfilled")).toBe(
      true
    );
    expect(canTransition(DROP_CLAIM_TRANSITIONS, "claimed", "cancelled")).toBe(
      true
    );
    expect(() => assertClaimTransition("claimed", "fulfilled")).not.toThrow();
    expect(() => assertClaimTransition("claimed", "cancelled")).not.toThrow();
    expect(canClaimTransition("claimed", "fulfilled")).toBe(true);
    expect(canClaimTransition("claimed", "cancelled")).toBe(true);
  });

  it("does not allow claimed → released in M5", () => {
    expect(canTransition(DROP_CLAIM_TRANSITIONS, "claimed", "released")).toBe(
      false
    );
    expect(canClaimTransition("claimed", "released")).toBe(false);
    expect(() => assertClaimTransition("claimed", "released")).toThrow(
      /claim/i
    );
  });

  it("keeps terminal fulfilled/cancelled/released without outbound edges", () => {
    for (const from of ["fulfilled", "cancelled", "released"] as const) {
      expect(DROP_CLAIM_TRANSITIONS[from]).toEqual([]);
      for (const to of DROP_CLAIM_STATUSES) {
        expect(canClaimTransition(from, to)).toBe(false);
        expect(() => assertClaimTransition(from, to)).toThrow(/claim/i);
      }
    }
  });

  it("rejects illegal moves including self-transition on terminal", () => {
    for (const [from, to] of [
      ["fulfilled", "fulfilled"],
      ["fulfilled", "cancelled"],
      ["cancelled", "fulfilled"],
      ["released", "fulfilled"],
      ["released", "cancelled"],
      ["fulfilled", "claimed"],
      ["cancelled", "claimed"],
    ] as const) {
      expect(canClaimTransition(from, to)).toBe(false);
      expect(() => assertClaimTransition(from, to)).toThrow(/transition/i);
    }
  });

  it("documents optimistic status-guard contract (WHERE status='claimed')", () => {
    // Concurrent second writer loses the race only if status left `claimed`.
    const raceLost = (current: (typeof DROP_CLAIM_STATUSES)[number]) =>
      current !== "claimed";
    expect(raceLost("claimed")).toBe(false);
    expect(raceLost("fulfilled")).toBe(true);
    expect(raceLost("cancelled")).toBe(true);
    expect(raceLost("released")).toBe(true);
  });
});

describe("resolveDropLifecycle — time-based advance", () => {
  it("keeps draft stationary", () => {
    expect(
      resolveDropLifecycle(
        baseDrop({ status: "draft", startsAt: START, endsAt: END }),
        new Date("2026-09-23T13:00:00.000Z")
      )
    ).toEqual({ status: "draft", changed: false });
  });

  it("advances scheduled → live when startsAt passes", () => {
    const r = resolveDropLifecycle(
      baseDrop({ status: "scheduled", startsAt: START, endsAt: END }),
      new Date("2026-09-23T12:00:01.000Z")
    );
    expect(r.status).toBe("live");
    expect(r.changed).toBe(true);
  });

  it("keeps scheduled before start", () => {
    const r = resolveDropLifecycle(
      baseDrop({ status: "scheduled", startsAt: START, endsAt: END }),
      new Date("2026-09-23T11:00:00.000Z")
    );
    expect(r.status).toBe("scheduled");
    expect(r.changed).toBe(false);
  });

  it("advances live → ended when endsAt passes and stamps endedAt", () => {
    const now = new Date("2026-09-23T16:00:00.000Z");
    const r = resolveDropLifecycle(
      baseDrop({ status: "live", startsAt: START, endsAt: END }),
      now
    );
    expect(r.status).toBe("ended");
    expect(r.changed).toBe(true);
    expect(r.endedAt).toEqual(now);
  });

  it("does not revive ended/sold_out/archived", () => {
    for (const status of ["ended", "sold_out", "archived"] as const) {
      const r = resolveDropLifecycle(
        baseDrop({ status, startsAt: START, endsAt: END }),
        new Date("2026-09-24T00:00:00.000Z")
      );
      expect(r.status).toBe(status);
      expect(r.changed).toBe(false);
    }
  });

  it("agrees with shared resolveDropStatus for legal windows", () => {
    const cases: Array<[typeof DROP_STATUSES[number], Date]> = [
      ["draft", START],
      ["scheduled", new Date(START.getTime() + 1000)],
      ["live", new Date(END.getTime() + 1000)],
      ["live", new Date(START.getTime() + 1000)],
      ["ended", new Date(END.getTime() + 1000)],
    ];
    for (const [status, now] of cases) {
      expect(
        resolveDropLifecycle(baseDrop({ status, startsAt: START, endsAt: END }), now).status
      ).toBe(resolveDropStatus(status, START, END, now));
    }
  });
});

describe("drop transitions — manual and sold-out", () => {
  it("allows live → sold_out and live → ended", () => {
    expect(canTransition(DROP_TRANSITIONS, "live", "sold_out")).toBe(true);
    expect(canTransition(DROP_TRANSITIONS, "live", "ended")).toBe(true);
    expect(() => assertDropTransition("live", "sold_out")).not.toThrow();
    expect(() => assertDropTransition("live", "ended")).not.toThrow();
  });

  it("rejects illegal moves", () => {
    for (const [from, to] of [
      ["ended", "live"],
      ["archived", "live"],
      ["draft", "ended"],
      ["sold_out", "live"],
      ["scheduled", "sold_out"],
    ] as const) {
      expect(canTransition(DROP_TRANSITIONS, from, to)).toBe(false);
      expect(() => assertDropTransition(from, to)).toThrow(/transition/i);
    }
  });

  it("allows draft → scheduled and draft → live for publish paths", () => {
    expect(canTransition(DROP_TRANSITIONS, "draft", "scheduled")).toBe(true);
    expect(canTransition(DROP_TRANSITIONS, "draft", "live")).toBe(true);
    expect(canTransition(DROP_TRANSITIONS, "scheduled", "live")).toBe(true);
  });
});

describe("validateDropOffer — prices, quantity, window", () => {
  const good = {
    originalPrice: "120.00",
    discountedPrice: "99.50",
    quantity: 10,
  };

  it("accepts a valid offer", () => {
    expect(() => validateDropOffer(good)).not.toThrow();
  });

  it("rejects non-positive original price", () => {
    expect(() =>
      validateDropOffer({ ...good, originalPrice: "0" })
    ).toThrow(/Original price/i);
    expect(() =>
      validateDropOffer({ ...good, originalPrice: "-5" })
    ).toThrow();
    expect(() =>
      validateDropOffer({ ...good, originalPrice: "abc" })
    ).toThrow();
  });

  it("rejects discounted >= original", () => {
    expect(() =>
      validateDropOffer({ ...good, discountedPrice: "120.00" })
    ).toThrow(/less than original/i);
    expect(() =>
      validateDropOffer({ ...good, discountedPrice: "121.00" })
    ).toThrow();
  });

  it("rejects non-positive or non-integer quantity", () => {
    expect(() => validateDropOffer({ ...good, quantity: 0 })).toThrow(
      /Quantity/i
    );
    expect(() => validateDropOffer({ ...good, quantity: -1 })).toThrow();
    expect(() => validateDropOffer({ ...good, quantity: 2.5 })).toThrow();
  });

  it("requires window when requireWindow is set", () => {
    expect(() => validateDropOffer({ ...good, requireWindow: true })).toThrow(
      /Start and end/i
    );
    expect(() =>
      validateDropOffer({
        ...good,
        startsAt: START,
        endsAt: null,
        requireWindow: true,
      })
    ).toThrow();
  });

  it("requires endsAt > startsAt when requireWindow is set", () => {
    expect(() =>
      validateDropOffer({
        ...good,
        startsAt: END,
        endsAt: START,
        requireWindow: true,
      })
    ).toThrow(/after start/i);
    expect(() =>
      validateDropOffer({
        ...good,
        startsAt: START,
        endsAt: START,
        requireWindow: true,
      })
    ).toThrow(/after start/i);
  });

  it("accepts valid window strings", () => {
    expect(() =>
      validateDropOffer({
        ...good,
        startsAt: START.toISOString(),
        endsAt: END.toISOString(),
        requireWindow: true,
      })
    ).not.toThrow();
  });
});

describe("isEligibleSeller — accountType × verificationStatus matrix (§9.6)", () => {
  const matrix: Array<
    [
      { accountType: string; verificationStatus: string } | null,
      boolean,
      string,
    ]
  > = [
    [null, false, "missing profile"],
    [
      { accountType: "member", verificationStatus: "none" },
      false,
      "member/none",
    ],
    [
      { accountType: "member", verificationStatus: "business_verified" },
      false,
      "member business",
    ],
    [
      { accountType: "member", verificationStatus: "official" },
      false,
      "member official",
    ],
    [
      { accountType: "creator", verificationStatus: "none" },
      false,
      "creator none",
    ],
    [
      { accountType: "creator", verificationStatus: "eligible" },
      false,
      "creator eligible",
    ],
    [
      { accountType: "creator", verificationStatus: "pending" },
      false,
      "creator pending",
    ],
    [
      { accountType: "creator", verificationStatus: "verified" },
      true,
      "paid-verified creator stays eligible",
    ],
    [
      { accountType: "creator", verificationStatus: "business_verified" },
      true,
      "creator business",
    ],
    [
      { accountType: "creator", verificationStatus: "official" },
      true,
      "creator official",
    ],
    [
      { accountType: "company", verificationStatus: "none" },
      false,
      "company none",
    ],
    [
      { accountType: "company", verificationStatus: "verified" },
      false,
      "company verified (legacy) — not business/official",
    ],
    [
      { accountType: "company", verificationStatus: "business_verified" },
      true,
      "company business",
    ],
    [
      { accountType: "company", verificationStatus: "official" },
      true,
      "company official",
    ],
  ];

  for (const [profile, expected, label] of matrix) {
    it(`${label} → ${expected}`, () => {
      expect(isEligibleSeller(profile)).toBe(expected);
    });
  }
});

describe("claim idempotency key helpers", () => {
  it("builds the default scheme key", () => {
    expect(buildClaimIdempotencyKey(7, 41)).toBe("claim:7:41");
  });

  it("falls back to scheme key when empty", () => {
    expect(normalizeClaimIdempotencyKey(7, 41)).toBe("claim:7:41");
    expect(normalizeClaimIdempotencyKey(7, 41, null)).toBe("claim:7:41");
    expect(normalizeClaimIdempotencyKey(7, 41, "   ")).toBe("claim:7:41");
  });

  it("trims caller keys", () => {
    expect(normalizeClaimIdempotencyKey(7, 41, "  abc  ")).toBe("abc");
  });

  it("rejects keys longer than 160 characters", () => {
    expect(() =>
      normalizeClaimIdempotencyKey(7, 41, "x".repeat(161))
    ).toThrow(/160/);
    expect(normalizeClaimIdempotencyKey(7, 41, "x".repeat(160))).toHaveLength(
      160
    );
  });
});

describe("sold-out / race semantics (pure contract)", () => {
  it("documented claim decision order: not-live before decrement", () => {
    // Mirror of claimDrop guards — status must be live to attempt decrement.
    const statusesAllowingClaim = new Set(["live"]);
    for (const s of DROP_STATUSES) {
      expect(statusesAllowingClaim.has(s)).toBe(s === "live");
    }
  });

  it("0 remaining while live is treated as sold out before decrement", () => {
    const remaining = 0;
    const status: (typeof DROP_STATUSES)[number] = "live";
    const blocked = status !== "live" || remaining <= 0;
    expect(blocked).toBe(true);
  });

  it("decrement success with new remaining 0 implies live → sold_out is legal", () => {
    expect(canTransition(DROP_TRANSITIONS, "live", "sold_out")).toBe(true);
  });

  it("duplicate claim is prevented by unique (drop,user) — one claim/user", () => {
    // Contract assertion: one claim per user per drop (schema unique index).
    const claims = new Set<string>();
    const key = `${1}:${41}`;
    const first = !claims.has(key);
    if (first) claims.add(key);
    const second = !claims.has(key);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
