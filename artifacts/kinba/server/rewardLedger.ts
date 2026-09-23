/**
 * JHILIK Coin reward ledger (Phase 1 foundation).
 *
 * Immutable append-only entries are the source of truth. coin_accounts.balance
 * is a cache updated in the same DB transaction as each credit/reversal.
 * Never mutate balances without a matching ledger row (Product Constitution §7).
 *
 * Video-watch crediting is intentionally not wired here yet (Phase 7).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  coinAccounts,
  rewardLedgerEntries,
  rewardDailyUsage,
  type RewardLedgerEntry,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  assertTransition,
  REWARD_ENTRY_TRANSITIONS,
  type RewardEntryStatus,
} from "@shared/stateMachines";

export type CreditRewardInput = {
  userId: number;
  /** Positive integer coins to credit. */
  amount: number;
  action:
    | "video_watch"
    | "daily_bonus"
    | "milestone"
    | "admin_credit"
    | "admin_debit"
    | "reversal"
    | "spend_placeholder";
  sourceType: string;
  sourceId?: string | null;
  /** Unique across the system; duplicates return the existing entry. */
  idempotencyKey: string;
  ruleId?: number | null;
  adminId?: number | null;
  metadata?: Record<string, unknown>;
  /** Start as pending (default) or jump to credited after auto-approve. */
  initialStatus?: Extract<RewardEntryStatus, "pending" | "credited">;
  /** UTC YYYY-MM-DD for daily usage accounting (optional). */
  dayKey?: string | null;
};

function assertPositiveCoins(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Reward amount must be a positive integer.");
  }
  if (amount > 1_000_000) {
    throw new Error("Reward amount exceeds the allowed maximum.");
  }
}

async function bumpCoinAccount(
  tx: Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0],
  userId: number,
  delta: number,
  opts: { lifetimeEarnedDelta?: number; lifetimeReversedDelta?: number } = {}
) {
  const earnedDelta = opts.lifetimeEarnedDelta ?? 0;
  const reversedDelta = opts.lifetimeReversedDelta ?? 0;
  await tx
    .insert(coinAccounts)
    .values({
      userId,
      balance: delta,
      lifetimeEarned: earnedDelta,
      lifetimeReversed: reversedDelta,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: coinAccounts.userId,
      set: {
        balance: sql`${coinAccounts.balance} + ${delta}`,
        lifetimeEarned: sql`${coinAccounts.lifetimeEarned} + ${earnedDelta}`,
        lifetimeReversed: sql`${coinAccounts.lifetimeReversed} + ${reversedDelta}`,
        updatedAt: new Date(),
      },
    });
}

