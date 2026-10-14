/**
 * JHILIK Brand Advertising — Phase 3: campaigns + creator invitations.
 *
 * End-to-end campaign flow:
 *   admin:   create (from APPROVED application) → update (draft) → setStatus
 *            → inviteCreator / searchCreators
 *   brand:   list / get (own campaigns only)
 *   creator: myInvitations → respondInvitation → myCampaigns
 *
 * Visibility rules (enforced here, not just in UI):
 *   - A creator sees ONLY their own invitation reward + the campaign brief.
 *     They NEVER see budgetTotal, creatorPool, or serviceFee.
 *   - A brand sees their own campaigns (title/brief/status/dates + their own
 *     total budget) — never the pool/fee split, never creator PII beyond
 *     public profile fields.
 *   - Admins see everything, including the full budget breakdown.
 *
 * Money: all amounts are decimal strings mapped to numeric(12,2); currency
 * is an explicit USD|BDT column. No floats, no FX conversion.
 * Scheduler: MVP uses manual admin Activate/Pause/End buttons (Phase-0
 * decision) — no cron. Rewards stay submission-based (Phase 4); inviting a
 * creator never mints money.
 */
import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  brandApplications,
  campaignAuditLog,
  campaignInvitations,
  campaigns,
  profiles,
  users,
} from "../drizzle/schema";
import {
  assertTransition,
  CAMPAIGN_INVITATION_TRANSITIONS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TRANSITIONS,
  type CampaignInvitationStatus,
  type CampaignStatus,
} from "../shared/stateMachines";
import { getDb } from "./db";
import { insertNotification, NOTIFICATION_TYPES } from "./notifications";

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

export const CAMPAIGN_CURRENCIES = ["USD", "BDT"] as const;

/** Positive decimal with up to 2 fraction digits — maps to numeric(12,2). */
const moneyString = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, `${label} must be a positive amount.`)
    .refine(
      value => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 && n <= 9999999999.99;
      },
      { message: `${label} is out of range.` }
    );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => (value ? value : null));

const stringList = (maxItems: number, itemMax: number, label: string) =>
  z
    .array(z.string().trim().min(1).max(itemMax))
    .max(maxItems, `Too many ${label}.`)
    .default([]);

const toCents = (amount: string): number => Math.round(Number(amount) * 100);

export const createCampaignInput = z
  .object({
    applicationId: z.number().int().positive(),
    title: z.string().trim().min(3, "Title is required.").max(200),
    brief: z.string().trim().max(5000).optional().default(""),
    concepts: stringList(10, 500, "concepts"),
    rules: z.string().trim().max(5000).optional().default(""),
    validationQuestions: stringList(10, 300, "validation questions"),
    // Phase 6: FB-style run mode. Continuous (default) = no end date.
    runMode: z.enum(["continuous", "scheduled"]).default("continuous"),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    creatorPool: moneyString("Creator pool"),
    serviceFee: moneyString("Service fee"),
  })
  .superRefine((value, ctx) => {
    if (value.runMode === "scheduled" && !value.endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "Scheduled campaigns need an end date.",
      });
    }
    if (
      value.startsAt &&
      value.endsAt &&
      new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End date must be after the start date.",
      });
    }
  });

export type CreateCampaignInput = z.output<typeof createCampaignInput>;

export const updateCampaignInput = z
  .object({
    id: z.number().int().positive(),
    title: z.string().trim().min(3).max(200).optional(),
    brief: z.string().trim().max(5000).optional(),
    concepts: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    rules: z.string().trim().max(5000).optional(),
    validationQuestions: z
      .array(z.string().trim().min(1).max(300))
      .max(10)
      .optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    creatorPool: moneyString("Creator pool").optional(),
    serviceFee: moneyString("Service fee").optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.startsAt &&
      value.endsAt &&
      new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End date must be after the start date.",
      });
    }
  });

