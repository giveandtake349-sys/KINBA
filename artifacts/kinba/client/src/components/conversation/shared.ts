import type { ReactNode } from "react";
import {
  REACTION_OPTIONS,
  type ReactionType,
} from "@shared/reactions";

/** Shared conversation reaction id — matches the shared reaction vocabulary. */
export type ConversationReactionId = ReactionType;

export type ConversationReactionOption = {
  id: ConversationReactionId;
  label: string;
  glyph: string;
};

export type ConversationReactionEntry = {
  reaction: ConversationReactionId;
  count: number;
  reactedByMe: boolean;
};

/** Conversation multi-reaction set (single source: shared/reactions). */
export const CONVERSATION_REACTIONS: ReadonlyArray<ConversationReactionOption> =
  REACTION_OPTIONS;

export type ConversationAction = {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
};

export type ConversationAuthor = {
  id: number;
  name: string | null;
  username: string | null;
};

export type ConversationItemData = {
  id: number;
  body: string;
  parentId: number | null;
  createdAt: Date | string;
  author: ConversationAuthor;
  /** Binary like count (videos.comments backend). */
  likeCount?: number;
  viewerLiked?: boolean;
  /** Multi-reaction entries when backend provides them (Hype Room). */
  reactions?: ConversationReactionEntry[];
  audioUrl?: string | null;
  audioDuration?: number | null;
};

export function formatConversationClock(value: Date | string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function replyCountLabel(n: number): string {
  if (n <= 0) return "0 replies";
  return `${n} repl${n === 1 ? "y" : "ies"}`;
}

export function conversationDisplayName(author: ConversationAuthor): string {
  const name = author.name?.trim();
  const username = author.username?.trim();
  if (name && username) return name;
  if (name) return name;
  if (username) return `@${username}`;
  return "Member";
}
