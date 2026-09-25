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
  toggleCommentReaction,
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
  listFollowers,
  listFollowing,
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
import { REACTION_TYPES } from "@shared/reactions";
import {
  FEATURE_FLAG_KEYS,
  getActiveFeatureFlags,
  isFeatureFlagEnabled,
  listFeatureFlagRows,
  setFeatureFlag,
} from "./featureFlags";
import { getCoinBalance, listRewardHistory } from "./rewardLedger";
import {
  getUnreadNotificationCount,
  listUserNotifications,
  markUserNotificationsRead,
  notifyNewFollower,
} from "./notifications";
import {
  adminArchiveHypeRoom,
  adminBanHypeRoomMember,
  adminForceEndHypeRoom,
  acceptHypeRoomInvite,
  cancelHypeRoom,
  createHypeRoom,
  createHypeRoomInvite,
  endHypeRoom,
  getHypeRoom,
  joinHypeRoom,
  leaveHypeRoom,
  listActiveHypeRooms,
  listAdminHypeRooms,
  listHypeRoomInvites,
  listHypeRoomMembers,
  listMyHypeRoomInvites,
  listRoomMessages,
  pinHypeRoomMessage,
  removeHypeRoomMember,
  resolveHypeRoomExpiry,
  sendHypeRoomMessage,
  setHypeRoomMemberRole,
  toggleHypeRoomMessageReaction,
  unpinHypeRoomMessage,
  updateHypeRoomSettings,
  HYPE_ROOM_REACTIONS,
  ROOM_DURATION_HOURS,
  ROOM_MESSAGE_MAX_LENGTH,
} from "./hypeRooms";
import {
  adminFeatureDrop,
  adminForceEndDrop,
  adminTakedownDrop,
  assertDropOwner,
  cancelClaim,
  claimDrop,
  endDrop,
  fulfillClaim,
  getDrop,
  getMyClaim,
  listAdminDrops,
  listDrops,
  listDropClaims,
  publishDrop,
  saveDraftDrop,
  scheduleDrop,
} from "./drops";
import {
  MODERATION_TARGET_TYPES,
  adminHideRoomMessage,
  createModerationReport,
  listModerationReports,
  resolveModerationReport,
} from "./moderation";

async function requireFeatureFlag(key: (typeof FEATURE_FLAG_KEYS)[number]) {
  const enabled = await isFeatureFlagEnabled(key);
  if (!enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This feature is currently disabled.",
    });
  }
}

/**
 * Map service member errors to controlled tRPC codes.
 * Unknown errors are rethrown unchanged (preserves M1 behavior).
 */