export const campaignListInput = z.object({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

export const setCampaignStatusInput = z.object({
  id: z.number().int().positive(),
  toStatus: z.enum(["active", "paused", "ended"] as const),
});

export const inviteCreatorInput = z.object({
  campaignId: z.number().int().positive(),
  userId: z.number().int().positive(),
  rewardAmount: moneyString("Reward"),
  message: z.string().trim().max(1000).optional().default(""),
});

export const searchCreatorsInput = z.object({
  query: z.string().trim().min(2).max(64),
  limit: z.number().int().min(1).max(20).default(10),
});

export const respondInvitationInput = z.object({
  invitationId: z.number().int().positive(),
  accept: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const orNull = (value: string | null | undefined): string | null =>
  value && value.length > 0 ? value : null;

/** Sum of committed (pending + accepted) invitation rewards, in cents. */
async function committedRewardsCents(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  campaignId: number
): Promise<number> {
  const rows = await db
    .select({ rewardAmount: campaignInvitations.rewardAmount })
    .from(campaignInvitations)
    .where(
      and(
        eq(campaignInvitations.campaignId, campaignId),
        inArray(campaignInvitations.status, ["pending", "accepted"])
      )
    );
  return rows.reduce(
    (sum, row) => sum + (row.rewardAmount ? toCents(row.rewardAmount) : 0),
    0
  );
}

async function writeAudit(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  entry: {
    campaignId?: number | null;
    applicationId?: number | null;
    actorId: number;
    action: string;
    details?: Record<string, unknown>;
  }
) {
  await db.insert(campaignAuditLog).values({
    campaignId: entry.campaignId ?? null,
    applicationId: entry.applicationId ?? null,
    actorId: entry.actorId,
    action: entry.action,
    details: entry.details ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Admin procedures                                                    */
/* ------------------------------------------------------------------ */

/**
 * Create a campaign from an APPROVED brand application. The reward split
 * must exactly equal the application's proposed budget — the brand never
 * sets it, and the admin can't silently change the total.
 */
export async function createCampaign(
  adminId: number,
  input: CreateCampaignInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [application] = await db
    .select()
    .from(brandApplications)
    .where(eq(brandApplications.id, input.applicationId))
    .limit(1);
  if (!application) throw new Error("Application not found.");
  if (application.status !== "approved") {
    throw new Error("Campaigns can only be created from approved applications.");
  }
  if (!application.budgetAmount || !application.budgetCurrency) {
    throw new Error("The application has no confirmed budget.");
  }

  // The split must add up to the approved total — exact, in cents.
  const total = toCents(application.budgetAmount);
  const pool = toCents(input.creatorPool);
  const fee = toCents(input.serviceFee);
  if (pool + fee !== total) {
    throw new Error(
      "Creator pool + service fee must equal the approved budget total."
    );
  }

  const now = new Date();
  return db.transaction(async tx => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        applicationId: application.id,
        title: input.title,
        brief: orNull(input.brief),
        concepts: input.concepts.length > 0 ? [...input.concepts] : null,
        rules: orNull(input.rules),
        validationQuestions:
          input.validationQuestions.length > 0
            ? [...input.validationQuestions]
            : null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        runMode: input.runMode,
        status: "draft",
        budgetTotal: application.budgetAmount,
        budgetCurrency: application.budgetCurrency,
        creatorPool: input.creatorPool,
        serviceFee: input.serviceFee,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: campaigns.id });

    if (!campaign) throw new Error("Could not create the campaign.");

    await tx.insert(campaignAuditLog).values({
      campaignId: campaign.id,
      applicationId: application.id,
      actorId: adminId,
      action: "campaign.created",
      details: {
        title: input.title,
        budgetTotal: application.budgetAmount,
        budgetCurrency: application.budgetCurrency,
        creatorPool: input.creatorPool,
        serviceFee: input.serviceFee,
      },
    });

    return { campaignId: campaign.id };
  });
}

/** Update a draft campaign. Only drafts are editable — live ones aren't. */
export async function updateCampaign(
  adminId: number,
  input: z.output<typeof updateCampaignInput>
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.id))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status !== "draft") {
    throw new Error("Only draft campaigns can be edited.");
  }

  // If the split changes, it must still equal the approved total.
  const pool = input.creatorPool ?? campaign.creatorPool;
  const fee = input.serviceFee ?? campaign.serviceFee;
  if (pool && fee && campaign.budgetTotal) {
    if (toCents(pool) + toCents(fee) !== toCents(campaign.budgetTotal)) {
      throw new Error(
        "Creator pool + service fee must equal the approved budget total."
      );
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.brief !== undefined) patch.brief = orNull(input.brief);
  if (input.concepts !== undefined)
    patch.concepts = input.concepts.length > 0 ? [...input.concepts] : null;
  if (input.rules !== undefined) patch.rules = orNull(input.rules);
  if (input.validationQuestions !== undefined)
    patch.validationQuestions =
      input.validationQuestions.length > 0
        ? [...input.validationQuestions]
        : null;
  if (input.startsAt !== undefined)
    patch.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  if (input.endsAt !== undefined)
    patch.endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (input.creatorPool !== undefined) patch.creatorPool = input.creatorPool;
  if (input.serviceFee !== undefined) patch.serviceFee = input.serviceFee;

  await db.transaction(async tx => {
    await tx
      .update(campaigns)
      .set(patch)
      .where(and(eq(campaigns.id, input.id), eq(campaigns.status, "draft")));
    await tx.insert(campaignAuditLog).values({
      campaignId: input.id,
      applicationId: campaign.applicationId,
      actorId: adminId,
      action: "campaign.updated",
      details: { fields: Object.keys(patch).filter(k => k !== "updatedAt") },
    });
  });

  return { id: input.id };
}

/* ------------------------------------------------------------------ */
/* Admin: list / detail                                                */
/* ------------------------------------------------------------------ */

/** Full campaign list for admins — includes the budget breakdown. */
export async function listCampaignsForAdmin(input: {
  status?: CampaignStatus;
  limit: number;
  offset: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const conditions =
    input.status != null ? eq(campaigns.status, input.status) : undefined;
  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      status: campaigns.status,
      budgetTotal: campaigns.budgetTotal,
      budgetCurrency: campaigns.budgetCurrency,
      creatorPool: campaigns.creatorPool,
      serviceFee: campaigns.serviceFee,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      createdAt: campaigns.createdAt,
      brandName: brandApplications.brandName,
    })
    .from(campaigns)
    .leftJoin(
      brandApplications,
      eq(campaigns.applicationId, brandApplications.id)
    )
    .where(conditions)
    .orderBy(desc(campaigns.createdAt))
    .limit(input.limit)
    .offset(input.offset);
  return { items: rows };
}

/** Full campaign detail for admins: budget split, invitations, audit trail. */
export async function getCampaignForAdmin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");

  const [application] = campaign.applicationId
    ? await db
        .select({
          id: brandApplications.id,
          brandName: brandApplications.brandName,
          email: brandApplications.email,
          budgetAmount: brandApplications.budgetAmount,
          budgetCurrency: brandApplications.budgetCurrency,
        })
        .from(brandApplications)
        .where(eq(brandApplications.id, campaign.applicationId))
        .limit(1)
    : [undefined];

  const invitations = await db
    .select({
      id: campaignInvitations.id,
      userId: campaignInvitations.userId,
      status: campaignInvitations.status,
      rewardAmount: campaignInvitations.rewardAmount,
      rewardCurrency: campaignInvitations.rewardCurrency,
      message: campaignInvitations.message,
      invitedAt: campaignInvitations.invitedAt,
      respondedAt: campaignInvitations.respondedAt,
      expiresAt: campaignInvitations.expiresAt,
      username: profiles.username,
      displayName: profiles.displayName,
      photoUrl: profiles.photoUrl,
    })
    .from(campaignInvitations)
    .leftJoin(profiles, eq(campaignInvitations.userId, profiles.userId))
    .where(eq(campaignInvitations.campaignId, id))
    .orderBy(desc(campaignInvitations.invitedAt));

  const audit = await db
    .select()
    .from(campaignAuditLog)
    .where(eq(campaignAuditLog.campaignId, id))
    .orderBy(desc(campaignAuditLog.createdAt))
    .limit(30);

  return { campaign, application: application ?? null, invitations, audit };
}

