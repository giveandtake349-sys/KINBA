import { relations } from "drizzle-orm";
import {
  users,
  videos,
  videoComments,
  communityAnnouncements,
  communityComments,
  hypeRooms,
  hypeRoomMessages,
  drops,
  hashtags,
  videoHashtags,
  videoCommentHashtags,
  announcementHashtags,
  communityCommentHashtags,
  hypeRoomHashtags,
  hypeRoomMessageHashtags,
  dropHashtags,
} from "./schema";

export const hashtagsRelations = relations(hashtags, ({ many }) => ({
  videos: many(videoHashtags),
  videoComments: many(videoCommentHashtags),
  announcements: many(announcementHashtags),
  communityComments: many(communityCommentHashtags),
  hypeRooms: many(hypeRoomHashtags),
  hypeRoomMessages: many(hypeRoomMessageHashtags),
  drops: many(dropHashtags),
}));

export const videoHashtagsRelations = relations(videoHashtags, ({ one }) => ({
  video: one(videos, { fields: [videoHashtags.videoId], references: [videos.id] }),
  hashtag: one(hashtags, { fields: [videoHashtags.hashtagId], references: [hashtags.id] }),
}));

export const videoCommentHashtagsRelations = relations(videoCommentHashtags, ({ one }) => ({
  comment: one(videoComments, { fields: [videoCommentHashtags.commentId], references: [videoComments.id] }),
  hashtag: one(hashtags, { fields: [videoCommentHashtags.hashtagId], references: [hashtags.id] }),
}));

export const announcementHashtagsRelations = relations(announcementHashtags, ({ one }) => ({
  announcement: one(communityAnnouncements, { fields: [announcementHashtags.announcementId], references: [communityAnnouncements.id] }),
  hashtag: one(hashtags, { fields: [announcementHashtags.hashtagId], references: [hashtags.id] }),
}));

export const communityCommentHashtagsRelations = relations(communityCommentHashtags, ({ one }) => ({
  comment: one(communityComments, { fields: [communityCommentHashtags.commentId], references: [communityComments.id] }),
  hashtag: one(hashtags, { fields: [communityCommentHashtags.hashtagId], references: [hashtags.id] }),
}));

export const hypeRoomHashtagsRelations = relations(hypeRoomHashtags, ({ one }) => ({
  room: one(hypeRooms, { fields: [hypeRoomHashtags.roomId], references: [hypeRooms.id] }),
  hashtag: one(hashtags, { fields: [hypeRoomHashtags.hashtagId], references: [hashtags.id] }),
}));

export const hypeRoomMessageHashtagsRelations = relations(hypeRoomMessageHashtags, ({ one }) => ({
  message: one(hypeRoomMessages, { fields: [hypeRoomMessageHashtags.messageId], references: [hypeRoomMessages.id] }),
  hashtag: one(hashtags, { fields: [hypeRoomMessageHashtags.hashtagId], references: [hashtags.id] }),
}));

export const dropHashtagsRelations = relations(dropHashtags, ({ one }) => ({
  drop: one(drops, { fields: [dropHashtags.dropId], references: [drops.id] }),
  hashtag: one(hashtags, { fields: [dropHashtags.hashtagId], references: [hashtags.id] }),
}));

// Extend existing entity relations with hashtag associations
export const videosRelations = relations(videos, ({ many }) => ({
  hashtags: many(videoHashtags),
}));

export const videoCommentsRelations = relations(videoComments, ({ many }) => ({
  hashtags: many(videoCommentHashtags),
}));

export const communityAnnouncementsRelations = relations(communityAnnouncements, ({ many }) => ({
  hashtags: many(announcementHashtags),
}));

export const communityCommentsRelations = relations(communityComments, ({ many }) => ({
  hashtags: many(communityCommentHashtags),
}));

export const hypeRoomsRelations = relations(hypeRooms, ({ many }) => ({
  hashtags: many(hypeRoomHashtags),
}));

export const hypeRoomMessagesRelations = relations(hypeRoomMessages, ({ many }) => ({
  hashtags: many(hypeRoomMessageHashtags),
}));

export const dropsRelations = relations(drops, ({ many }) => ({
  hashtags: many(dropHashtags),
}));