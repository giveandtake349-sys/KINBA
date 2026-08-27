import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  areUsersBlocked, blockUser, createConnection, createMessage, createReport, createSignal,
  ensureProfile, getConnectionForParticipant, getOwnProfile, getPublicProfile, getUserById, listConnections,
  getSignalById, listMessages, listOwnSignals, listSignals, setConnectionStatus, updateProfile,
} from "./db";
import { connectionRequestInput, isAcceptedParticipant, profileInput, reportInput, signalInput } from "./nivoValidation";

const positiveId = z.object({ id: z.number().int().positive() });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      await ensureProfile(ctx.user.id);
      return getOwnProfile(ctx.user.id);
    }),
    get: publicProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const profile = await getPublicProfile(input.userId, ctx.user?.id);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "This member profile is not available." });
      return profile;
    }),
    update: protectedProcedure.input(profileInput).mutation(({ ctx, input }) => updateProfile(ctx.user.id, input)),
  }),
  signals: router({
    list: publicProcedure.input(z.object({ type: z.enum(["need", "can"]).optional(), category: z.string().trim().min(2).max(64).optional() }).optional()).query(({ ctx, input }) => listSignals({ ...input, viewerId: ctx.user?.id })),
    mine: protectedProcedure.query(({ ctx }) => listOwnSignals(ctx.user.id)),
    create: protectedProcedure.input(signalInput).mutation(({ ctx, input }) => createSignal(ctx.user.id, input)),
  }),
  connections: router({
    list: protectedProcedure.query(({ ctx }) => listConnections(ctx.user.id)),
    request: protectedProcedure.input(connectionRequestInput).mutation(async ({ ctx, input }) => {
      if (input.recipientId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot connect with yourself." });
      if (await areUsersBlocked(ctx.user.id, input.recipientId)) throw new TRPCError({ code: "FORBIDDEN", message: "This connection is not available." });
      if (!await getUserById(input.recipientId)) throw new TRPCError({ code: "NOT_FOUND", message: "This profile is no longer available." });
      if (input.signalId) {
        const signal = await getSignalById(input.signalId);
        if (!signal || signal.userId !== input.recipientId || signal.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This signal is no longer available for connection." });
        }
      }
      try { return await createConnection(ctx.user.id, input); } catch (error) { throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : "Unable to create request." }); }
    }),
    accept: protectedProcedure.input(positiveId).mutation(async ({ ctx, input }) => {
      const connection = await getConnectionForParticipant(input.id, ctx.user.id);
      if (!connection || connection.recipientId !== ctx.user.id || connection.status !== "pending") throw new TRPCError({ code: "FORBIDDEN", message: "This request cannot be accepted." });
      if (await areUsersBlocked(connection.requesterId, connection.recipientId)) throw new TRPCError({ code: "FORBIDDEN", message: "This connection is no longer available." });
      await setConnectionStatus(input.id, "accepted");
      return { success: true };
    }),
    decline: protectedProcedure.input(positiveId).mutation(async ({ ctx, input }) => {
      const connection = await getConnectionForParticipant(input.id, ctx.user.id);
      if (!connection || connection.recipientId !== ctx.user.id || connection.status !== "pending") throw new TRPCError({ code: "FORBIDDEN", message: "This request cannot be declined." });
      await setConnectionStatus(input.id, "declined");
      return { success: true };
    }),
    cancel: protectedProcedure.input(positiveId).mutation(async ({ ctx, input }) => {
      const connection = await getConnectionForParticipant(input.id, ctx.user.id);
      if (!connection || connection.requesterId !== ctx.user.id || connection.status !== "pending") throw new TRPCError({ code: "FORBIDDEN", message: "This request cannot be cancelled." });
      await setConnectionStatus(input.id, "cancelled");
      return { success: true };
    }),
  }),
  messages: router({
    list: protectedProcedure.input(positiveId).query(async ({ ctx, input }) => {
      const connection = await getConnectionForParticipant(input.id, ctx.user.id);
      if (!connection || !isAcceptedParticipant(connection, ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "Messaging is available after the connection is accepted." });
      if (await areUsersBlocked(connection.requesterId, connection.recipientId)) throw new TRPCError({ code: "FORBIDDEN", message: "This conversation is no longer available." });
      return listMessages(input.id);
    }),
    send: protectedProcedure.input(z.object({ connectionId: z.number().int().positive(), body: z.string().trim().min(1).max(4000) })).mutation(async ({ ctx, input }) => {
      const connection = await getConnectionForParticipant(input.connectionId, ctx.user.id);
      if (!connection || !isAcceptedParticipant(connection, ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "Messaging is available after the connection is accepted." });
      if (await areUsersBlocked(connection.requesterId, connection.recipientId)) throw new TRPCError({ code: "FORBIDDEN", message: "This conversation is no longer available." });
      return createMessage(input.connectionId, ctx.user.id, input.body);
    }),
  }),
  trust: router({
    block: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot block yourself." });
      await blockUser(ctx.user.id, input.userId);
      return { success: true };
    }),
    report: protectedProcedure.input(reportInput).mutation(async ({ ctx, input }) => {
      if (input.reportedUserId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot report yourself." });
      await createReport(ctx.user.id, input);
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