function mapHypeRoomMemberError(error: unknown, _op: string): TRPCError {
  if (error instanceof TRPCError) return error;
  const message = error instanceof Error ? error.message : "";
  if (message === "Room not found.") {
    return new TRPCError({ code: "NOT_FOUND", message });
  }
  if (message === "You are banned from this room.") {
    return new TRPCError({ code: "FORBIDDEN", message });
  }
  if (
    message === "You are already a member of this room." ||
    message === "You are not an active member of this room." ||
    message === "You are not a member of this room." ||
    message === "The host cannot leave the room."
  ) {
    return new TRPCError({ code: "CONFLICT", message });
  }
  if (message === "This room is no longer accepting new members.") {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message,
    });
  }
  // M4 — messages / host controls (extend without changing M1/M2 branches).
  if (
    message === "Message not found." ||
    message === "Member not found in this room."
  ) {
    return new TRPCError({ code: "NOT_FOUND", message });
  }
  if (
    message === "Only the host can end the room." ||
    message === "Only the host can pin messages." ||
    message === "Only the host can remove members." ||
    message === "The host cannot be removed from the room." ||
    message === "Only the host can cancel the room."
  ) {
    return new TRPCError({ code: "FORBIDDEN", message });
  }
  if (
    message === "The room has already ended." ||
    message === "Only a live room can be ended by the host." ||
    message === "Messages can only be sent while the room is live."
  ) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message });
  }
  if (
    message === "Message body is required." ||
    message.startsWith("Message body must be at most")
  ) {
    return new TRPCError({ code: "BAD_REQUEST", message });
  }
  // M6 — host scheduled-cancel + create eligibility.
  if (
    message === "Only a scheduled room can be cancelled." ||
    message === "A live room cannot be cancelled; end it instead." ||
    message === "Room is no longer in scheduled state." ||
    message === "The room is already archived."
  ) {
    return new TRPCError({ code: "CONFLICT", message });
  }
  if (message.startsWith("Only verified company/creator")) {
    return new TRPCError({ code: "FORBIDDEN", message });
  }
  // M-A1/M-A2 — chat depth, roles, settings, invites.
  if (message === "Invite not found." || message === "Invite target not found.") {
    return new TRPCError({ code: "NOT_FOUND", message });
  }
  if (
    message === "Reply target is not in this room." ||
    message === "Cannot reply to itself." ||
    message === "You can only reply to top-level messages." ||
    message === "Message does not belong to this room." ||
    message === "Invalid reaction type." ||
    message === "Invalid mention target." ||
    message === "You can only mention active members of this room." ||
    message === "Invalid room role." ||
    message === "No settings provided."
  ) {
    return new TRPCError({ code: "BAD_REQUEST", message });
  }
  if (
    message === "Only the host can change member roles." ||
    message === "Only the host can update room settings." ||
    message === "Only the host can create invites." ||
    message === "Only the host can list invites." ||
    message === "The host role cannot be changed." ||
    message === "The host cannot be invited." ||
    message === "This invite was not created for you."
  ) {
    return new TRPCError({ code: "FORBIDDEN", message });
  }
  if (
    message === "This room can no longer be edited." ||
    message === "This room is no longer accepting invites." ||
    message === "This invite is no longer valid." ||
    message === "An invite is already pending for this user." ||
    message === "This user has already been invited and accepted." ||
    message === "This user is already a member of this room."
  ) {
    return new TRPCError({ code: "CONFLICT", message });
  }
  // M8 — admin forceEnd / archive / banUser status guards.
  if (
    message === "Only a live room can be force-ended." ||
    message === "A live room cannot be archived." ||
    message === "Only scheduled or expired rooms can be archived." ||
    message === "Room is no longer in expected state." ||
    message === "Cannot ban members in an archived room." ||
    message === "Failed to ban member."
  ) {
    return new TRPCError({ code: "CONFLICT", message });
  }
  // Preserve original error for anything else (DB/driver/internal).
  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
      cause: error,
    });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error });
}

/**
 * Map service drop/claim errors to controlled tRPC codes (M3).
 * Unknown errors are rethrown unchanged (preserves M1/M2 behavior).
 */
function mapDropError(error: unknown, _op: string): TRPCError {
  if (error instanceof TRPCError) return error;
  const message = error instanceof Error ? error.message : "";
  if (message === "Drop not found." || message === "Claim not found.") {
    return new TRPCError({ code: "NOT_FOUND", message });
  }
  if (
    message === "This drop is sold out." ||
    message === "This drop is no longer available." ||
    message.includes("already claimed") ||
    message.includes("Invalid drop transition") ||
    message.includes("Invalid claim transition") ||
    message.includes("Claim is not in claimed state") ||
    message.includes("Claim is no longer in claimed state") ||
    message.includes("Only draft drops") ||
    message.includes("cannot be ended") ||
    message.includes("Failed to")
  ) {
    return new TRPCError({ code: "CONFLICT", message });
  }
  if (
    message === "This drop has ended." ||
    message === "This drop is not live yet."
  ) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message });
  }
  if (
    message === "You do not own this drop." ||
    message.startsWith("Only eligible sellers")
  ) {
    return new TRPCError({ code: "FORBIDDEN", message });
  }
  if (
    message.includes("Drop title") ||
    message.includes("Discounted price") ||
    message.includes("Original price") ||
    message.includes("Quantity must") ||
    message.includes("Start and end") ||
    message.includes("End time") ||
    message.includes("Idempotency key") ||
    message.includes("Description") ||
    message.includes("Terms") ||
    message.includes("Media URL") ||
    message.includes("remaining quantity") ||
    message.includes("Date is invalid") ||
    message.includes("Start or end") ||
    message.includes("Takedown reason")
  ) {
    return new TRPCError({ code: "BAD_REQUEST", message });
  }
  if (message === "Failed to update drop featured state.") {
    return new TRPCError({ code: "CONFLICT", message });
  }
  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
      cause: error,
    });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error });
}

