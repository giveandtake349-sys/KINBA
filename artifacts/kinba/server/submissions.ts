/**
 * JHILIK Brand Advertising — Phase 4: submissions + fiat earnings + links.
 *
 * End-to-end deliverable flow:
 *   creator: submitDeliverable → mySubmissions / myEarnings
 *   admin:   reviewQueue → reviewSubmission (approve mints fiat earnings)
 *            → earnings (totals) → reverseEarning (append-only reversal)
 *            → createLink (targets for /r/:linkId click tracking)
 *
 * Visibility rules (enforced here, not just in UI):
 *   - A creator sees ONLY their own submissions, their own earning rows
 *     (amount/currency/status) and the campaign brief. They NEVER see
 *     creatorPool, budgetTotal, serviceFee, or other creators' data.
 *   - Admins see everything, including pool totals and the earnings ledger.
 *
 * Money: fiat only (USD/BDT), numeric(12,2) server-side, compared in cents.
 * This ledger is deliberately separate from the integer-coin rewardLedger.
 * Earning rows are append-only: reversals insert a new "reversed" row and
 * NEVER update the original money row. All money-adjacent admin actions
 * write campaign_audit_log rows.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  campaignAuditLog,
  campaignEarnings,
  campaignInvitations,
  campaignLinks,
  campaignSubmissions,
  campaigns,
  linkClicks,
  profiles,
  users,
  videos,
} from "../drizzle/schema";
import {
  assertTransition,
  CAMPAIGN_EARNINGS_TRANSITIONS,
  CAMPAIGN_SUBMISSION_TRANSITIONS,
  type CampaignEarningsStatus,
  type CampaignSubmissionStatus,
} from "../shared/stateMachines";
import { getDb } from "./db";
import { insertNotification, NOTIFICATION_TYPES } from "./notifications";

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

export const CAMPAIGN_CURRENCIES = ["USD", "BDT"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => (value ? value : null));

const toCents = (amount: string | number): number =>
  Math.round(Number(amount) * 100);

/**
 * Pool guard, pure for tests: the pool still covers the new reward iff
 * committed + new <= pool (all in cents — no float anywhere near money).
 */
export function poolFitsCents(
  poolCents: number,
  committedCents: number,
  newCents: number
): boolean {
  return committedCents + newCents <= poolCents;
}

/**
 * Server-side URL validation for a campaign link (mirrors the
 * validateRoomLink semantics in hypeRooms.ts: http/https only, max 2048).
 * Throws on invalid input.
 */
export function validateCampaignLink(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Link URL is required.");
  if (value.length > 2048) {
    throw new Error("Link URL must be at most 2048 characters.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Link URL must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Link URL must start with http:// or https://.");
  }
  return parsed.toString();
}

export const submitDeliverableInput = z.object({
  campaignId: z.number().int().positive(),
  videoId: z.number().int().positive(),
  answers: z
    .array(z.string().trim().min(1).max(500))
    .min(1, "Please acknowledge the campaign checklist.")
    .max(20),
});

export const reviewSubmissionInput = z.object({
  submissionId: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: optionalText(500),
});

export const reverseEarningInput = z.object({
  earningId: z.number().int().positive(),
  reason: z.string().trim().min(3, "A reason is required.").max(500),
});

export const createLinkInput = z.object({
  campaignId: z.number().int().positive(),
  label: z.string().trim().min(1).max(160),
  url: z.string().trim().min(1).max(2048),
  kind: z.string().trim().max(32).optional().default("website"),
});

export const campaignIdInput = z.object({
  campaignId: z.number().int().positive(),
});

export type SubmitDeliverableInput = z.output<typeof submitDeliverableInput>;
export type ReviewSubmissionInput = z.output<typeof reviewSubmissionInput>;
export type ReverseEarningInput = z.output<typeof reverseEarningInput>;
export type CreateLinkInput = z.output<typeof createLinkInput>;

/* ------------------------------------------------------------------ */
/* Creator: submit a deliverable                                       */
/* ------------------------------------------------------------------ */

/**
 * Creator submits one of their own videos as a campaign deliverable.
 * Requires: campaign active, caller holds an ACCEPTED invitation,
 * video owned by the caller, no existing non-rejected submission for
 * (campaignId, videoId), and a non-empty checklist acknowledgement.
 *
 * Sets videos.campaignId (the Sponsored badge source) only when the video
 * isn't already badged for another campaign — never steals a badge.
 */
