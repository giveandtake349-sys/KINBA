/**
 * Shared JHILIK state machines (Phase 1).
 *
 * Pure transition tables used by the server to reject illegal status changes.
 * Clients may import types only; authority is always server-side.
 * Spec: docs/JHILIK_MASTER_PRODUCT_SPEC.md §19.
 */

export const HYPE_ROOM_STATUSES = [
  "scheduled",
  "live",
  "expired",
  "archived",
] as const;
export type HypeRoomStatus = (typeof HYPE_ROOM_STATUSES)[number];

export const DROP_STATUSES = [
  "draft",
  "scheduled",
  "live",
  "sold_out",
  "ended",
  "archived",
] as const;
export type DropStatus = (typeof DROP_STATUSES)[number];

/**
 * drop_claim_status enum (matches drizzle/schema.ts).
 * M5 adds seller fulfil/cancel only; `released` is admin/deferred (no path yet).
 */
export const DROP_CLAIM_STATUSES = [
  "claimed",
  "released",
  "fulfilled",
  "cancelled",
] as const;
export type DropClaimStatus = (typeof DROP_CLAIM_STATUSES)[number];

export const REWARD_ENTRY_STATUSES = [
  "pending",
  "approved",
  "credited",
  "rejected",
  "reversed",
] as const;
export type RewardEntryStatus = (typeof REWARD_ENTRY_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  "none",
  "eligible",
  "pending",
  "verified",
  "business_verified",
  "official",
] as const;
export type VerificationStatusValue = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_APPLICATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type VerificationApplicationStatus =
  (typeof VERIFICATION_APPLICATION_STATUSES)[number];

export const MILESTONE_AWARD_STATUSES = [
  "eligible",
  "pending",
  "awarded",
  "rejected",
] as const;
export type MilestoneAwardStatus = (typeof MILESTONE_AWARD_STATUSES)[number];

/* ---- JHILIK Brand Advertising & Creator Campaign System (Phase 1) ---- */

export const BRAND_APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "pending",
  "info_requested",
  "approved",
  "rejected",
] as const;
export type BrandApplicationStatus = (typeof BRAND_APPLICATION_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "expired",
] as const;
export type CampaignInvitationStatus =
  (typeof CAMPAIGN_INVITATION_STATUSES)[number];

export const CAMPAIGN_SUBMISSION_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "live",
] as const;
export type CampaignSubmissionStatus =
  (typeof CAMPAIGN_SUBMISSION_STATUSES)[number];

export const CAMPAIGN_EARNINGS_STATUSES = [
  "estimated",
  "approved",
  "reversed",
  "paid_recorded",
] as const;
export type CampaignEarningsStatus =
  (typeof CAMPAIGN_EARNINGS_STATUSES)[number];

/** allowed next states from each current state (terminal states → []). */
export type TransitionMap<T extends string> = Readonly<Record<T, readonly T[]>>;

export const HYPE_ROOM_TRANSITIONS: TransitionMap<HypeRoomStatus> = {
  scheduled: ["live", "archived"],
  live: ["expired"],
  expired: ["archived"],
  archived: [],
};

export const DROP_TRANSITIONS: TransitionMap<DropStatus> = {
  draft: ["scheduled", "live", "archived"],
  scheduled: ["live", "archived"],
  live: ["sold_out", "ended"],
  sold_out: ["ended", "archived"],
  ended: ["archived"],
  archived: [],
};

/**
 * Claim lifecycle (spec §9/§19/§26).
 * M5: seller fulfil/cancel from `claimed` only.
 * `claimed → released` is intentionally NOT allowed here (admin path deferred).
 * Terminal states have no outbound transitions.
 */
export const DROP_CLAIM_TRANSITIONS: TransitionMap<DropClaimStatus> = {
  claimed: ["fulfilled", "cancelled"],
  released: [],
  fulfilled: [],
  cancelled: [],
};