/* ------------------------------------------------------------------ */
/* Admin: manual status transitions (MVP scheduler)                    */
/* ------------------------------------------------------------------ */

/**
 * Manual Activate / Pause / End. The state machine is the authority;
 * optimistic locking guards against double-clicks. Brand owners are
 * notified on activation and on end.
 */
export async function setCampaignStatus(
  adminId: number,
  id: number,
  toStatus: "active" | "paused" | "ended"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");

  assertTransition(
    CAMPAIGN_TRANSITIONS,
    campaign.status as CampaignStatus,
    toStatus,
    "campaign status"
  );

  const now = new Date();
  await db.transaction(async tx => {
    const updated = await tx
      .update(campaigns)
      .set({ status: toStatus, updatedAt: now })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, campaign.status)))
      .returning({ id: campaigns.id });
    if (updated.length === 0) {
      throw new Error("Campaign status changed — please reload and retry.");
    }
    await tx.insert(campaignAuditLog).values({
      campaignId: id,
      applicationId: campaign.applicationId,
      actorId: adminId,
      action: `campaign.${toStatus}`,
      details: { from: campaign.status },
    });
  });

  // Notify the brand owner on the two transitions they care about.
  if (
    (toStatus === "active" || toStatus === "ended") &&
    campaign.applicationId
  ) {
    const [application] = await db
      .select({ userId: brandApplications.userId })
      .from(brandApplications)
      .where(eq(brandApplications.id, campaign.applicationId))
      .limit(1);
    if (application) {
      const type =
        toStatus === "active"
          ? NOTIFICATION_TYPES.campaignActivated
          : NOTIFICATION_TYPES.campaignEnded;
      await insertNotification({
        userId: application.userId,
        type,
        title:
          toStatus === "active"
            ? "Your campaign is live"
            : "Your campaign has ended",
        body:
          toStatus === "active"
            ? `"${campaign.title}" is now active — creators can start publishing.`
            : `"${campaign.title}" has ended. The Sponsored badge stays on published content.`,
        entityType: "campaign",
        entityId: id,
        link: "/advertise/apply",
      });
    }
  }

  return { id, status: toStatus };
}