export async function submitDeliverable(
  userId: number,
  input: SubmitDeliverableInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status !== "active") {
    throw new Error("This campaign is not accepting submissions right now.");
  }

  const [invitation] = await db
    .select({ id: campaignInvitations.id })
    .from(campaignInvitations)
    .where(
      and(
        eq(campaignInvitations.campaignId, input.campaignId),
        eq(campaignInvitations.userId, userId),
        eq(campaignInvitations.status, "accepted")
      )
    )
    .limit(1);
  if (!invitation) {
    throw new Error(
      "Submission blocked: you need an accepted invitation for this campaign."
    );
  }

  const [video] = await db
    .select({
      id: videos.id,
      userId: videos.userId,
      campaignId: videos.campaignId,
    })
    .from(videos)
    .where(eq(videos.id, input.videoId))
    .limit(1);
  if (!video || video.userId !== userId) {
    throw new Error("Video not found.");
  }

  const [existing] = await db
    .select({ id: campaignSubmissions.id })
    .from(campaignSubmissions)
    .where(
      and(
        eq(campaignSubmissions.campaignId, input.campaignId),
        eq(campaignSubmissions.videoId, input.videoId),
        ne(campaignSubmissions.reviewStatus, "rejected")
      )
    )
    .limit(1);
  if (existing) {
    throw new Error("This video has already been submitted to this campaign.");
  }

  const now = new Date();
  const result = await db.transaction(async tx => {
    const [submission] = await tx
      .insert(campaignSubmissions)
      .values({
        campaignId: input.campaignId,
        creatorId: userId,
        videoId: input.videoId,
        answers: [...input.answers],
        reviewStatus: "in_review",
        submittedAt: now,
      })
      .returning({ id: campaignSubmissions.id });
    if (!submission) throw new Error("Could not save the submission.");

    // Badge the video for this campaign — but never steal another
    // campaign's badge (conditional update on campaignId IS NULL).
    if (video.campaignId == null) {
      await tx
        .update(videos)
        .set({ campaignId: input.campaignId })
        .where(
          and(eq(videos.id, input.videoId), isNull(videos.campaignId))
        );
    }

    await tx.insert(campaignAuditLog).values({
      campaignId: input.campaignId,
      actorId: userId,
      action: "campaign.submission_received",
      details: { submissionId: submission.id, videoId: input.videoId },
    });

    return { submissionId: submission.id };
  });

  // Notify the campaign's admin (the one who created it). A notification
  // failure must not roll back the submission itself.
  if (campaign.createdBy) {
    const [profile] = await db
      .select({ displayName: profiles.displayName, username: profiles.username })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    const who = profile?.displayName || profile?.username || "A creator";
    await insertNotification({
      userId: campaign.createdBy,
      type: NOTIFICATION_TYPES.submissionReceived,
      title: "New submission",
      body: `${who} submitted a deliverable to "${campaign.title}".`,
      entityType: "campaign_submission",
      entityId: result.submissionId,
      link: "/admin",
    });
  }

  return result;
}

/**
 * Creator's own submissions: campaign title + review status + their own
 * earning row (amount/currency/status ONLY — never pool or budget).
 */
export async function listMySubmissions(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: campaignSubmissions.id,
      campaignId: campaignSubmissions.campaignId,
      campaignTitle: campaigns.title,
      videoId: campaignSubmissions.videoId,
      reviewStatus: campaignSubmissions.reviewStatus,
      rewardEligible: campaignSubmissions.rewardEligible,
      submittedAt: campaignSubmissions.submittedAt,
      reviewedAt: campaignSubmissions.reviewedAt,
      earningAmount: campaignEarnings.amount,
      earningCurrency: campaignEarnings.currency,
      earningStatus: campaignEarnings.status,
    })
    .from(campaignSubmissions)
    .innerJoin(campaigns, eq(campaigns.id, campaignSubmissions.campaignId))
    .leftJoin(
      campaignEarnings,
      eq(campaignEarnings.submissionId, campaignSubmissions.id)
    )
    .where(eq(campaignSubmissions.creatorId, userId))
    .orderBy(desc(campaignSubmissions.submittedAt))
    .limit(100);
}

/**
 * Creator's own fiat earnings ledger rows: amount, currency, status,
 * campaign title, createdAt. NO pool/budget/totals — ever.
 */
