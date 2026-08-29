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

export const signalInput = z.object({
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
}).refine((input) => input.mediaType === "NONE" ? (!input.mediaUrl && input.mediaDuration === 0) : Boolean(input.mediaUrl && input.mediaDuration >= 1), { message: "Audio and video signals need a media URL and a duration from 1 to 15 seconds." });

export const commentInput = z.object({
  postId: z.number().int().positive(),
  content: z.string().trim().max(2000).nullable().optional(),
  imageUrl: z.string().url().max(1024).nullable().optional(),
}).refine((input) => Boolean(input.content || input.imageUrl), { message: "A comment needs text or an image." });

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
  connection: { requesterId: number; recipientId: number; status: string } | undefined,
  userId: number,
) {
  return Boolean(
    connection &&
      connection.status === "accepted" &&
      (connection.requesterId === userId || connection.recipientId === userId),
  );
}