async function bumpDailyUsage(
  tx: Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0],
  userId: number,
  dayKey: string,
  action: CreditRewardInput["action"],
  coins: number
) {
  await tx
    .insert(rewardDailyUsage)
    .values({
      userId,
      dayKey,
      action,
      count: 1,
      coinsToday: coins,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rewardDailyUsage.userId, rewardDailyUsage.dayKey, rewardDailyUsage.action],
      set: {
        count: sql`${rewardDailyUsage.count} + 1`,
        coinsToday: sql`${rewardDailyUsage.coinsToday} + ${coins}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Idempotent credit. On duplicate idempotencyKey returns the existing row
 * without double-crediting. When initialStatus is "credited", the balance
 * cache is updated in the same transaction.
 */
export async function creditRewardEntry(
  input: CreditRewardInput
): Promise<{ entry: RewardLedgerEntry; created: boolean }> {
  assertPositiveCoins(input.amount);
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new Error("Idempotency key is required (max 200 characters).");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const initialStatus: "pending" | "credited" = input.initialStatus ?? "pending";
  if (initialStatus !== "pending") {
    assertTransition(
      REWARD_ENTRY_TRANSITIONS,
      "pending",
      initialStatus === "credited" ? "credited" : "approved",
      "reward entry"
    );
  }

  return db.transaction(async tx => {
    const now = new Date();
    const inserted = await tx
      .insert(rewardLedgerEntries)
      .values({
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        action: input.action,
        amount: input.amount,
        status: initialStatus,
        reviewStatus: "none",
        metadata: input.metadata ?? {},
        ruleId: input.ruleId ?? null,
        adminId: input.adminId ?? null,
        approvedAt: initialStatus === "credited" ? now : null,
        creditedAt: initialStatus === "credited" ? now : null,
        createdAt: now,
      })
      .onConflictDoNothing({ target: rewardLedgerEntries.idempotencyKey })
      .returning();

    if (!inserted[0]) {
      const [existing] = await tx
        .select()
        .from(rewardLedgerEntries)
        .where(eq(rewardLedgerEntries.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Ledger conflict without existing entry.");
      return { entry: existing, created: false };
    }

    if (initialStatus === "credited") {
      await bumpCoinAccount(tx, input.userId, input.amount, {
        lifetimeEarnedDelta: input.amount,
      });
      if (input.dayKey) {
        await bumpDailyUsage(tx, input.userId, input.dayKey, input.action, input.amount);
      }
    }

    return { entry: inserted[0], created: true };
  });
}

/** Promote pending → approved → credited (or rejected) with balance side-effects. */
export async function finalizeRewardEntry(
  entryId: number,
  decision: "credited" | "rejected",
  opts: { adminId?: number | null; dayKey?: string | null } = {}
): Promise<RewardLedgerEntry> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [entry] = await tx
      .select()
      .from(rewardLedgerEntries)
      .where(eq(rewardLedgerEntries.id, entryId))
      .limit(1);
    if (!entry) throw new Error("Ledger entry not found.");
    assertTransition(REWARD_ENTRY_TRANSITIONS, entry.status, decision, "reward entry");
    const now = new Date();
    const nextStatus: RewardEntryStatus = decision;
    const [updated] = await tx
      .update(rewardLedgerEntries)
      .set({
        status: nextStatus,
        approvedAt: nextStatus === "credited" ? now : entry.approvedAt,
        creditedAt: nextStatus === "credited" ? now : entry.creditedAt,
        adminId: opts.adminId ?? entry.adminId,
      })
      .where(eq(rewardLedgerEntries.id, entryId))
      .returning();
    if (!updated) throw new Error("Ledger update failed.");
    if (nextStatus === "credited" && entry.amount > 0) {
      await bumpCoinAccount(tx, entry.userId, entry.amount, {
        lifetimeEarnedDelta: entry.amount,
      });
      if (opts.dayKey) {
        await bumpDailyUsage(
          tx,
          entry.userId,
          opts.dayKey,
          entry.action,
          entry.amount
        );
      }
    }
    return updated;
  });
}

/**
 * Admin reversal: insert compensating negative entry; mark original reversed.
 * Does not rewrite amount/action on the original row.
 */
export async function reverseRewardEntry(
  originalEntryId: number,
  adminId: number,
  reason: string
): Promise<{ original: RewardLedgerEntry; reversal: RewardLedgerEntry }> {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new Error("Reversal reason is required (min 3 characters).");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [original] = await tx
      .select()
      .from(rewardLedgerEntries)
      .where(eq(rewardLedgerEntries.id, originalEntryId))
      .limit(1);
    if (!original) throw new Error("Ledger entry not found.");
    assertTransition(
      REWARD_ENTRY_TRANSITIONS,
      original.status,
      "reversed",
      "reward entry"
    );
    if (original.reversedByEntryId) {
      throw new Error("This entry has already been reversed.");
    }

    const now = new Date();
    const idempotencyKey = `reversal:${original.idempotencyKey}`.slice(0, 200);
    const [reversal] = await tx
      .insert(rewardLedgerEntries)
      .values({
        userId: original.userId,
        idempotencyKey,
        sourceType: "reversal",
        sourceId: String(original.id),
        action: "reversal",
        amount: -Math.abs(original.amount),
        status: "credited",
        reviewStatus: "none",
        metadata: { reason: trimmed, reversesEntryId: original.id },
        adminId,
        reversesEntryId: original.id,
        approvedAt: now,
        creditedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing({ target: rewardLedgerEntries.idempotencyKey })
      .returning();

    if (!reversal) {
      const [existing] = await tx
        .select()
        .from(rewardLedgerEntries)
        .where(eq(rewardLedgerEntries.idempotencyKey, idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Reversal conflict without existing entry.");
      return {
        original,
        reversal: existing,
      };
    }

    const [updatedOriginal] = await tx
      .update(rewardLedgerEntries)
      .set({
        status: "reversed",
        reversedByEntryId: reversal.id,
      })
      .where(eq(rewardLedgerEntries.id, original.id))
      .returning();

    // Debit balance cache (never below zero via CHECK; clamp in SQL).
    await tx
      .insert(coinAccounts)
      .values({
        userId: original.userId,
        balance: 0,
        lifetimeReversed: Math.abs(original.amount),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: coinAccounts.userId,
        set: {
          balance: sql`GREATEST(0, ${coinAccounts.balance} - ${Math.abs(original.amount)})`,
          lifetimeReversed: sql`${coinAccounts.lifetimeReversed} + ${Math.abs(original.amount)}`,
          updatedAt: now,
        },
      });

    return {
      original: updatedOriginal ?? original,
      reversal,
    };
  });
}

/** Spendable balance: prefer coin_accounts cache; fall back to ledger sum. */
export async function getCoinBalance(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const [account] = await db
      .select({ balance: coinAccounts.balance })
      .from(coinAccounts)
      .where(eq(coinAccounts.userId, userId))
      .limit(1);
    if (account) return Number(account.balance) || 0;
    const [sum] = await db
      .select({
        total: sql<number>`coalesce(sum(amount) filter (where status = 'credited'), 0)`,
      })
      .from(rewardLedgerEntries)
      .where(eq(rewardLedgerEntries.userId, userId));
    return Number(sum?.total ?? 0);
  } catch (error) {
    console.warn("[Rewards] Balance read failed:", error);
    return 0;
  }
}

export async function listRewardHistory(
  userId: number,
  limit = 50
): Promise<RewardLedgerEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return db
    .select()
    .from(rewardLedgerEntries)
    .where(eq(rewardLedgerEntries.userId, userId))
    .orderBy(desc(rewardLedgerEntries.createdAt), desc(rewardLedgerEntries.id))
    .limit(safeLimit);
}

export async function getDailyUsage(
  userId: number,
  dayKey: string,
  action: CreditRewardInput["action"]
) {
  const db = await getDb();
  if (!db) return { count: 0, coinsToday: 0 };
  try {
    const [row] = await db
      .select()
      .from(rewardDailyUsage)
      .where(
        and(
          eq(rewardDailyUsage.userId, userId),
          eq(rewardDailyUsage.dayKey, dayKey),
          eq(rewardDailyUsage.action, action)
        )
      )
      .limit(1);
    return {
      count: Number(row?.count ?? 0),
      coinsToday: Number(row?.coinsToday ?? 0),
    };
  } catch {
    return { count: 0, coinsToday: 0 };
  }
}
