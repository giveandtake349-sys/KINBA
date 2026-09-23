import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  createAnnouncementComment,
  createCommunityAnnouncement,
  toggleCommunityBookmark,
  toggleCommunityReaction,
  createVideo,
  updateVideoDescription,
  deleteVideo,
  createVideoComment,
  deleteComment,
  toggleCommentLike,
  ensureProfile,
  getOwnProfile,
  getPublicProfile,
  listProfileVideos,
  listPublicProfileVideos,
  listCommunityAnnouncements,
  listAnnouncementComments,
  listHomeFeed,
  listNotifications,
  listVerificationTransactions,
  listVideoComments,
  approveVerificationTransaction,
  getVerificationStatus,
  submitVerificationTransaction,
  updateOwnProfile,
  searchVideos,
  searchAll,
  listVideos,
  listSponsorBidsSessions,
  getSponsorBidsSession,
  getSponsorBidsState,
  joinSponsorBidsSession,
  listLiveSponsors,
  listSessionWinners,
  getWalletBalance,
  getFollowState,
  createLiveSponsor,
  adminListDashboard,
  adminCreateSponsorBidsSession,
  adminStartSponsorBidsSession,
  adminSetSponsorStatus,
  recordVideoShare,
  recordVideoView,
  listBookmarkedVideos,
  toggleVideoBookmark,
  toggleVideoReaction,
  toggleFollow,
  getRawPulse,
  voteRawPulse,
  createRawPulse,
  createTextPost,
} from "./db";
import { communityAnnouncementInput, textPostInput, videoInput } from "./mediaValidation";
import {
  FEATURE_FLAG_KEYS,
  getActiveFeatureFlags,
  isFeatureFlagEnabled,
  listFeatureFlagRows,
  setFeatureFlag,
} from "./featureFlags";
import { getCoinBalance, listRewardHistory } from "./rewardLedger";
import {
  createHypeRoom,
  getHypeRoom,
  listActiveHypeRooms,
  resolveHypeRoomExpiry,
  ROOM_DURATION_HOURS,
} from "./hypeRooms";

async function requireFeatureFlag(key: (typeof FEATURE_FLAG_KEYS)[number]) {
  const enabled = await isFeatureFlagEnabled(key);
  if (!enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This feature is currently disabled.",
    });
  }
}

const videoIdInput = z.object({ videoId: z.number().int().positive() });
const announcementIdInput = z.object({
  announcementId: z.number().int().positive(),
});
const profileUpdateInput = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_]+$/i)
    .nullable()
    .optional(),
  photoUrl: z.string().url().max(1024).nullable().optional(),
  about: z.string().trim().max(500).nullable().optional(),
});
const sponsorInput = z.object({
  sessionId: z.number().int().positive(),
  logoUrl: z.string().url().max(1024),
  externalLink: z.string().url().max(2048),
  sponsoredAmount: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a valid sponsorship amount.")
    .refine(
      value => Number(value) > 0,
      "Sponsorship amount must be greater than zero."
    ),
});

const paymentInput = z.object({
  amount: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter a valid amount.")
    .refine(value => Number(value) > 0, "Enter an amount greater than zero."),
  paymentMethod: z.enum(["bkash", "nagad"]),
  senderNumber: z
    .string()
    .trim()
    .refine(
      value => /^(?:01\d{9}|8801\d{9})$/.test(value.replace(/[^0-9]/g, "")),
      "Enter a valid Bangladesh mobile number."
    ),
  transactionId: z
    .string()
    .trim()
    .min(4)
    .max(128)
    .regex(/^[a-z0-9_-]+$/i, "Enter a valid transaction ID."),
});

const hypeRoomCreateInput = z.object({
  title: z.string().trim().min(3).max(180),
  topic: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  durationHours: z.union([
    z.literal(ROOM_DURATION_HOURS[0]),
    z.literal(ROOM_DURATION_HOURS[1]),
    z.literal(ROOM_DURATION_HOURS[2]),
    z.literal(ROOM_DURATION_HOURS[3]),
  ]),
  visibility: z.enum(["public", "link_only"]).default("public"),
  startsAt: z.string().datetime({ offset: true }).optional(),
});

