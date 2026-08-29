import { z } from "zod";

export const MAX_LONG_VIDEO_DURATION_SECONDS = 30 * 60;
export const MAX_SHORT_VIDEO_DURATION_SECONDS = 60;
export const MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS = 5 * 60;

const videoSourceInput = z.object({
  quality: z.enum(["ORIGINAL", "1080P", "720P", "480P"]),
  videoUrl: z.string().url().max(1024),
});

export const videoInput = z
  .object({
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().max(2400).default(""),
    videoUrl: z.string().url().max(1024),
    thumbnailUrl: z.string().url().max(1024).nullable().optional(),
    kind: z.enum(["LONG", "SHORT"]),
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_LONG_VIDEO_DURATION_SECONDS),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    sources: z.array(videoSourceInput).min(1).max(4),
  })
  .superRefine((input, context) => {
    const qualities = input.sources.map(source => source.quality);
    if (new Set(qualities).size !== qualities.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each video quality can only be supplied once.",
        path: ["sources"],
      });
    if (!qualities.includes("ORIGINAL"))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An original video source is required.",
        path: ["sources"],
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
  });

const attachmentInput = z.object({
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  mediaUrl: z.string().url().max(1024),
  sortOrder: z.number().int().min(0).max(10),
  width: z.number().int().min(1).nullable().optional(),
  height: z.number().int().min(1).nullable().optional(),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS)
    .nullable()
    .optional(),
});

export const communityAnnouncementInput = z
  .object({
    body: z.string().trim().max(5000).default(""),
    attachments: z.array(attachmentInput).max(11).default([]),
  })
  .superRefine((input, context) => {
    const imageCount = input.attachments.filter(
      item => item.mediaType === "IMAGE"
    ).length;
    const videoCount = input.attachments.filter(
      item => item.mediaType === "VIDEO"
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
    if (!input.body && !input.attachments.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An announcement needs text or an attachment.",
        path: ["body"],
      });
  });