/* ------------------------------------------------------------------ */
/* Advertiser: Pause / Resume / End their own campaigns                */
/* ------------------------------------------------------------------ */

/**
 * Phase 6: the advertiser ("brand" = user who applied) can Pause, Resume,
 * or End their own campaigns — manual control, no cron. Draft activation
 * stays admin-only. Ownership is verified through the brand application.
 */
export async function updateMyCampaignStatus(
  userId: number,
  id: number,
  toStatus: "active" | "paused" | "ended"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      status: campaigns.status,
      applicationId: campaigns.applicationId,
      ownerId: brandApplications.userId,
    })
    .from(campaigns)
    .leftJoin(
      brandApplications,
      eq(brandApplications.id, campaigns.applicationId)
    )
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!campaign || campaign.ownerId !== userId) {
    throw new Error("Campaign not found.");
  }
  if (campaign.status === "draft" && toStatus === "active") {
    throw new Error("Only an admin can activate a draft campaign.");
  }
  assertTransition(
    CAMPAIGN_TRANSITIONS,
    campaign.status as CampaignStatus,
    toStatus,
    "campaign status"
  );

  const now = new Date();
  await db.transaction(async tx => {
    const updated = await tx
      .update(campaigns)
      .set({ status: toStatus, updatedAt: now })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, campaign.status)))
      .returning({ id: campaigns.id });
    if (updated.length === 0) {
      throw new Error("Campaign status changed — please reload and retry.");
    }
    await tx.insert(campaignAuditLog).values({
      campaignId: id,
      applicationId: campaign.applicationId,
      actorId: userId,
      action: `campaign.${toStatus}_by_advertiser`,
      details: { from: campaign.status },
    });
  });

  return { id, status: toStatus };
}

/* ------------------------------------------------------------------ */
/* Admin: invitations                                                  */
/* ------------------------------------------------------------------ */

/** Admin-only creator search for the invite UI (username / display name). */
export async function searchCreators(query: string, limit: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const term = `%${query.trim()}%`;
  return db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      photoUrl: profiles.photoUrl,
      accountType: profiles.accountType,
    })
    .from(profiles)
    .where(
      or(
        ilike(profiles.username, term),
        ilike(profiles.displayName, term)
      )
    )
    .orderBy(desc(profiles.userId))
    .limit(limit);
}

/**
 * Invite a creator. The reward comes out of the campaign's creator pool —
 * committed (pending + accepted) rewards can never exceed it. Re-invites
 * are only allowed after a decline/expiry: the terminal row is replaced by
 * a fresh pending invitation.
 */
