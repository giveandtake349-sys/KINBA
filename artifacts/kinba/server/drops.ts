/**
 * JHILIK Drops + Claims/Reservations (Phase 2 Milestone 3).
 *
 * Social reservation only — no payment, checkout, or wallet.
 * Lifecycle is server-authoritative from persisted startsAt/endsAt + remainingQuantity.
 * Flag: jhilik_drops (fail-closed via router gate).
 * Schema/enums/constraints reused from Phase 1 (no migration).
 * Spec: docs/JHILIK_MASTER_PRODUCT_SPEC.md §9, §19.2, §18.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { dropClaims, drops, profiles, type DropRow } from "../drizzle/schema";
import {
  assertTransition,
  canTransition,
  DROP_CLAIM_TRANSITIONS,
  DROP_TRANSITIONS,
  resolveDropStatus,
  type DropClaimStatus,
  type DropStatus,
} from "@shared/stateMachines";
import { getDb } from "./db";
import { notifyClaimStatusChange, notifyDropSoldOut } from "./notifications";

export type DropClaimRow = typeof dropClaims.$inferSelect;

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type DbLike = DbClient | TxClient;

export type DropSaveDraftInput = {
  title: string;
  description: string;
  terms: string;
  mediaUrl: string;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  originalPrice: string;
  discountedPrice: string;
  quantity: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  dropId?: number | null;
};

export type DropWindowInput = {
  dropId: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
};

export type ClaimResult = {
  claim: DropClaimRow;
  drop: DropRow;
  created: boolean;
  serverNow: Date;
};

/** Pure validation for prices/quantity/window (throws on invalid). */
export function validateDropOffer(input: {
  originalPrice: string | number;
  discountedPrice: string | number;
  quantity: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  requireWindow?: boolean;
}): void {
  const original = Number(input.originalPrice);
  const discounted = Number(input.discountedPrice);
  if (!Number.isFinite(original) || original <= 0) {
    throw new Error("Original price must be greater than zero.");
  }
  if (!Number.isFinite(discounted) || discounted <= 0) {
    throw new Error("Discounted price must be greater than zero.");
  }
  if (discounted >= original) {
    throw new Error("Discounted price must be less than original price.");
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("Quantity must be a positive integer.");
  }
  if (input.requireWindow) {
    if (!input.startsAt || !input.endsAt) {
      throw new Error("Start and end times are required to publish.");
    }
    const starts = toTime(input.startsAt);
    const ends = toTime(input.endsAt);
    if (Number.isNaN(starts) || Number.isNaN(ends)) {
      throw new Error("Start or end time is invalid.");
    }
    if (ends <= starts) {
      throw new Error("End time must be after start time.");
    }
  }
}

function toTime(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function toNullableDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Date is invalid.");
  return d;
}

/**
 * Seller eligibility (spec §9.6):
 * - accountType ∈ {company, creator}
 * - verificationStatus ∈ {business_verified, official}
 *   OR paid-verified creator status `verified` (remains eligible, §9.6/§33)
 * Pure — used by service + tests. No room membership required for claims.
 */
export function isEligibleSeller(profile: {
  accountType: string;
  verificationStatus: string;
} | null | undefined): boolean {
  if (!profile) return false;
  if (
    profile.accountType !== "company" &&
    profile.accountType !== "creator"
  ) {
    return false;
  }
  const v = profile.verificationStatus;
  if (v === "business_verified" || v === "official") return true;
  // Paid-verified creators currently map to `verified` and remain eligible.
  if (profile.accountType === "creator" && v === "verified") return true;
  return false;
}

/** Pure drop lifecycle resolution wrapping shared resolveDropStatus. */
export function resolveDropLifecycle(
  room: Pick<DropRow, "status" | "startsAt" | "endsAt">,
  now: Date = new Date()
): {
  status: DropStatus;
  changed: boolean;
  endedAt?: Date;
} {
  const next = resolveDropStatus(room.status, room.startsAt, room.endsAt, now);
  const changed = next !== room.status;
  if (changed) {
    // Time-based advances must still sit inside DROP_TRANSITIONS
    // (draft never advances here; scheduled→live, live→ended are legal).
    assertTransition(DROP_TRANSITIONS, room.status, next, "drop");
  }
  if (changed && next === "ended") {
    return { status: next, changed, endedAt: now };
  }
  return { status: next, changed };
}