export async function listMyEarnings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: campaignEarnings.id,
      amount: campaignEarnings.amount,
      currency: campaignEarnings.currency,
      status: campaignEarnings.status,
      campaignId: campaignEarnings.campaignId,
      campaignTitle: campaigns.title,
      createdAt: campaignEarnings.createdAt,
    })
    .from(campaignEarnings)
    .innerJoin(campaigns, eq(campaigns.id, campaignEarnings.campaignId))
    .where(eq(campaignEarnings.creatorId, userId))
    .orderBy(desc(campaignEarnings.createdAt))
    .limit(100);
}

/* ------------------------------------------------------------------ */
/* Admin: review queue + approve/reject                                */
/* ------------------------------------------------------------------ */

/**
 * Admin review queue for one campaign: submission + video title/thumbnail,
 * creator PUBLIC profile only (username/displayName/photoUrl — no
 * email/phone), answers, submittedAt.
 */
export async function listReviewQueue(campaignId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: campaignSubmissions.id,
      reviewStatus: campaignSubmissions.reviewStatus,
      answers: campaignSubmissions.answers,
      submittedAt: campaignSubmissions.submittedAt,
      videoId: videos.id,
      videoTitle: videos.title,
      videoThumbnail: videos.thumbnailUrl,
      creatorId: users.id,
      creatorUsername: profiles.username,
      creatorDisplayName: profiles.displayName,
      creatorPhotoUrl: profiles.photoUrl,
    })
    .from(campaignSubmissions)
    .leftJoin(videos, eq(videos.id, campaignSubmissions.videoId))
    .innerJoin(users, eq(users.id, campaignSubmissions.creatorId))
    .leftJoin(profiles, eq(profiles.userId, campaignSubmissions.creatorId))
    .where(eq(campaignSubmissions.campaignId, campaignId))
    .orderBy(desc(campaignSubmissions.submittedAt))
    .limit(100);
}

/**
 * Admin approves/rejects a submission. Approval mints a fiat earning row
 * (status "approved") in the SAME transaction, guarded by an in-transaction
 * pool-exhaustion check: committed (estimated+approved+paid_recorded)
 * + this reward must fit the campaign's creatorPool, compared in cents.
 * Rejection never mints money; if an earning row somehow already exists
 * for the submission, an append-only REVERSAL row compensates it.
 */
