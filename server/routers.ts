import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createCommunityAnnouncement,
  createVideo,
  createVideoComment,
  ensureProfile,
  getOwnProfile,
  listCommunityAnnouncements,
  listHomeFeed,
  listNotifications,
  listVideoComments,
  searchVideos,
  listVideos,
  recordVideoShare,
  recordVideoView,
  toggleVideoReaction,
} from "./db";
import { communityAnnouncementInput, videoInput } from "./mediaValidation";

const videoIdInput = z.object({ videoId: z.number().int().positive() });

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
      .mutation(({ ctx, input }) => createVideo(ctx.user.id, input)),
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