/** Reject illegal manual transitions (e.g. ended → live). */
export function assertDropTransition(from: DropStatus, to: DropStatus): void {
  if (!canTransition(DROP_TRANSITIONS, from, to)) {
    assertTransition(DROP_TRANSITIONS, from, to, "drop");
  }
}

/** Seller-facing claim targets available in M5 (no `released` path). */
export type DropClaimFulfilTarget = "fulfilled" | "cancelled";

/** Pure claim transition check against DROP_CLAIM_TRANSITIONS. */
export function canClaimTransition(
  from: DropClaimStatus,
  to: DropClaimStatus
): boolean {
  return canTransition(DROP_CLAIM_TRANSITIONS, from, to);
}

/** Reject illegal claim transitions (terminal / released → *, claimed → released). */
export function assertClaimTransition(
  from: DropClaimStatus,
  to: DropClaimStatus
): void {
  if (!canTransition(DROP_CLAIM_TRANSITIONS, from, to)) {
    assertTransition(DROP_CLAIM_TRANSITIONS, from, to, "claim");
  }
}

/** One claim per (drop,user); default idempotency key scheme. */
export function buildClaimIdempotencyKey(dropId: number, userId: number): string {
  return `claim:${dropId}:${userId}`;
}

/** Normalize caller-provided key (≤160 chars) or fall back to scheme key. */
export function normalizeClaimIdempotencyKey(
  dropId: number,
  userId: number,
  idempotencyKey?: string | null
): string {
  const raw = (idempotencyKey ?? "").trim();
  if (!raw) return buildClaimIdempotencyKey(dropId, userId);
  if (raw.length > 160) {
    throw new Error("Idempotency key must be at most 160 characters.");
  }
  return raw;
}

async function persistResolvedDrop(
  db: DbLike,
  drop: DropRow,
  now: Date
): Promise<DropRow> {
  const resolution = resolveDropLifecycle(drop, now);
  if (!resolution.changed) return drop;
  const patch: Partial<typeof drops.$inferInsert> = {
    status: resolution.status,
    updatedAt: now,
  };
  if (resolution.status === "ended") {
    patch.endedAt = drop.endedAt ?? resolution.endedAt ?? now;
  }
  if (resolution.status === "archived") {
    patch.archivedAt = drop.archivedAt ?? now;
  }
  const [updated] = await db
    .update(drops)
    .set(patch)
    .where(and(eq(drops.id, drop.id), eq(drops.status, drop.status)))
    .returning();
  return updated ?? { ...drop, ...patch };
}

async function assertSellerEligible(db: DbLike, userId: number): Promise<void> {
  const [profile] = await db
    .select({
      accountType: profiles.accountType,
      verificationStatus: profiles.verificationStatus,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!isEligibleSeller(profile)) {
    throw new Error(
      "Only eligible sellers can manage drops (creator/company with required verification)."
    );
  }
}

async function getDropOrThrow(db: DbLike, dropId: number): Promise<DropRow> {
  const [row] = await db.select().from(drops).where(eq(drops.id, dropId)).limit(1);
  if (!row) throw new Error("Drop not found.");
  return row;
}

async function assertOwner(drop: DropRow, sellerId: number): Promise<void> {
  if (drop.sellerId !== sellerId) {
    throw new Error("You do not own this drop.");
  }
}

/**
 * List drops after lazy time resolution.
 * filter: live (default) | upcoming | mine | all
 */
export async function listDrops(opts: {
  filter?: "live" | "upcoming" | "mine" | "all";
  userId?: number | null;
  limit?: number;
} = {}): Promise<{ drops: DropRow[]; serverNow: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const filter = opts.filter ?? "live";

  const rows = await db
    .select()
    .from(drops)
    .orderBy(desc(drops.featured), desc(drops.startsAt), desc(drops.id))
    .limit(limit * 3);

  const resolved: DropRow[] = [];
  for (const row of rows) {
    const r = await persistResolvedDrop(db, row, now);
    if (filter === "mine") {
      if (opts.userId != null && r.sellerId === opts.userId) resolved.push(r);
    } else if (filter === "upcoming") {
      if (r.status === "scheduled" || r.status === "draft") resolved.push(r);
    } else if (filter === "all") {
      resolved.push(r);
    } else if (r.status === "live" && r.remainingQuantity > 0) {
      resolved.push(r);
    } else if (r.status === "scheduled") {
      resolved.push(r);
    }
    if (resolved.length >= limit) break;
  }
  return { drops: resolved, serverNow: now };
}

/** Fetch one drop, lazily persisting any due lifecycle advance. */
export async function getDrop(dropId: number): Promise<DropRow | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const row = await db
    .select()
    .from(drops)
    .where(eq(drops.id, dropId))
    .limit(1)
    .then(r => r[0] ?? null);
  if (!row) return null;
  return persistResolvedDrop(db, row, new Date());
}

