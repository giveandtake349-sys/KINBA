import { z } from "zod";
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
  createVideoComment,
  ensureProfile,
  getOwnProfile,
  listProfileVideos,
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
} from "./db";
import { communityAnnouncementInput, videoInput } from "./mediaValidation";

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

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(() => ({ success: true }) as const),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      await ensureProfile(ctx.user.id);
      return getOwnProfile(ctx.user.id);
    }),
    update: protectedProcedure
      .input(profileUpdateInput)
      .mutation(({ ctx, input }) => updateOwnProfile(ctx.user.id, input)),
    videos: protectedProcedure.query(({ ctx }) =>
      listProfileVideos(ctx.user.id)
    ),
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
  videos: router({
    list: publicProcedure
      .input(z.object({ kind: z.enum(["LONG", "SHORT", "WHEEL"]) }))
      .query(({ ctx, input }) => listVideos(input.kind, ctx.user?.id)),
    create: protectedProcedure
      .input(videoInput)
      .mutation(async ({ ctx, input }) => {
        return createVideo(ctx.user.id, input);
      }),
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
      .mutation(({ input }) => recordVideoView(input.videoId)),
    comments: router({
      list: publicProcedure
        .input(videoIdInput)
        .query(({ input }) => listVideoComments(input.videoId)),
      create: protectedProcedure
        .input(videoIdInput.extend({ body: z.string().trim().min(1).max(500) }))
        .mutation(({ ctx, input }) =>
          createVideoComment(input.videoId, ctx.user.id, input.body)
        ),
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
        })
      )
      .mutation(({ ctx, input }) =>
        approveVerificationTransaction(
          input.transactionId,
          ctx.user.id,
          input.status
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
  community: router({
    list: publicProcedure.query(() => listCommunityAnnouncements()),
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
          announcementIdInput.extend({
            body: z.string().trim().min(1).max(500),
          })
        )
        .mutation(({ ctx, input }) =>
          createAnnouncementComment(
            input.announcementId,
            ctx.user.id,
            input.body
          )
        ),
    }),
  }),
});
export type AppRouter = typeof appRouter;
