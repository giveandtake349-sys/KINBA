/**
 * JHILIK Ads Phase 1 — campaign state machines.
 * Pure transition-table tests, no DB. Locks in the five new machines so
 * Phase 2+ writers get a compile-time + test-time contract.
 */
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  BRAND_APPLICATION_STATUSES,
  BRAND_APPLICATION_TRANSITIONS,
  CAMPAIGN_EARNINGS_STATUSES,
  CAMPAIGN_EARNINGS_TRANSITIONS,
  CAMPAIGN_INVITATION_STATUSES,
  CAMPAIGN_INVITATION_TRANSITIONS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_SUBMISSION_STATUSES,
  CAMPAIGN_SUBMISSION_TRANSITIONS,
  CAMPAIGN_TRANSITIONS,
  canTransition,
  type TransitionMap,
} from "../shared/stateMachines";

function expectWellFormed<T extends string>(
  statuses: readonly T[],
  map: TransitionMap<T>
) {
  // Every status has an entry; every target is a known status.
  for (const status of statuses) {
    expect(map[status], `missing map entry for ${status}`).toBeDefined();
    for (const next of map[status]) {
      expect(statuses, `bad target ${next} from ${status}`).toContain(next);
    }
  }
}

describe("ads state machines are well-formed", () => {
  it("covers every status and only known targets", () => {
    expectWellFormed(BRAND_APPLICATION_STATUSES, BRAND_APPLICATION_TRANSITIONS);
    expectWellFormed(CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS);
    expectWellFormed(CAMPAIGN_INVITATION_STATUSES, CAMPAIGN_INVITATION_TRANSITIONS);
    expectWellFormed(CAMPAIGN_SUBMISSION_STATUSES, CAMPAIGN_SUBMISSION_TRANSITIONS);
    expectWellFormed(CAMPAIGN_EARNINGS_STATUSES, CAMPAIGN_EARNINGS_TRANSITIONS);
  });
});

describe("brand application lifecycle", () => {
  it("draft -> submitted -> pending -> approved", () => {
    expect(canTransition(BRAND_APPLICATION_TRANSITIONS, "draft", "submitted")).toBe(true);
    expect(canTransition(BRAND_APPLICATION_TRANSITIONS, "submitted", "pending")).toBe(true);
    expect(canTransition(BRAND_APPLICATION_TRANSITIONS, "pending", "approved")).toBe(true);
  });
  it("info_requested loops back to pending", () => {
    expect(
      canTransition(BRAND_APPLICATION_TRANSITIONS, "pending", "info_requested")
    ).toBe(true);
    expect(
      canTransition(BRAND_APPLICATION_TRANSITIONS, "info_requested", "pending")
    ).toBe(true);
  });
  it("approved/rejected are terminal", () => {
    expect(BRAND_APPLICATION_TRANSITIONS.approved).toEqual([]);
    expect(BRAND_APPLICATION_TRANSITIONS.rejected).toEqual([]);
  });
  it("assertTransition throws on illegal jump", () => {
    expect(() =>
      assertTransition(BRAND_APPLICATION_TRANSITIONS, "draft", "approved", "application")
    ).toThrow(/Invalid application transition/);
  });
});

describe("campaign lifecycle", () => {
  it("draft -> active -> paused -> active -> ended", () => {
    expect(canTransition(CAMPAIGN_TRANSITIONS, "draft", "active")).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, "active", "paused")).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, "paused", "active")).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, "active", "ended")).toBe(true);
  });
  it("ended is terminal", () => {
    expect(CAMPAIGN_TRANSITIONS.ended).toEqual([]);
  });
});

describe("invitation lifecycle", () => {
  it("pending accepts, declines, or expires — then terminal", () => {
    for (const to of ["accepted", "declined", "expired"] as const) {
      expect(canTransition(CAMPAIGN_INVITATION_TRANSITIONS, "pending", to)).toBe(true);
      expect(CAMPAIGN_INVITATION_TRANSITIONS[to]).toEqual([]);
    }
  });
});

describe("submission lifecycle", () => {
  it("draft -> in_review -> approved -> live", () => {
    expect(canTransition(CAMPAIGN_SUBMISSION_TRANSITIONS, "draft", "in_review")).toBe(true);
    expect(canTransition(CAMPAIGN_SUBMISSION_TRANSITIONS, "in_review", "approved")).toBe(true);
    expect(canTransition(CAMPAIGN_SUBMISSION_TRANSITIONS, "approved", "live")).toBe(true);
  });
  it("rejected/live are terminal", () => {
    expect(CAMPAIGN_SUBMISSION_TRANSITIONS.rejected).toEqual([]);
    expect(CAMPAIGN_SUBMISSION_TRANSITIONS.live).toEqual([]);
  });
});

describe("fiat earnings lifecycle", () => {
  it("estimated -> approved -> paid_recorded, with reversals", () => {
    expect(canTransition(CAMPAIGN_EARNINGS_TRANSITIONS, "estimated", "approved")).toBe(true);
    expect(canTransition(CAMPAIGN_EARNINGS_TRANSITIONS, "approved", "paid_recorded")).toBe(true);
    expect(canTransition(CAMPAIGN_EARNINGS_TRANSITIONS, "approved", "reversed")).toBe(true);
    expect(canTransition(CAMPAIGN_EARNINGS_TRANSITIONS, "paid_recorded", "reversed")).toBe(true);
  });
  it("cannot skip estimated straight to paid", () => {
    expect(canTransition(CAMPAIGN_EARNINGS_TRANSITIONS, "estimated", "paid_recorded")).toBe(false);
  });
  it("reversed is terminal", () => {
    expect(CAMPAIGN_EARNINGS_TRANSITIONS.reversed).toEqual([]);
  });
});
