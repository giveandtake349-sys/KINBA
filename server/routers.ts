import { z } from "zod";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createCommunityAnnouncement,
  createVideo,
  ensureProfile,
  getOwnProfile,
  listCommunityAnnouncements,
  listHomeFeed,
  listVideos,
  recordVideoShare,
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