/**
 * Seller save draft (create, or update an existing draft via dropId).
 * Eligibility + validation run before any write.
 */
export async function saveDraftDrop(
  sellerId: number,
  input: DropSaveDraftInput
): Promise<DropRow> {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 180) {
    throw new Error("Drop title must be 3–180 characters.");
  }
  const description = input.description.trim();
  if (description.length < 1 || description.length > 4000) {
    throw new Error("Description is required (max 4000 characters).");
  }
  const terms = input.terms.trim();
  if (terms.length < 1 || terms.length > 4000) {
    throw new Error("Terms are required (max 4000 characters).");
  }
  const mediaUrl = input.mediaUrl.trim();
  if (!mediaUrl || mediaUrl.length > 1024) {
    throw new Error("Media URL is required.");
  }
  validateDropOffer(input);

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await assertSellerEligible(db, sellerId);

  const startsAt = toNullableDate(input.startsAt);
  const endsAt = toNullableDate(input.endsAt);
  const now = new Date();
  const values = {
    title,
    description,
    terms,
    mediaUrl,
    mediaWidth: input.mediaWidth ?? null,
    mediaHeight: input.mediaHeight ?? null,
    originalPrice: Number(input.originalPrice).toFixed(2),
    discountedPrice: Number(input.discountedPrice).toFixed(2),
    quantity: input.quantity,
    remainingQuantity: input.quantity,
    startsAt,
    endsAt,
    updatedAt: now,
  };

  if (input.dropId != null && input.dropId > 0) {
    const existing = await getDropOrThrow(db, input.dropId);
    await assertOwner(existing, sellerId);
    if (existing.status !== "draft") {
      throw new Error("Only draft drops can be edited this way.");
    }
    const [updated] = await db
      .update(drops)
      .set(values)
      .where(and(eq(drops.id, existing.id), eq(drops.status, "draft")))
      .returning();
    if (!updated) throw new Error("Failed to update draft.");
    return updated;
  }

  const [created] = await db
    .insert(drops)
    .values({
      ...values,
      sellerId,
      status: "draft",
      createdAt: now,
    })
    .returning();
  if (!created) throw new Error("Failed to create draft.");
  return created;
}

async function applyWindowAndTransition(
  db: DbClient,
  existing: DropRow,
  target: DropStatus,
  input: DropWindowInput
): Promise<DropRow> {
  assertDropTransition(existing.status, target);

  const startsAt = toNullableDate(input.startsAt) ?? existing.startsAt ?? new Date();
  const endsAt = toNullableDate(input.endsAt) ?? existing.endsAt;
  if (!endsAt) {
    throw new Error("End time is required to publish.");
  }
  validateDropOffer({
    originalPrice: existing.originalPrice,
    discountedPrice: existing.discountedPrice,
    quantity: existing.quantity,
    startsAt,
    endsAt,
    requireWindow: true,
  });

  const now = new Date();
  // "publish now" with a future start becomes scheduled (server authority).
  let finalStatus = target;
  if (target === "live" && startsAt.getTime() > now.getTime()) {
    finalStatus = "scheduled";
    if (!canTransition(DROP_TRANSITIONS, existing.status, "scheduled")) {
      assertDropTransition(existing.status, "scheduled");
    }
  }

  if (finalStatus === "live" && existing.remainingQuantity <= 0) {
    throw new Error("Drop has no remaining quantity to publish.");
  }

  const [updated] = await db
    .update(drops)
    .set({ status: finalStatus, startsAt, endsAt, updatedAt: now })
    .where(and(eq(drops.id, existing.id), eq(drops.status, existing.status)))
    .returning();
  if (!updated) throw new Error("Failed to update drop status.");
  return updated;
}

/**
 * Publish: draft/scheduled → live (or schedule draft → scheduled).
 */
