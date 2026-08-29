import { z } from "zod";

const textList = z.array(z.string().trim().min(1).max(40)).max(12);

export const profileInput = z.object({
  country: z.string().trim().max(100).nullable(),
  languages: textList,
  about: z.string().trim().max(700).nullable(),
  skills: textList,
  interests: textList,
  photoUrl: z.string().url().max(1024).nullable(),
});

export const signalInput = z
  .object({
    type: z.enum(["need", "can"]),
    title: z.string().trim().min(5).max(180),
    description: z.string().trim().min(12).max(2400),
    category: z.string().trim().min(2).max(64),
    language: z.string().trim().min(2).max(64),
    location: z.string().trim().max(120).nullable(),
    imageUrl: z.string().url().max(1024).nullable().default(null),
    mediaUrl: z.string().url().max(1024).nullable().default(null),
    mediaType: z.enum(["NONE", "AUDIO", "VIDEO"]).default("NONE"),
    mediaDuration: z.number().int().min(0).max(15).default(0),
  })
  .refine(
    input =>
      input.mediaType === "NONE"
        ? !input.mediaUrl && input.mediaDuration === 0
        : Boolean(input.mediaUrl && input.mediaDuration >= 1),
    {
      message:
        "Audio and video signals need a media URL and a duration from 1 to 15 seconds.",
    }
  );

export const MAX_LONG_VIDEO_DURATION_SECONDS = 30 * 60;
export const MAX_SHORT_VIDEO_DURATION_SECONDS = 60;
export const MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS = 5 * 60;
export const MAX_VIDEO_DIMENSION = 1080;
export const MAX_ANNOUNCEMENT_VIDEO_DIMENSION = 1920;
const videoBaseInput = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(2400).default(""),
  videoUrl: z.string().url().max(1024),
  thumbnailUrl: z.string().url().max(1024).nullable().optional(),
  kind: z.enum(["LONG", "SHORT"]),
  durationSeconds: z.number().int().min(1).max(MAX_LONG_VIDEO_DURATION_SECONDS),
  width: z.number().int().min(1).max(MAX_VIDEO_DIMENSION),
  height: z.number().int().min(1).max(MAX_VIDEO_DIMENSION),
});
export const videoInput = videoBaseInput.superRefine((input, context) => {
  if (
    input.kind === "LONG" &&
    input.durationSeconds > MAX_LONG_VIDEO_DURATION_SECONDS
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Long-form videos must be 30 minutes or shorter.",
      path: ["durationSeconds"],
    });
  if (input.kind === "LONG" && input.width !== input.height)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Long-form videos must use a 1:1 square layout.",
      path: ["width"],
    });
  if (
    input.kind === "SHORT" &&
    input.durationSeconds > MAX_SHORT_VIDEO_DURATION_SECONDS
  )
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Shorts must be 1 minute or shorter.",
      path: ["durationSeconds"],
    });
  if (input.kind === "SHORT" && input.height <= input.width)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Shorts must use a vertical portrait layout.",
      path: ["height"],
    });
});
export const communityAnnouncementInput = z
  .object({
    body: z.string().trim().max(5000).default(""),
    attachments: z
      .array(
        z.object({
          mediaType: z.enum(["IMAGE", "VIDEO"]),
          mediaUrl: z.string().url().max(1024),
          sortOrder: z.number().int().min(0).max(10),
          width: z
            .number()
            .int()
            .min(1)
            .max(MAX_ANNOUNCEMENT_VIDEO_DIMENSION)
            .nullable()
            .optional(),
          height: z
            .number()
            .int()
            .min(1)
            .max(MAX_ANNOUNCEMENT_VIDEO_DIMENSION)
            .nullable()
            .optional(),
          durationSeconds: z
            .number()
            .int()
            .min(1)
            .max(MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS)
            .nullable()
            .optional(),
        })
      )
      .max(11)
      .default([]),
  })
  .superRefine((input, context) => {
    const imageCount = input.attachments.filter(
      attachment => attachment.mediaType === "IMAGE"
    ).length;
    const videoCount = input.attachments.filter(
      attachment => attachment.mediaType === "VIDEO"
    ).length;
    if (imageCount > 10)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Announcements support up to 10 images.",
        path: ["attachments"],
      });
    if (videoCount > 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Announcements support one video.",
        path: ["attachments"],
      });
    if (videoCount === 1) {
      const video = input.attachments.find(
        attachment => attachment.mediaType === "VIDEO"
      );
      if (
        !video?.durationSeconds ||
        video.durationSeconds > MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Announcement videos must be 5 minutes or shorter.",
          path: ["attachments"],
        });
    }
    if (!input.body && !input.attachments.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An announcement needs text or an attachment.",
        path: ["body"],
      });
  });

export const commentInput = z
  .object({
    postId: z.number().int().positive(),
    content: z.string().trim().max(2000).nullable().optional(),
    imageUrl: z.string().url().max(1024).nullable().optional(),
  })
  .refine(input => Boolean(input.content || input.imageUrl), {
    message: "A comment needs text or an image.",
  });

export const commentIdInput = z.object({ id: z.string().uuid() });

export const connectionRequestInput = z.object({
  recipientId: z.number().int().positive(),
  signalId: z.number().int().positive().nullable(),
  note: z.string().trim().min(10).max(1200),
});

export const reportInput = z.object({
  reportedUserId: z.number().int().positive(),
  reason: z.enum(["spam", "harassment", "unsafe", "misleading", "other"]),
  details: z.string().trim().max(1200).nullable(),
});

export function isAcceptedParticipant(
  connection:
    | { requesterId: number; recipientId: number; status: string }
    | undefined,
  userId: number
) {
  return Boolean(
    connection &&
      connection.status === "accepted" &&
      (connection.requesterId === userId || connection.recipientId === userId)
  );
}