/** Map M9 moderation service errors to controlled tRPC codes. */
function mapModerationError(error: unknown, _op: string): TRPCError {
  if (error instanceof TRPCError) return error;
  const message = error instanceof Error ? error.message : "";
  if (
    message === "Report target not found." ||
    message === "Report not found." ||
    message === "Message not found."
  ) {
    return new TRPCError({ code: "NOT_FOUND", message });
  }
  if (
    message === "You already have an open report for this target." ||
    message === "Report is not open." ||
    message === "Message is already hidden."
  ) {
    return new TRPCError({ code: "CONFLICT", message });
  }
  if (message === "You cannot report yourself.") {
    return new TRPCError({ code: "FORBIDDEN", message });
  }
  if (
    message.startsWith("Report reason") ||
    message.startsWith("Report details") ||
    message.startsWith("Resolution reason") ||
    message.startsWith("Hide reason") ||
    message === "Report targetId is required." ||
    message === "Report id is required." ||
    message === "Message id is required."
  ) {
    return new TRPCError({ code: "BAD_REQUEST", message });
  }
  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
      cause: error,
    });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error });
}

const videoIdInput = z.object({ videoId: z.number().int().positive() });
// Follower/following pages: backend offset/limit (50-row batches, max 100).
const followListPageInput = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
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

const dropIdInput = z.object({ dropId: z.number().int().positive() });

const dropSaveDraftInput = z.object({
  dropId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(1).max(4000),
  terms: z.string().trim().min(1).max(4000),
  mediaUrl: z.string().trim().min(1).max(1024),
  mediaWidth: z.number().int().positive().nullable().optional(),
  mediaHeight: z.number().int().positive().nullable().optional(),
  originalPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid price."),
  discountedPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid price."),
  quantity: z.number().int().positive(),
  startsAt: z
    .union([z.string().datetime({ offset: true }), z.date()])
    .nullable()
    .optional(),
  endsAt: z
    .union([z.string().datetime({ offset: true }), z.date()])
    .nullable()
    .optional(),
});

const dropWindowInput = z.object({
  dropId: z.number().int().positive(),
  startsAt: z
    .union([z.string().datetime({ offset: true }), z.date()])
    .nullable()
    .optional(),
  endsAt: z
    .union([z.string().datetime({ offset: true }), z.date()])
    .nullable()
    .optional(),
  mode: z.enum(["publish", "schedule"]).optional(),
});

const dropClaimInput = z.object({
  dropId: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
});