export const REWARD_ENTRY_TRANSITIONS: TransitionMap<RewardEntryStatus> = {
  pending: ["approved", "rejected", "credited"],
  approved: ["credited", "rejected"],
  credited: ["reversed"],
  rejected: [],
  reversed: [],
};

export const VERIFICATION_APPLICATION_TRANSITIONS: TransitionMap<VerificationApplicationStatus> =
  {
    pending: ["approved", "rejected", "withdrawn"],
    approved: [],
    rejected: [],
    withdrawn: [],
  };

/**
 * Brand application lifecycle. `submitted` is the brand's handoff;
 * `pending` means an admin has picked it up for review.
 */
export const BRAND_APPLICATION_TRANSITIONS: TransitionMap<BrandApplicationStatus> =
  {
    draft: ["submitted"],
    submitted: ["pending", "info_requested", "approved", "rejected"],
    pending: ["info_requested", "approved", "rejected"],
    info_requested: ["pending", "approved", "rejected"],
    approved: [],
    rejected: [],
  };

/** Campaign lifecycle. MVP: activation/expiry is a manual admin action. */
export const CAMPAIGN_TRANSITIONS: TransitionMap<CampaignStatus> = {
  draft: ["active"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: [],
};

/** Invitation lifecycle. Only the invited creator (or expiry) moves it. */
export const CAMPAIGN_INVITATION_TRANSITIONS: TransitionMap<CampaignInvitationStatus> =
  {
    pending: ["accepted", "declined", "expired"],
    accepted: [],
    declined: [],
    expired: [],
  };

/** Submission review lifecycle. `live` = published as a normal video row. */
export const CAMPAIGN_SUBMISSION_TRANSITIONS: TransitionMap<CampaignSubmissionStatus> =
  {
    draft: ["in_review"],
    in_review: ["approved", "rejected"],
    approved: ["live"],
    rejected: [],
    live: [],
  };

/**
 * Fiat earnings lifecycle. `paid_recorded` is a manual bookkeeping marker —
 * actual payouts stay out of scope until a payment system is approved.
 */
export const CAMPAIGN_EARNINGS_TRANSITIONS: TransitionMap<CampaignEarningsStatus> =
  {
    estimated: ["approved"],
    approved: ["paid_recorded", "reversed"],
    paid_recorded: ["reversed"],
    reversed: [],
  };

export function canTransition<T extends string>(
  map: TransitionMap<T>,
  from: T,
  to: T
): boolean {
  const allowed = map[from];
  return Array.isArray(allowed) ? allowed.includes(to) : false;
}

export function assertTransition<T extends string>(
  map: TransitionMap<T>,
  from: T,
  to: T,
  label = "status"
): void {
  if (!canTransition(map, from, to)) {
    throw new Error(`Invalid ${label} transition: ${from} → ${to}`);
  }
}

/**
 * Lazy time-based advance for Hype Rooms (server authority uses DB/server clock).
 * Does not invent transitions outside the map.
 */
export function resolveHypeRoomStatus(
  current: HypeRoomStatus,
  startsAt: Date,
  endsAt: Date,
  now: Date
): HypeRoomStatus {
  if (current === "archived" || current === "expired") return current;
  if (current === "scheduled" && now.getTime() >= startsAt.getTime()) {
    if (now.getTime() >= endsAt.getTime()) return "expired";
    return canTransition(HYPE_ROOM_TRANSITIONS, "scheduled", "live")
      ? "live"
      : current;
  }
  if (current === "live" && now.getTime() >= endsAt.getTime()) return "expired";
  return current;
}

/** Lazy advance for Drops from wall-clock window (remaining handled separately). */
export function resolveDropStatus(
  current: DropStatus,
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date
): DropStatus {
  if (current === "archived" || current === "ended" || current === "sold_out")
    return current;
  if (current === "draft") return current;
  if (current === "scheduled") {
    if (startsAt && now.getTime() >= startsAt.getTime()) return "live";
    return current;
  }
  if (current === "live") {
    if (endsAt && now.getTime() >= endsAt.getTime()) return "ended";
    return current;
  }
  return current;
}