export async function inviteCreator(
  adminId: number,
  input: z.output<typeof inviteCreatorInput>
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "ended") {
    throw new Error("Cannot invite creators to an ended campaign.");
  }
  if (!campaign.creatorPool || !campaign.budgetCurrency) {
    throw new Error("This campaign has no creator pool configured.");
  }

  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!invitee) throw new Error("Creator not found.");

  const rewardCurrency = campaign.budgetCurrency;

  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(campaignInvitations)
      .where(
        and(
          eq(campaignInvitations.campaignId, input.campaignId),
          eq(campaignInvitations.userId, input.userId)
        )
      )
      .limit(1);

    if (
      existing &&
      (existing.status === "pending" || existing.status === "accepted")
    ) {
      throw new Error("This creator is already invited to the campaign.");
    }

    // Pool guard: committed rewards + this one must fit the pool.
    const committed = await committedRewardsCents(
      // tx has the same query surface for our reads
      db,
      input.campaignId
    );
    if (committed + toCents(input.rewardAmount) > toCents(campaign.creatorPool as string)) {
      throw new Error(
        "This reward would exceed the campaign's remaining creator pool."
      );
    }

    // A declined/expired invite is terminal — replace it with a fresh one.
    if (existing) {
      await tx
        .delete(campaignInvitations)
        .where(eq(campaignInvitations.id, existing.id));
    }

    const [invitation] = await tx
      .insert(campaignInvitations)
      .values({
        campaignId: input.campaignId,
        userId: input.userId,
        status: "pending",
        rewardAmount: input.rewardAmount,
        rewardCurrency,
        message: orNull(input.message),
        expiresAt: campaign.endsAt ?? null,
      })
      .returning({ id: campaignInvitations.id });
    if (!invitation) throw new Error("Could not create the invitation.");

    await tx.insert(campaignAuditLog).values({
      campaignId: input.campaignId,
      applicationId: campaign.applicationId,
      actorId: adminId,
      action: existing
        ? "campaign.invitation_reopened"
        : "campaign.invitation_sent",
      details: {
        invitedUserId: input.userId,
        rewardAmount: input.rewardAmount,
        rewardCurrency,
      },
    });

    return { invitationId: invitation.id };
  }).then(async result => {
    // Notify outside the transaction — a notification failure must not
    // roll back the invitation itself.
    await insertNotification({
      userId: input.userId,
      type: NOTIFICATION_TYPES.campaignInvitation,
      title: "New campaign invitation",
      body: `You've been invited to "${campaign.title}" — ${rewardCurrency === "BDT" ? "৳" : "$"}${input.rewardAmount} reward.`,
      entityType: "campaign_invitation",
      entityId: result.invitationId,
      link: "/campaigns",
    });
    return result;
  });
}

/* ------------------------------------------------------------------ */
/* Brand: own campaigns                                                */
/* ------------------------------------------------------------------ */

/**
 * Brand owner's campaigns. Includes their own total budget (they proposed
 * it) but NEVER the pool/fee split — that's admin-internal.
 */
export async function listCampaignsForBrand(
  userId: number,
  input: { status?: CampaignStatus; limit: number; offset: number }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const conditions = [
    eq(brandApplications.userId, userId),
    ...(input.status != null ? [eq(campaigns.status, input.status)] : []),
  ];
  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      brief: campaigns.brief,
      status: campaigns.status,
      budgetTotal: campaigns.budgetTotal,
      budgetCurrency: campaigns.budgetCurrency,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      createdAt: campaigns.createdAt,
      brandName: brandApplications.brandName,
    })
    .from(campaigns)
    .innerJoin(
      brandApplications,
      eq(campaigns.applicationId, brandApplications.id)
    )
    .where(and(...conditions))
    .orderBy(desc(campaigns.createdAt))
    .limit(input.limit)
    .offset(input.offset);
  return { items: rows };
}

/** Brand owner's single campaign — ownership enforced, no pool/fee split. */
export async function getCampaignForBrand(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      brief: campaigns.brief,
      concepts: campaigns.concepts,
      rules: campaigns.rules,
      validationQuestions: campaigns.validationQuestions,
      status: campaigns.status,
      budgetTotal: campaigns.budgetTotal,
      budgetCurrency: campaigns.budgetCurrency,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      createdAt: campaigns.createdAt,
      brandName: brandApplications.brandName,
      ownerId: brandApplications.userId,
    })
    .from(campaigns)
    .innerJoin(
      brandApplications,
      eq(campaigns.applicationId, brandApplications.id)
    )
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row || row.ownerId !== userId) throw new Error("Campaign not found.");
  const { ownerId: _owner, ...campaign } = row;
  return { campaign };
}

