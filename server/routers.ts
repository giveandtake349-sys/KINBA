import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  createCommunityAnnouncement,
  createVideo,
  createVideoComment,
  ensureProfile,
  getOwnProfile,
  listCommunityAnnouncements,
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
  recordVideoShare,
  recordVideoView,
  toggleVideoReaction,
} from "./db";
import { communityAnnouncementInput, videoInput } from "./mediaValidation";
import { queueVideoTranscode } from "./hlsProcessor";

const videoIdInput = z.object({ videoId: z.number().int().positive() });
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
    verification: protectedProcedure.query(({ ctx }) =>
      getVerificationStatus(ctx.user.id)
    ),
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
        z.object({ tab: z.enum(["videos", "trendy", "following", "icons"]) })
      )
      .query(({ ctx, input }) => listHomeFeed(input.tab, ctx.user?.id)),
  }),
  videos: router({
    list: publicProcedure
      .input(z.object({ kind: z.enum(["LONG", "SHORT"]) }))
      .query(({ ctx, input }) => listVideos(input.kind, ctx.user?.id)),
    create: protectedProcedure
      .input(videoInput)
      .mutation(async ({ ctx, input }) => {
        const created = await createVideo(ctx.user.id, input);
        queueVideoTranscode(created.id, input.videoUrl);
        return created;
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
  community: router({
    list: publicProcedure.query(() => listCommunityAnnouncements()),
    create: protectedProcedure
      .input(communityAnnouncementInput)
      .mutation(({ ctx, input }) =>
        createCommunityAnnouncement(ctx.user.id, input)
      ),
  }),
});
export type AppRouter = typeof appRouter;