export async function publishDrop(
  sellerId: number,
  input: DropWindowInput & { mode?: "publish" | "schedule" }
): Promise<DropRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await assertSellerEligible(db, sellerId);
  const existing = await getDropOrThrow(db, input.dropId);
  await assertOwner(existing, sellerId);

  const mode = input.mode ?? "publish";
  const target: DropStatus = mode === "schedule" ? "scheduled" : "live";
  return applyWindowAndTransition(db, existing, target, input);
}

/** Explicit schedule: draft → scheduled (spec `drops.schedule`). */
export async function scheduleDrop(
  sellerId: number,
  input: DropWindowInput
): Promise<DropRow> {
  return publishDrop(sellerId, { ...input, mode: "schedule" });
}

/**
 * Seller end early: scheduled/live/sold_out → ended.
 * Owner-only (admin path out of M3 scope).
 */
export async function endDrop(
  sellerId: number,
  dropId: number
): Promise<DropRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getDropOrThrow(db, dropId);
  await assertOwner(existing, sellerId);

  const resolved = await persistResolvedDrop(db, existing, new Date());
  if (
    resolved.status !== "live" &&
    resolved.status !== "scheduled" &&
    resolved.status !== "sold_out"
  ) {
    throw new Error("Drop cannot be ended from its current status.");
  }
  assertDropTransition(resolved.status, "ended");

  const now = new Date();
  const [updated] = await db
    .update(drops)
    .set({ status: "ended", endedAt: resolved.endedAt ?? now, updatedAt: now })
    .where(and(eq(drops.id, dropId), eq(drops.status, resolved.status)))
    .returning();
  if (!updated) throw new Error("Failed to end drop.");
  return updated;
}

/**
 * Atomic claim / social reservation.
 * - No Hype Room membership required.
 * - Decrement remaining only while live && remaining > 0.
 * - 0-row decrement → sold out (controlled error).
 * - Duplicate (dropId,userId) or idempotencyKey → return existing, created:false.
 */