export async function reviewSubmission(
  adminId: number,
  input: ReviewSubmissionInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [submission] = await db
    .select()
    .from(campaignSubmissions)
    .where(eq(campaignSubmissions.id, input.submissionId))
    .limit(1);
  if (!submission) throw new Error("Submission not found.");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, submission.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");

  const [invitation] = await db
    .select({
      rewardAmount: campaignInvitations.rewardAmount,
      rewardCurrency: campaignInvitations.rewardCurrency,
    })
    .from(campaignInvitations)
    .where(
      and(
        eq(campaignInvitations.campaignId, submission.campaignId),
        eq(campaignInvitations.userId, submission.creatorId),
        eq(campaignInvitations.status, "accepted")
      )
    )
    .limit(1);

  const now = new Date();
  const toStatus: CampaignSubmissionStatus =
    input.decision === "approve" ? "approved" : "rejected";
  assertTransition(
    CAMPAIGN_SUBMISSION_TRANSITIONS,
    submission.reviewStatus as CampaignSubmissionStatus,
    toStatus,
    "submission status"
  );

  const outcome = await db.transaction(async tx => {
    if (input.decision === "approve") {
      if (!invitation?.rewardAmount || !invitation.rewardCurrency) {
        throw new Error(
          "No agreed reward on this creator's invitation — cannot credit earnings."
        );
      }
      if (!campaign.creatorPool) {
        throw new Error("This campaign has no creator pool configured.");
      }
      // Pool-exhaustion check, inside the transaction, in cents.
      const [sumRow] = await tx
        .select({
          total: sql<string>`coalesce(sum(${campaignEarnings.amount}), 0)`,
        })
        .from(campaignEarnings)
        .where(
          and(
            eq(campaignEarnings.campaignId, campaign.id),
            inArray(campaignEarnings.status, [
              "estimated",
              "approved",
              "paid_recorded",
            ])
          )
        );
      const committedCents = toCents(sumRow?.total ?? "0");
      const newCents = toCents(invitation.rewardAmount);
      if (
        !poolFitsCents(toCents(campaign.creatorPool), committedCents, newCents)
      ) {
        throw new Error(
          "Approving this submission would exceed the campaign's remaining creator pool."
        );
      }

      const [earning] = await tx
        .insert(campaignEarnings)
        .values({
          campaignId: campaign.id,
          submissionId: submission.id,
          creatorId: submission.creatorId,
          amount: invitation.rewardAmount,
          currency: invitation.rewardCurrency,
          status: "approved",
          idempotencyKey: `earn:sub:${submission.id}`,
          adminId,
          reason: input.note,
          decidedAt: now,
        })
        .returning({ id: campaignEarnings.id });

      await tx
        .update(campaignSubmissions)
        .set({ reviewStatus: "approved", rewardEligible: true, reviewedAt: now })
        .where(eq(campaignSubmissions.id, submission.id));

      await tx.insert(campaignAuditLog).values({
        campaignId: campaign.id,
        actorId: adminId,
        action: "campaign.submission_approved",
        details: {
          submissionId: submission.id,
          earningId: earning?.id ?? null,
          amount: invitation.rewardAmount,
          currency: invitation.rewardCurrency,
          note: input.note,
        },
      });

      return { earningId: earning?.id ?? null, reversed: false };
    }

    // Reject: never mint money. Compensate a stray earning row if one exists.
    await tx
      .update(campaignSubmissions)
      .set({ reviewStatus: "rejected", reviewedAt: now })
      .where(eq(campaignSubmissions.id, submission.id));

    let reversed = false;
    const [existing] = await tx
      .select()
      .from(campaignEarnings)
      .where(
        and(
          eq(campaignEarnings.submissionId, submission.id),
          inArray(campaignEarnings.status, [
            "estimated",
            "approved",
            "paid_recorded",
          ])
        )
      )
      .limit(1);
    if (existing) {
      await tx.insert(campaignEarnings).values({
        campaignId: campaign.id,
        submissionId: submission.id,
        creatorId: submission.creatorId,
        amount: existing.amount,
        currency: existing.currency,
        status: "reversed",
        idempotencyKey: `rev:sub:${submission.id}`,
        adminId,
        reason: `Reversal of earning #${existing.id} (submission rejected).`,
      });
      reversed = true;
    }

    await tx.insert(campaignAuditLog).values({
      campaignId: campaign.id,
      actorId: adminId,
      action: "campaign.submission_rejected",
      details: {
        submissionId: submission.id,
        reversed,
        note: input.note,
      },
    });

    return { earningId: null, reversed };
  });

  // Notify the creator — outside the transaction so a notification failure
  // never rolls back the review decision.
  const [profile] = await db
    .select({ title: campaigns.title })
    .from(campaigns)
    .where(eq(campaigns.id, submission.campaignId))
    .limit(1);
  await insertNotification({
    userId: submission.creatorId,
    type:
      input.decision === "approve"
        ? NOTIFICATION_TYPES.submissionApproved
        : NOTIFICATION_TYPES.submissionRejected,
    title:
      input.decision === "approve"
        ? "Submission approved"
        : "Submission rejected",
    body:
      input.decision === "approve"
        ? `Your deliverable for "${profile?.title ?? "the campaign"}" was approved — your reward is recorded in Earnings.`
        : `Your deliverable for "${profile?.title ?? "the campaign"}" was rejected.${input.note ? ` Note: ${input.note}` : ""}`,
    entityType: "campaign_submission",
    entityId: submission.id,
    link: "/campaigns",
  });

  return { submissionId: submission.id, status: toStatus, ...outcome };
}

/**
 * Append-only earning reversal. The original money row is NEVER updated —
 * a new "reversed" row compensates it. Idempotency key includes Date.now()
 * so repeated reversals can't collide.
 */
export async function reverseEarning(
  adminId: number,
  input: ReverseEarningInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [earning] = await db
    .select()
    .from(campaignEarnings)
    .where(eq(campaignEarnings.id, input.earningId))
    .limit(1);
  if (!earning) throw new Error("Earning not found.");
  assertTransition(
    CAMPAIGN_EARNINGS_TRANSITIONS,
    earning.status as CampaignEarningsStatus,
    "reversed",
    "earning status"
  );

  return db.transaction(async tx => {
    const [reversal] = await tx
      .insert(campaignEarnings)
      .values({
        campaignId: earning.campaignId,
        submissionId: earning.submissionId,
        creatorId: earning.creatorId,
        amount: earning.amount,
        currency: earning.currency,
        status: "reversed",
        idempotencyKey: `rev:earn:${earning.id}:${Date.now()}`,
        adminId,
        reason: input.reason,
      })
      .returning({ id: campaignEarnings.id });

    await tx.insert(campaignAuditLog).values({
      campaignId: earning.campaignId,
      actorId: adminId,
      action: "campaign.earning_reversed",
      details: {
        earningId: earning.id,
        reversalId: reversal?.id ?? null,
        reason: input.reason,
      },
    });

    return { earningId: earning.id, reversalId: reversal?.id ?? null };
  });
}