/* ------------------------------------------------------------------ */
/* Creator: invitations + joined campaigns                             */
/* ------------------------------------------------------------------ */

/**
 * The creator's own invitations. PII-safe by construction: the reward is
 * THEIR offer, the brief is what they need — budget totals, pool, and fee
 * are never selected, so they can never leak.
 */
export async function listMyInvitations(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: campaignInvitations.id,
      status: campaignInvitations.status,
      rewardAmount: campaignInvitations.rewardAmount,
      rewardCurrency: campaignInvitations.rewardCurrency,
      message: campaignInvitations.message,
      invitedAt: campaignInvitations.invitedAt,
      respondedAt: campaignInvitations.respondedAt,
      expiresAt: campaignInvitations.expiresAt,
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
      campaignBrief: campaigns.brief,
      campaignConcepts: campaigns.concepts,
      campaignRules: campaigns.rules,
      campaignStatus: campaigns.status,
      campaignStartsAt: campaigns.startsAt,
      campaignEndsAt: campaigns.endsAt,
    })
    .from(campaignInvitations)
    .innerJoin(campaigns, eq(campaignInvitations.campaignId, campaigns.id))
    .where(eq(campaignInvitations.userId, userId))
    .orderBy(desc(campaignInvitations.invitedAt))
    .limit(50);
}

/**
 * Accept or decline an invitation. Only the invited creator can move it,
 * and only out of pending. The campaign admin is notified either way.
 */
export async function respondToInvitation(
  userId: number,
  invitationId: number,
  accept: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [invitation] = await db
    .select()
    .from(campaignInvitations)
    .where(eq(campaignInvitations.id, invitationId))
    .limit(1);
  if (!invitation || invitation.userId !== userId) {
    throw new Error("Invitation not found.");
  }

  const toStatus: CampaignInvitationStatus = accept ? "accepted" : "declined";
  assertTransition(
    CAMPAIGN_INVITATION_TRANSITIONS,
    invitation.status as CampaignInvitationStatus,
    toStatus,
    "invitation status"
  );

  const now = new Date();
  await db.transaction(async tx => {
    const updated = await tx
      .update(campaignInvitations)
      .set({ status: toStatus, respondedAt: now })
      .where(
        and(
          eq(campaignInvitations.id, invitationId),
          eq(campaignInvitations.status, "pending")
        )
      )
      .returning({ id: campaignInvitations.id });
    if (updated.length === 0) {
      throw new Error("Invitation already handled — please reload.");
    }
    await tx.insert(campaignAuditLog).values({
      campaignId: invitation.campaignId,
      actorId: userId,
      action: `campaign.invitation_${toStatus}`,
      details: { invitationId },
    });
  });

  // Notify the campaign's admin (the one who created it).
  const [campaign] = await db
    .select({ title: campaigns.title, createdBy: campaigns.createdBy })
    .from(campaigns)
    .where(eq(campaigns.id, invitation.campaignId))
    .limit(1);
  if (campaign?.createdBy) {
    const [profile] = await db
      .select({ displayName: profiles.displayName, username: profiles.username })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    const who = profile?.displayName || profile?.username || "A creator";
    await insertNotification({
      userId: campaign.createdBy,
      type: accept
        ? NOTIFICATION_TYPES.campaignInvitationAccepted
        : NOTIFICATION_TYPES.campaignInvitationDeclined,
      title: accept ? "Invitation accepted" : "Invitation declined",
      body: `${who} ${accept ? "accepted" : "declined"} the invitation to "${campaign.title}".`,
      entityType: "campaign",
      entityId: invitation.campaignId,
      link: "/admin",
    });
  }

  return { id: invitationId, status: toStatus };
}

/**
 * Campaigns the creator has joined (accepted invitation). Brief, concepts,
 * rules, deadlines — no money fields at all.
 */
export async function listMyCampaigns(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      brief: campaigns.brief,
      concepts: campaigns.concepts,
      rules: campaigns.rules,
      validationQuestions: campaigns.validationQuestions,
      status: campaigns.status,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
    })
    .from(campaigns)
    .innerJoin(
      campaignInvitations,
      and(
        eq(campaignInvitations.campaignId, campaigns.id),
        eq(campaignInvitations.userId, userId),
        eq(campaignInvitations.status, "accepted")
      )
    )
    .orderBy(desc(campaignInvitations.respondedAt))
    .limit(50);
}