export const appRouter = router({
  system: systemRouter,
  features: router({
    active: publicProcedure.query(() => getActiveFeatureFlags()),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(() => ({ success: true }) as const),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      await ensureProfile(ctx.user.id);
      return getOwnProfile(ctx.user.id);
    }),
    byId: publicProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .query(({ input }) => getPublicProfile(input.userId)),
    update: protectedProcedure
      .input(profileUpdateInput)
      .mutation(({ ctx, input }) => updateOwnProfile(ctx.user.id, input)),
    videos: protectedProcedure.query(({ ctx }) =>
      listProfileVideos(ctx.user.id)
    ),
    videosById: publicProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .query(({ input }) => listPublicProfileVideos(input.userId)),
    verification: protectedProcedure.query(({ ctx }) =>
      getVerificationStatus(ctx.user.id)
    ),
    followState: protectedProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .query(({ ctx, input }) => getFollowState(ctx.user.id, input.userId)),
    toggleFollow: protectedProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => toggleFollow(ctx.user.id, input.userId)),
  }),
  home: router({
    search: publicProcedure
      .input(z.object({ term: z.string().trim().max(120) }))
      .query(({ ctx, input }) => searchVideos(input.term, ctx.user?.id)),
    searchAll: publicProcedure
      .input(z.object({ term: z.string().trim().max(120) }))
      .query(({ ctx, input }) => searchAll(input.term, ctx.user?.id)),
    notifications: protectedProcedure.query(({ ctx }) =>
      listNotifications(ctx.user.id)
    ),
    feed: publicProcedure
      .input(
        z.object({
          tab: z.enum([
            "all",
            "videos",
            "trendy",
            "following",
            "icons",
            "shorts",
            "wheels",
          ]),
        })
      )
      .query(({ ctx, input }) => listHomeFeed(input.tab, ctx.user?.id)),
  }),
  rawPulse: router({
    get: publicProcedure
      .input(videoIdInput.extend({ voterKey: z.string().trim().min(16).max(128).optional() }))
      .query(({ ctx, input }) => getRawPulse(input.videoId, input.voterKey, ctx.user?.id)),
    vote: publicProcedure
      .input(z.object({ pollId: z.number().int().positive(), optionId: z.number().int().positive(), voterKey: z.string().trim().min(16).max(128) }))
      .mutation(({ ctx, input }) => voteRawPulse(input.pollId, input.optionId, input.voterKey, ctx.user?.id)),
    create: protectedProcedure
      .input(z.object({
        videoId: z.number().int().positive(),
        question: z.string().trim().min(3).max(180),
        options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
        expiresAt: z.coerce.date().nullable().optional(),
      }).refine(input => new Set(input.options.map(option => option.toLowerCase())).size === input.options.length, "Raw Pulse options must be unique."))
      .mutation(({ ctx, input }) => createRawPulse(input.videoId, ctx.user.id, input.question, input.options, input.expiresAt ?? null)),
  }),
  videos: router({
    list: publicProcedure
      .input(z.object({ kind: z.enum(["LONG", "SHORT", "WHEEL"]) }))
      .query(({ ctx, input }) => listVideos(input.kind, ctx.user?.id)),
    create: protectedProcedure
      .input(videoInput)
      .mutation(async ({ ctx, input }) => {
        return createVideo(ctx.user.id, input);
      }),
    createText: protectedProcedure
      .input(textPostInput)
      .mutation(({ ctx, input }) => createTextPost(ctx.user.id, input)),
    updateDescription: protectedProcedure
      .input(videoIdInput.extend({ description: z.string().max(2000) }))
      .mutation(({ ctx, input }) => updateVideoDescription(input.videoId, ctx.user.id, input.description)),
    delete: protectedProcedure
      .input(videoIdInput)
      .mutation(({ ctx, input }) => deleteVideo(input.videoId, ctx.user.id)),
    react: protectedProcedure
      .input(videoIdInput)
      .mutation(({ ctx, input }) =>
        toggleVideoReaction(input.videoId, ctx.user.id)
      ),
    share: protectedProcedure
      .input(videoIdInput)
      .mutation(({ ctx, input }) =>
        recordVideoShare(input.videoId, ctx.user.id)
      ),
    bookmark: protectedProcedure
      .input(videoIdInput)
      .mutation(({ ctx, input }) =>
        toggleVideoBookmark(input.videoId, ctx.user.id)
      ),
    bookmarked: protectedProcedure.query(({ ctx }) =>
      listBookmarkedVideos(ctx.user.id)
    ),
    view: publicProcedure
      .input(videoIdInput)
      .mutation(({ ctx, input }) => {
        const forwarded = ctx.req.headers["x-forwarded-for"];
        const ip = typeof forwarded === "string"
          ? forwarded.split(",")[0].trim()
          : ctx.req.socket.remoteAddress ?? "unknown";
        return recordVideoView(input.videoId, ip);
      }),
    comments: router({
      list: publicProcedure
        .input(videoIdInput)
        .query(({ ctx, input }) => listVideoComments(input.videoId, ctx.user?.id)),
      create: protectedProcedure
        .input(
          videoIdInput
            .extend({
              body: z.string().trim().max(500).default(""),
              audioUrl: z.string().url().nullable().optional(),
              audioDuration: z.number().int().min(1).max(60).nullable().optional(),
              parentId: z.number().int().positive().nullable().optional(),
            })
            .refine(
              input => input.body.trim().length > 0 || Boolean(input.audioUrl),
              "Comment text or audio is required."
            )
        )
        .mutation(({ ctx, input }) => {
          const options = {
            audioUrl: input.audioUrl,
            audioDuration: input.audioDuration,
            parentId: input.parentId,
          };
          return input.audioUrl || input.parentId !== undefined
            ? createVideoComment(input.videoId, ctx.user.id, input.body, options)
            : createVideoComment(input.videoId, ctx.user.id, input.body);
        }),
      delete: protectedProcedure
        .input(z.object({ commentId: z.number().int().positive() }))
        .mutation(({ ctx, input }) => deleteComment(input.commentId, ctx.user.id)),
      like: protectedProcedure
        .input(z.object({ commentId: z.number().int().positive() }))
        .mutation(({ ctx, input }) => toggleCommentLike(input.commentId, ctx.user.id)),
    }),
  }),
  payments: router({
    status: protectedProcedure.query(({ ctx }) =>
      getVerificationStatus(ctx.user.id)
    ),
    submit: protectedProcedure
      .input(paymentInput)
      .mutation(async ({ ctx, input }) => {
        await ensureProfile(ctx.user.id);
        return submitVerificationTransaction(ctx.user.id, input);
      }),
    all: adminProcedure.query(() => listVerificationTransactions()),
    approve: adminProcedure
      .input(
        z.object({
          transactionId: z.number().int().positive(),
          status: z.enum(["approved", "rejected"]),
          accountType: z.enum(["creator", "company"]).default("creator"),
        })
      )
      .mutation(({ ctx, input }) =>
        approveVerificationTransaction(
          input.transactionId,
          ctx.user.id,
          input.status,
          input.accountType
        )
      ),
  }),
  sponsorBids: router({
    sessions: publicProcedure.query(() => listSponsorBidsSessions()),
    session: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(({ input }) => getSponsorBidsSession(input.sessionId)),
    state: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(({ input }) => getSponsorBidsState(input.sessionId)),
    join: protectedProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(({ ctx, input }) =>
        joinSponsorBidsSession(input.sessionId, ctx.user.id)
      ),
    liveSponsors: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(({ input }) => listLiveSponsors(input.sessionId)),
    winners: publicProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .query(({ input }) => listSessionWinners(input.sessionId)),
    walletBalance: protectedProcedure.query(({ ctx }) =>
      getWalletBalance(ctx.user.id)
    ),
    sponsor: protectedProcedure
      .input(sponsorInput)
      .mutation(({ ctx, input }) =>
        createLiveSponsor({ ...input, userId: ctx.user.id })
      ),
  }),
  admin: router({
    dashboard: adminProcedure.query(() => adminListDashboard()),
    featureFlags: router({
      list: adminProcedure.query(() => listFeatureFlagRows()),
      set: adminProcedure
        .input(
          z.object({
            flagKey: z.enum(FEATURE_FLAG_KEYS),
            enabled: z.boolean(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          try {
            return await setFeatureFlag(
              input.flagKey,
              input.enabled,
              ctx.user.id
            );
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to update feature flag.",
            });
          }
        }),
    }),
    createSession: adminProcedure
      .input(
        z.object({
          title: z.string().trim().min(3).max(180),
          startsAt: z.string().datetime({ offset: true }).optional(),
        })
      )
      .mutation(({ input }) =>
        adminCreateSponsorBidsSession({
          title: input.title,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        })
      ),
    startSession: adminProcedure
      .input(z.object({ sessionId: z.number().int().positive() }))
      .mutation(({ input }) => adminStartSponsorBidsSession(input.sessionId)),
    setSponsorStatus: adminProcedure
      .input(
        z.object({
          sponsorId: z.number().int().positive(),
          status: z.enum(["approved", "rejected"]),
        })
      )
      .mutation(({ input }) =>
        adminSetSponsorStatus(input.sponsorId, input.status)
      ),
  }),
  rewards: router({
    balance: protectedProcedure.query(async ({ ctx }) => {
      await requireFeatureFlag("jhilik_rewards");
      return getCoinBalance(ctx.user.id);
    }),
    history: protectedProcedure.query(async ({ ctx }) => {
      await requireFeatureFlag("jhilik_rewards");
      return listRewardHistory(ctx.user.id);
    }),
  }),
  // Temporary Hype/Community rooms — fail-closed behind time_limited_communities.
  hypeRooms: router({
    create: protectedProcedure
      .input(hypeRoomCreateInput)
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        await ensureProfile(ctx.user.id);
        return createHypeRoom(ctx.user.id, {
          title: input.title,
          topic: input.topic ?? null,
          description: input.description ?? null,
          durationHours: input.durationHours,
          visibility: input.visibility,
          startsAt: input.startsAt ?? null,
        });
      }),
    byId: publicProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .query(async ({ input }) => {
        await requireFeatureFlag("time_limited_communities");
        return getHypeRoom(input.roomId);
      }),
    list: publicProcedure.query(async () => {
      await requireFeatureFlag("time_limited_communities");
      return listActiveHypeRooms();
    }),
    resolve: publicProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await requireFeatureFlag("time_limited_communities");
        return resolveHypeRoomExpiry(input.roomId);
      }),
  }),
  community: router({
    list: publicProcedure.query(() => listCommunityAnnouncements()),
    mine: protectedProcedure.query(({ ctx }) => listCommunityAnnouncements(ctx.user.id)),
    create: protectedProcedure
      .input(communityAnnouncementInput)
      .mutation(({ ctx, input }) =>
        createCommunityAnnouncement(ctx.user.id, input)
      ),
    react: protectedProcedure
      .input(announcementIdInput)
      .mutation(({ ctx, input }) =>
        toggleCommunityReaction(input.announcementId, ctx.user.id)
      ),
    bookmark: protectedProcedure
      .input(announcementIdInput)
      .mutation(({ ctx, input }) =>
        toggleCommunityBookmark(input.announcementId, ctx.user.id)
      ),
    comments: router({
      list: publicProcedure
        .input(announcementIdInput)
        .query(({ input }) => listAnnouncementComments(input.announcementId)),
      create: protectedProcedure
        .input(
          announcementIdInput
            .extend({
              body: z.string().trim().max(500).default(""),
              audioUrl: z.string().url().nullable().optional(),
              audioDuration: z.number().int().min(1).max(60).nullable().optional(),
            })
            .refine(
              input => input.body.trim().length > 0 || Boolean(input.audioUrl),
              "Comment text or audio is required."
            )
        )
        .mutation(({ ctx, input }) =>
          input.audioUrl
            ? createAnnouncementComment(input.announcementId, ctx.user.id, input.body, {
                audioUrl: input.audioUrl,
                audioDuration: input.audioDuration,
              })
            : createAnnouncementComment(input.announcementId, ctx.user.id, input.body)
        ),
    }),
  }),
});
export type AppRouter = typeof appRouter;