/**
 * Admin-only earnings ledger for a campaign: all rows + approved totals
 * per currency (computed in cents, never float).
 */
export async function listEarningsForAdmin(campaignId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      id: campaignEarnings.id,
      submissionId: campaignEarnings.submissionId,
      creatorId: campaignEarnings.creatorId,
      creatorUsername: profiles.username,
      creatorDisplayName: profiles.displayName,
      amount: campaignEarnings.amount,
      currency: campaignEarnings.currency,
      status: campaignEarnings.status,
      reason: campaignEarnings.reason,
      createdAt: campaignEarnings.createdAt,
      decidedAt: campaignEarnings.decidedAt,
    })
    .from(campaignEarnings)
    .leftJoin(profiles, eq(profiles.userId, campaignEarnings.creatorId))
    .where(eq(campaignEarnings.campaignId, campaignId))
    .orderBy(desc(campaignEarnings.createdAt))
    .limit(200);

  const totalsCents = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "approved") continue;
    const currency = row.currency ?? "USD";
    totalsCents.set(currency, (totalsCents.get(currency) ?? 0) + toCents(row.amount));
  }
  const totals = [...totalsCents.entries()].map(([currency, cents]) => ({
    currency,
    amount: (cents / 100).toFixed(2),
  }));

  return { rows, totals };
}

/* ------------------------------------------------------------------ */
/* Admin: campaign links (targets for /r/:linkId)                      */
/* ------------------------------------------------------------------ */

export async function createCampaignLink(
  adminId: number,
  input: CreateLinkInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");

  const url = validateCampaignLink(input.url);

  return db.transaction(async tx => {
    const [link] = await tx
      .insert(campaignLinks)
      .values({
        campaignId: input.campaignId,
        kind: input.kind || "website",
        label: input.label,
        url,
      })
      .returning({ id: campaignLinks.id });
    if (!link) throw new Error("Could not create the link.");

    await tx.insert(campaignAuditLog).values({
      campaignId: input.campaignId,
      actorId: adminId,
      action: "campaign.link_created",
      details: { linkId: link.id, label: input.label },
    });

    return { linkId: link.id, shortUrl: `/r/${link.id}` };
  });
}

export async function listCampaignLinks(campaignId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(campaignLinks)
    .where(eq(campaignLinks.campaignId, campaignId))
    .orderBy(desc(campaignLinks.createdAt))
    .limit(50);
}

/* ------------------------------------------------------------------ */
/* Click tracking helpers (used by the Express /r/:linkId route)       */
/* ------------------------------------------------------------------ */

/** UTC calendar day, YYYY-MM-DD — the dedup window for link clicks. */
export function clickDayUTC(when: Date = new Date()): string {
  return when.toISOString().slice(0, 10);
}

/** One-way IP hash with a daily-rotating salt component. */
export function hashClickIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Resolve a campaign link's redirect target. Returns null when the link is
 * missing or its stored URL is not a safe http(s) target (never 302 to
 * javascript:/data: URLs, even if one slipped into the DB).
 */
export async function getClickTarget(linkId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [link] = await db
    .select({ url: campaignLinks.url })
    .from(campaignLinks)
    .where(eq(campaignLinks.id, linkId))
    .limit(1);
  if (!link?.url) return null;
  try {
    return validateCampaignLink(link.url);
  } catch {
    return null;
  }
}

/**
 * Record one click, idempotent per (linkId, ipHash, day) — concurrent or
 * repeated clicks from the same IP on the same day insert exactly one row
 * via onConflictDoNothing on the link_clicks_dedup_unique index.
 */
export async function recordLinkClick(input: {
  linkId: number;
  campaignId?: number | null;
  userId?: number | null;
  ip: string;
  ipSalt: string;
  userAgent?: string | null;
  referrer?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const day = clickDayUTC();
  const ipHash = hashClickIp(input.ip, `${input.ipSalt}:${day}`);
  await db
    .insert(linkClicks)
    .values({
      linkId: input.linkId,
      videoId: null,
      campaignId: input.campaignId ?? null,
      userId: input.userId ?? null,
      ipHash,
      userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
      referrer: input.referrer ? input.referrer.slice(0, 1024) : null,
      day,
    })
    .onConflictDoNothing({
      target: [linkClicks.linkId, linkClicks.ipHash, linkClicks.day],
    });
}