export async function claimDrop(
  dropId: number,
  userId: number,
  idempotencyKey?: string | null
): Promise<ClaimResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const key = normalizeClaimIdempotencyKey(dropId, userId, idempotencyKey);

  return db.transaction(async tx => {
    const now = new Date();
    const raw = await getDropOrThrow(tx, dropId);
    const drop = await persistResolvedDrop(tx, raw, now);

    // Idempotent replay by unique idempotencyKey.
    const [byKey] = await tx
      .select()
      .from(dropClaims)
      .where(eq(dropClaims.idempotencyKey, key))
      .limit(1);
    if (byKey) {
      const fresh = await getDropOrThrow(tx, byKey.dropId);
      return { claim: byKey, drop: fresh, created: false, serverNow: now };
    }

    // Existing claim by (drop,user) without matching key → controlled duplicate.
    const [existingClaim] = await tx
      .select()
      .from(dropClaims)
      .where(and(eq(dropClaims.dropId, dropId), eq(dropClaims.userId, userId)))
      .limit(1);
    if (existingClaim) {
      return { claim: existingClaim, drop, created: false, serverNow: now };
    }

    if (drop.status !== "live") {
      if (drop.status === "sold_out" || drop.remainingQuantity <= 0) {
        throw new Error("This drop is sold out.");
      }
      if (drop.status === "ended" || drop.status === "archived") {
        throw new Error("This drop has ended.");
      }
      if (drop.status === "draft") {
        throw new Error("This drop is not live yet.");
      }
      throw new Error("This drop is not live yet.");
    }

    // Atomic remaining decrement — 0 rows means sold out / lost race.
    const [decremented] = await tx
      .update(drops)
      .set({
        remainingQuantity: sql`${drops.remainingQuantity} - 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(drops.id, dropId),
          eq(drops.status, "live"),
          gt(drops.remainingQuantity, 0)
        )
      )
      .returning();

    if (!decremented) {
      const again = await getDropOrThrow(tx, dropId);
      if (again.status !== "live" || again.remainingQuantity <= 0) {
        throw new Error("This drop is sold out.");
      }
      throw new Error("This drop is no longer available.");
    }

    const [inserted] = await tx
      .insert(dropClaims)
      .values({
        dropId,
        userId,
        status: "claimed",
        idempotencyKey: key,
        claimedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [dropClaims.dropId, dropClaims.userId] })
      .returning();

    if (!inserted) {
      // Lost race on unique (drop,user) — restore stock and return existing.
      await tx
        .update(drops)
        .set({
          remainingQuantity: sql`${drops.remainingQuantity} + 1`,
          updatedAt: now,
        })
        .where(eq(drops.id, dropId));
      const [raced] = await tx
        .select()
        .from(dropClaims)
        .where(and(eq(dropClaims.dropId, dropId), eq(dropClaims.userId, userId)))
        .limit(1);
      if (!raced) throw new Error("You already claimed this drop.");
      const fresh = await getDropOrThrow(tx, dropId);
      return { claim: raced, drop: fresh, created: false, serverNow: now };
    }

    // If remaining hit 0, transition live → sold_out.
    let finalDrop = decremented;
    if (decremented.remainingQuantity <= 0) {
      assertDropTransition("live", "sold_out");
      const [soldOut] = await tx
        .update(drops)
        .set({ status: "sold_out", updatedAt: now })
        .where(and(eq(drops.id, dropId), eq(drops.status, "live")))
        .returning();
      finalDrop = soldOut ?? { ...decremented, status: "sold_out" };
      // §22 — only on the actual live→sold_out row update (not on re-reads).
      if (soldOut) {
        const claimerRows = await tx
          .select({ userId: dropClaims.userId })
          .from(dropClaims)
          .where(eq(dropClaims.dropId, dropId));
        await notifyDropSoldOut(
          { id: dropId, title: finalDrop.title },
          claimerRows.map(r => r.userId),
          tx as never
        );
      }
    }

    return { claim: inserted, drop: finalDrop, created: true, serverNow: now };
  });
}

/** Current user's claim for a drop (or null). */
export async function getMyClaim(
  dropId: number,
  userId: number
): Promise<DropClaimRow | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [claim] = await db
    .select()
    .from(dropClaims)
    .where(and(eq(dropClaims.dropId, dropId), eq(dropClaims.userId, userId)))
    .limit(1);
  return claim ?? null;
}

/** Owner check helper (used before seller claim list). */
export async function assertDropOwner(
  dropId: number,
  sellerId: number
): Promise<DropRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const drop = await getDropOrThrow(db, dropId);
  await assertOwner(drop, sellerId);
  return drop;
}

/** Seller claim list for a drop (owner-only checked before call). */
export async function listDropClaims(dropId: number): Promise<DropClaimRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await getDropOrThrow(db, dropId);
  return db
    .select()
    .from(dropClaims)
    .where(eq(dropClaims.dropId, dropId))
    .orderBy(asc(dropClaims.claimedAt), asc(dropClaims.id));
}

export type DropClaimTransitionInput = {
  dropId: number;
  claimId: number;
  notes?: string | null;
};

/**
 * Seller claim status transition (M5): claimed → fulfilled | cancelled.
 * - Owner of drop only; claim must belong to that drop.
 * - Optimistic WHERE status='claimed' (lost race → controlled error).
 * - Terminal claims are never rewritten.
 * - No stock change (claim already decremented at claim time).
 */
async function transitionClaimForSeller(
  sellerId: number,
  input: DropClaimTransitionInput,
  target: DropClaimFulfilTarget
): Promise<DropClaimRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const drop = await getDropOrThrow(db, input.dropId);
  await assertOwner(drop, sellerId);

  const [claim] = await db
    .select()
    .from(dropClaims)
    .where(
      and(eq(dropClaims.id, input.claimId), eq(dropClaims.dropId, input.dropId))
    )
    .limit(1);
  if (!claim) {
    throw new Error("Claim not found.");
  }
  assertClaimTransition(claim.status, target);
  if (claim.status !== "claimed") {
    throw new Error("Claim is not in claimed state.");
  }

  const now = new Date();
  const patch: Partial<typeof dropClaims.$inferInsert> = {
    status: target,
    updatedAt: now,
  };
  if (target === "fulfilled") patch.fulfilledAt = now;
  if (target === "cancelled") patch.cancelledAt = now;
  if (input.notes !== undefined) patch.notes = input.notes;

  const [updated] = await db
    .update(dropClaims)
    .set(patch)
    .where(and(eq(dropClaims.id, claim.id), eq(dropClaims.status, "claimed")))
    .returning();
  if (!updated) {
    throw new Error("Claim is no longer in claimed state.");
  }
  // §22 — claimer notification only after successful claimed→terminal transition.
  await notifyClaimStatusChange(
    { userId: updated.userId, dropId: updated.dropId },
    { title: drop.title },
    target === "fulfilled" ? "fulfilled" : "cancelled",
    db
  );
  return updated;
}

/** Seller fulfil: claimed → fulfilled (sets fulfilledAt). Spec §9.5/§26. */
export async function fulfillClaim(
  sellerId: number,
  input: DropClaimTransitionInput
): Promise<DropClaimRow> {
  return transitionClaimForSeller(sellerId, input, "fulfilled");
}

/** Seller cancel: claimed → cancelled (sets cancelledAt). Spec §9.5. */
export async function cancelClaim(
  sellerId: number,
  input: DropClaimTransitionInput
): Promise<DropClaimRow> {
  return transitionClaimForSeller(sellerId, input, "cancelled");
}

/** M8 — statuses admin forceEnd/takedown may move to `ended`. */
const ADMIN_END_STATUSES = ["scheduled", "live", "sold_out"] as const;
type AdminEndStatus = (typeof ADMIN_END_STATUSES)[number];

function assertAdminEndStatus(status: DropStatus): asserts status is AdminEndStatus {
  if (!(ADMIN_END_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Drop cannot be ended from its current status.");
  }
  // Shared map has live/sold_out → ended; scheduled → ended is M8 admin-only
  // (binding scope) and is not in DROP_TRANSITIONS — skip assert for scheduled.
  if (status !== "scheduled") {
    assertDropTransition(status, "ended");
  }
}

async function adminEndDropInternal(
  db: DbClient,
  dropId: number
): Promise<DropRow> {
  const existing = await getDropOrThrow(db, dropId);
  const resolved = await persistResolvedDrop(db, existing, new Date());
  assertAdminEndStatus(resolved.status);

  const now = new Date();
  const [updated] = await db
    .update(drops)
    .set({ status: "ended", endedAt: resolved.endedAt ?? now, updatedAt: now })
    .where(and(eq(drops.id, dropId), eq(drops.status, resolved.status)))
    .returning();
  if (!updated) throw new Error("Failed to end drop.");
  return updated;
}

/**
 * M8 — admin list: optional status + featured filters; lazy lifecycle resolution
 * preserved from listDrops. No new pagination framework.
 */
export async function listAdminDrops(
  opts: {
    status?: DropStatus;
    featured?: boolean;
    limit?: number;
  } = {}
): Promise<{ drops: DropRow[]; serverNow: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  const rows = await db
    .select()
    .from(drops)
    .orderBy(desc(drops.featured), desc(drops.startsAt), desc(drops.id))
    .limit(limit * 3);

  const resolved: DropRow[] = [];
  for (const row of rows) {
    const r = await persistResolvedDrop(db, row, now);
    if (opts.status != null && r.status !== opts.status) continue;
    if (opts.featured != null && r.featured !== opts.featured) continue;
    resolved.push(r);
    if (resolved.length >= limit) break;
  }
  return { drops: resolved, serverNow: now };
}

/** M8 — feature/unfeature for Discover; does NOT change drop status. */
export async function adminFeatureDrop(
  dropId: number,
  featured: boolean
): Promise<DropRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getDropOrThrow(db, dropId);

  const now = new Date();
  const [updated] = await db
    .update(drops)
    .set({
      featured,
      featuredAt: featured ? now : null,
      updatedAt: now,
    })
    .where(eq(drops.id, existing.id))
    .returning();
  if (!updated) throw new Error("Failed to update drop featured state.");
  return updated;
}

/** M8 — admin force end: scheduled/live/sold_out → ended (optimistic WHERE). */
export async function adminForceEndDrop(dropId: number): Promise<DropRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return adminEndDropInternal(db, dropId);
}

/**
 * M8 — admin takedown: same end transitions as forceEnd.
 * Optional `reason` is accepted for API validation only — drops schema has
 * no reason column; M9 owns durable moderation reason storage.
 */
export async function adminTakedownDrop(
  dropId: number,
  reason?: string | null
): Promise<DropRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (reason != null && reason.trim().length > 500) {
    throw new Error("Takedown reason must be at most 500 characters.");
  }
  return adminEndDropInternal(db, dropId);
}