const dropClaimTransitionInput = z.object({
  dropId: z.number().int().positive(),
  claimId: z.number().int().positive(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const dropListInput = z
  .object({
    filter: z.enum(["live", "upcoming", "mine", "all"]).default("live"),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .optional();

// M7 — durable notification reads (no new feature flag; home.notifications unchanged).
const notificationListInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
  })
  .optional();

const notificationMarkReadInput = z
  .object({
    ids: z.array(z.number().int().positive()).max(200).optional(),
  })
  .optional();

// M6 — lobby filters only (spec §18.3). Default preserves M1 active list.
const hypeRoomListInput = z
  .object({
    filter: z.enum(["live", "upcoming", "mine"]).optional(),
  })
  .optional();

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
      .mutation(async ({ ctx, input }) => {
        const state = await toggleFollow(ctx.user.id, input.userId);
        // Durable alert only on the follow-start transition (never unfollow).
        if (state.following) {
          await notifyNewFollower(ctx.user.id, input.userId);
        }
        return state;
      }),
    followers: publicProcedure
      .input(
        followListPageInput.extend({
          userId: z.number().int().positive(),
        })
      )
      .query(({ ctx, input }) =>
        listFollowers(input.userId, ctx.user?.id, {
          limit: input.limit,
          offset: input.offset,
        })
      ),
    following: publicProcedure
      .input(
        followListPageInput.extend({
          userId: z.number().int().positive(),
        })
      )
      .query(({ ctx, input }) =>
        listFollowing(input.userId, ctx.user?.id, {
          limit: input.limit,
          offset: input.offset,
        })
      ),
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
  // M7 — durable notifications (§21.1 / §22). Protected; no feature flag.
  // home.notifications remains the separate derived activity feed.
  notifications: router({
    list: protectedProcedure
      .input(notificationListInput)
      .query(({ ctx, input }) =>
        listUserNotifications(ctx.user.id, input?.limit)
      ),
    unreadCount: protectedProcedure.query(({ ctx }) =>
      getUnreadNotificationCount(ctx.user.id)
    ),
    markRead: protectedProcedure
      .input(notificationMarkReadInput)
      .mutation(({ ctx, input }) =>
        markUserNotificationsRead(ctx.user.id, input?.ids)
      ),
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
      // Threaded reply batching: without `parentId` the caller gets top-level
      // comments (+ replyCount); with `parentId` it gets one batch of direct
      // replies for that comment. Existing callers keep the same array shape.
      list: publicProcedure
        .input(
          videoIdInput.extend({
            parentId: z.number().int().positive().optional(),
            limit: z.number().int().min(1).max(50).optional(),
            offset: z.number().int().min(0).optional(),
          })
        )
        .query(({ ctx, input }) =>
          listVideoComments(input.videoId, ctx.user?.id, {
            parentId: input.parentId,
            limit: input.limit,
            offset: input.offset,
          })
        ),
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
      react: protectedProcedure
        .input(
          z.object({
            commentId: z.number().int().positive(),
            reaction: z.enum(REACTION_TYPES),
          })
        )
        .mutation(({ ctx, input }) =>
          toggleCommentReaction(input.commentId, ctx.user.id, input.reaction)
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
    // M8 — admin Hype Rooms (flag time_limited_communities; no host checks).
    hypeRooms: router({
      list: adminProcedure
        .input(
          z
            .object({
              status: z
                .enum(["scheduled", "live", "expired", "archived"])
                .optional(),
            })
            .optional()
        )
        .query(async ({ input }) => {
          await requireFeatureFlag("time_limited_communities");
          try {
            return await listAdminHypeRooms({ status: input?.status });
          } catch (error) {
            throw mapHypeRoomMemberError(error, "admin.list");
          }
        }),
      forceEnd: adminProcedure
        .input(z.object({ roomId: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          await requireFeatureFlag("time_limited_communities");
          try {
            return await adminForceEndHypeRoom(input.roomId);
          } catch (error) {
            throw mapHypeRoomMemberError(error, "admin.forceEnd");
          }
        }),
      archive: adminProcedure
        .input(
          z.object({
            roomId: z.number().int().positive(),
            cancelReason: z.string().trim().max(500).nullable().optional(),
          })
        )
        .mutation(async ({ input }) => {
          await requireFeatureFlag("time_limited_communities");
          try {
            return await adminArchiveHypeRoom(
              input.roomId,
              input.cancelReason ?? null
            );
          } catch (error) {
            throw mapHypeRoomMemberError(error, "admin.archive");
          }
        }),
      banUser: adminProcedure
        .input(
          z.object({
            roomId: z.number().int().positive(),
            userId: z.number().int().positive(),
          })
        )
        .mutation(async ({ input }) => {
          await requireFeatureFlag("time_limited_communities");
          try {
            return await adminBanHypeRoomMember(input.roomId, input.userId);
          } catch (error) {
            throw mapHypeRoomMemberError(error, "admin.banUser");
          }
        }),
    }),
    // M8 — admin Drops (flag jhilik_drops; no seller ownership checks).
    drops: router({
      list: adminProcedure
        .input(
          z
            .object({
              status: z
                .enum([
                  "draft",
                  "scheduled",
                  "live",
                  "sold_out",
                  "ended",
                  "archived",
                ])
                .optional(),
              featured: z.boolean().optional(),
              limit: z.number().int().min(1).max(100).optional(),
            })
            .optional()
        )
        .query(async ({ input }) => {
          await requireFeatureFlag("jhilik_drops");
          try {
            return await listAdminDrops({
              status: input?.status,
              featured: input?.featured,
              limit: input?.limit,
            });
          } catch (error) {
            throw mapDropError(error, "admin.list");
          }
        }),
      feature: adminProcedure
        .input(
          z.object({
            dropId: z.number().int().positive(),
            featured: z.boolean(),
          })
        )
        .mutation(async ({ input }) => {
          await requireFeatureFlag("jhilik_drops");
          try {
            return await adminFeatureDrop(input.dropId, input.featured);
          } catch (error) {
            throw mapDropError(error, "admin.feature");
          }
        }),
      forceEnd: adminProcedure
        .input(z.object({ dropId: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          await requireFeatureFlag("jhilik_drops");
          try {
            return await adminForceEndDrop(input.dropId);
          } catch (error) {
            throw mapDropError(error, "admin.forceEnd");
          }
        }),
      takedown: adminProcedure
        .input(
          z.object({
            dropId: z.number().int().positive(),
            reason: z.string().trim().max(500).optional(),
          })
        )
        .mutation(async ({ input }) => {
          await requireFeatureFlag("jhilik_drops");
          try {
            return await adminTakedownDrop(input.dropId, input.reason ?? null);
          } catch (error) {
            throw mapDropError(error, "admin.takedown");
          }
        }),
    }),
    // M9 — admin report queue + resolve + message soft-hide (flag moderation_v1).
    reports: router({
      list: adminProcedure
        .input(
          z
            .object({
              status: z.enum(["open", "resolved"]).optional(),
              targetType: z.enum(MODERATION_TARGET_TYPES).optional(),
              limit: z.number().int().min(1).max(100).optional(),
            })
            .optional()
        )
        .query(async ({ input }) => {
          await requireFeatureFlag("moderation_v1");
          try {
            return await listModerationReports({
              status: input?.status,
              targetType: input?.targetType,
              limit: input?.limit,
            });
          } catch (error) {
            throw mapModerationError(error, "admin.reports.list");
          }
        }),
      resolve: adminProcedure
        .input(
          z.object({
            reportId: z.number().int().positive(),
            reason: z.string().trim().min(1).max(500),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requireFeatureFlag("moderation_v1");
          try {
            return await resolveModerationReport(
              ctx.user.id,
              input.reportId,
              input.reason
            );
          } catch (error) {
            throw mapModerationError(error, "admin.reports.resolve");
          }
        }),
    }),
    messages: router({
      hide: adminProcedure
        .input(
          z.object({
            messageId: z.number().int().positive(),
            reason: z.string().trim().min(1).max(500),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requireFeatureFlag("moderation_v1");
          try {
            return await adminHideRoomMessage(
              ctx.user.id,
              input.messageId,
              input.reason
            );
          } catch (error) {
            throw mapModerationError(error, "admin.messages.hide");
          }
        }),
    }),
  }),
  // M9 — user report creation (protected; flag moderation_v1; rate-limited middleware).
  reports: router({
    create: protectedProcedure
      .input(
        z.object({
          targetType: z.enum(MODERATION_TARGET_TYPES),
          targetId: z.number().int().positive(),
          reason: z.string().trim().min(1).max(120),
          details: z.string().trim().max(2000).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("moderation_v1");
        try {
          return await createModerationReport(ctx.user.id, {
            targetType: input.targetType,
            targetId: input.targetId,
            reason: input.reason,
            details: input.details ?? null,
          });
        } catch (error) {
          throw mapModerationError(error, "create");
        }
      }),
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
        try {
          return await createHypeRoom(ctx.user.id, {
            title: input.title,
            topic: input.topic ?? null,
            description: input.description ?? null,
            durationHours: input.durationHours,
            visibility: input.visibility,
            startsAt: input.startsAt ?? null,
          });
        } catch (error) {
          throw mapHypeRoomMemberError(error, "create");
        }
      }),
    byId: publicProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .query(async ({ input }) => {
        await requireFeatureFlag("time_limited_communities");
        return getHypeRoom(input.roomId);
      }),
    list: publicProcedure.input(hypeRoomListInput).query(async ({ input, ctx }) => {
      await requireFeatureFlag("time_limited_communities");
      const filter = input?.filter;
      if (filter === "mine" && !ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return listActiveHypeRooms({
        filter,
        userId: ctx.user?.id ?? null,
      });
    }),
    // M6 — host scheduled cancel (§8.4 / §19.1): scheduled → archived + reason.
    cancel: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          cancelReason: z.string().trim().max(500).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await cancelHypeRoom(
            input.roomId,
            ctx.user.id,
            input.cancelReason ?? null
          );
        } catch (error) {
          throw mapHypeRoomMemberError(error, "cancel");
        }
      }),
    resolve: publicProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await requireFeatureFlag("time_limited_communities");
        return resolveHypeRoomExpiry(input.roomId);
      }),
    // M2 — members: join / leave / list (all behind the same fail-closed flag).
    join: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        await ensureProfile(ctx.user.id);
        try {
          return await joinHypeRoom(input.roomId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "join");
        }
      }),
    leave: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await leaveHypeRoom(input.roomId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "leave");
        }
      }),
    members: publicProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .query(async ({ input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await listHypeRoomMembers(input.roomId);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "members");
        }
      }),
    // M4 — messages + host controls (same fail-closed flag; M1–M3 untouched).
    messages: publicProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await listRoomMessages(input.roomId, ctx.user?.id ?? null);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "messages");
        }
      }),
    sendMessage: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          body: z.string().trim().min(1).max(ROOM_MESSAGE_MAX_LENGTH),
          parentId: z.number().int().positive().nullish(),
          mentionedUserIds: z
            .array(z.number().int().positive())
            .max(50)
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await sendHypeRoomMessage(input.roomId, ctx.user.id, input.body, {
            parentId: input.parentId ?? null,
            mentionedUserIds: input.mentionedUserIds ?? [],
          });
        } catch (error) {
          throw mapHypeRoomMemberError(error, "sendMessage");
        }
      }),
    toggleReaction: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          messageId: z.number().int().positive(),
          reaction: z.enum(HYPE_ROOM_REACTIONS),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await toggleHypeRoomMessageReaction(
            input.roomId,
            ctx.user.id,
            input.messageId,
            input.reaction
          );
        } catch (error) {
          throw mapHypeRoomMemberError(error, "toggleReaction");
        }
      }),
    setMemberRole: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          userId: z.number().int().positive(),
          role: z.enum(["speaker", "audience"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await setHypeRoomMemberRole(
            input.roomId,
            ctx.user.id,
            input.userId,
            input.role
          );
        } catch (error) {
          throw mapHypeRoomMemberError(error, "setMemberRole");
        }
      }),
    updateSettings: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          title: z.string().trim().min(3).max(180).optional(),
          topic: z.string().trim().max(120).nullable().optional(),
          description: z.string().trim().max(2000).nullable().optional(),
          visibility: z.enum(["public", "link_only"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        const { roomId, ...patch } = input;
        try {
          return await updateHypeRoomSettings(roomId, ctx.user.id, patch);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "updateSettings");
        }
      }),
    createInvite: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          invitedUserId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await createHypeRoomInvite(
            input.roomId,
            ctx.user.id,
            input.invitedUserId
          );
        } catch (error) {
          throw mapHypeRoomMemberError(error, "createInvite");
        }
      }),
    acceptInvite: protectedProcedure
      .input(z.object({ inviteId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await acceptHypeRoomInvite(input.inviteId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "acceptInvite");
        }
      }),
    listInvites: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await listHypeRoomInvites(input.roomId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "listInvites");
        }
      }),
    listMyInvites: protectedProcedure.query(async ({ ctx }) => {
      await requireFeatureFlag("time_limited_communities");
      try {
        return await listMyHypeRoomInvites(ctx.user.id);
      } catch (error) {
        throw mapHypeRoomMemberError(error, "listMyInvites");
      }
    }),
    end: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await endHypeRoom(input.roomId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "end");
        }
      }),
    pin: protectedProcedure
      .input(z.object({ messageId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await pinHypeRoomMessage(input.messageId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "pin");
        }
      }),
    unpin: protectedProcedure
      .input(z.object({ roomId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await unpinHypeRoomMessage(input.roomId, ctx.user.id);
        } catch (error) {
          throw mapHypeRoomMemberError(error, "unpin");
        }
      }),
    removeMember: protectedProcedure
      .input(
        z.object({
          roomId: z.number().int().positive(),
          userId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("time_limited_communities");
        try {
          return await removeHypeRoomMember(
            input.roomId,
            ctx.user.id,
            input.userId
          );
        } catch (error) {
          throw mapHypeRoomMemberError(error, "removeMember");
        }
      }),
  }),
  // M3 — Drops + Claims/Reservations — fail-closed behind jhilik_drops.
  // Social reservation only; no payment/checkout/wallet. Claim needs no room membership.
  drops: router({
    list: publicProcedure.input(dropListInput).query(async ({ input, ctx }) => {
      await requireFeatureFlag("jhilik_drops");
      try {
        return await listDrops({
          filter: input?.filter ?? "live",
          userId: ctx.user?.id ?? null,
          limit: input?.limit,
        });
      } catch (error) {
        throw mapDropError(error, "list");
      }
    }),
    byId: publicProcedure.input(dropIdInput).query(async ({ input }) => {
      await requireFeatureFlag("jhilik_drops");
      try {
        const drop = await getDrop(input.dropId);
        if (!drop) throw new TRPCError({ code: "NOT_FOUND", message: "Drop not found." });
        return { drop, serverNow: new Date() };
      } catch (error) {
        throw mapDropError(error, "byId");
      }
    }),
    claim: protectedProcedure.input(dropClaimInput).mutation(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      await ensureProfile(ctx.user.id);
      try {
        return await claimDrop(input.dropId, ctx.user.id, input.idempotencyKey);
      } catch (error) {
        throw mapDropError(error, "claim");
      }
    }),
    myClaim: protectedProcedure.input(dropIdInput).query(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      try {
        return await getMyClaim(input.dropId, ctx.user.id);
      } catch (error) {
        throw mapDropError(error, "myClaim");
      }
    }),
    saveDraft: protectedProcedure.input(dropSaveDraftInput).mutation(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      await ensureProfile(ctx.user.id);
      try {
        return await saveDraftDrop(ctx.user.id, input);
      } catch (error) {
        throw mapDropError(error, "saveDraft");
      }
    }),
    publish: protectedProcedure.input(dropWindowInput).mutation(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      await ensureProfile(ctx.user.id);
      try {
        return await publishDrop(ctx.user.id, input);
      } catch (error) {
        throw mapDropError(error, "publish");
      }
    }),
    schedule: protectedProcedure.input(dropWindowInput).mutation(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      await ensureProfile(ctx.user.id);
      try {
        return await scheduleDrop(ctx.user.id, input);
      } catch (error) {
        throw mapDropError(error, "schedule");
      }
    }),
    end: protectedProcedure.input(dropIdInput).mutation(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      await ensureProfile(ctx.user.id);
      try {
        return await endDrop(ctx.user.id, input.dropId);
      } catch (error) {
        throw mapDropError(error, "end");
      }
    }),
    claims: protectedProcedure.input(dropIdInput).query(async ({ ctx, input }) => {
      await requireFeatureFlag("jhilik_drops");
      try {
        await assertDropOwner(input.dropId, ctx.user.id);
        return await listDropClaims(input.dropId);
      } catch (error) {
        throw mapDropError(error, "claims");
      }
    }),
    // M5 — claim fulfilment (seller): claimed → fulfilled | cancelled only.
    fulfillClaim: protectedProcedure
      .input(dropClaimTransitionInput)
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("jhilik_drops");
        await ensureProfile(ctx.user.id);
        try {
          return await fulfillClaim(ctx.user.id, input);
        } catch (error) {
          throw mapDropError(error, "fulfillClaim");
        }
      }),
    cancelClaim: protectedProcedure
      .input(dropClaimTransitionInput)
      .mutation(async ({ ctx, input }) => {
        await requireFeatureFlag("jhilik_drops");
        await ensureProfile(ctx.user.id);
        try {
          return await cancelClaim(ctx.user.id, input);
        } catch (error) {
          throw mapDropError(error, "cancelClaim");
        }
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
