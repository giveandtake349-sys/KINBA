import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  REACTOR_PAGE_SIZE,
  ReactorListSheet,
  type ReactorSheetPage,
} from "./ReactorListSheet";

/** The four M3 reactor sources — exactly one target per sheet. */
export type ReactorSource =
  | { kind: "video"; videoId: number }
  | { kind: "comment"; commentId: number }
  | { kind: "community"; announcementId: number }
  | { kind: "hypeMessage"; roomId: number; messageId: number };

export type ReactorListProps = {
  open: boolean;
  title: string;
  source: ReactorSource;
  onClose: () => void;
};

/**
 * Binds the shared reactor sheet to one of the four M3 read procedures so the
 * UI never learns procedure names and every source pages identically.
 */
export function ReactorList({
  open,
  title,
  source,
  onClose,
}: ReactorListProps) {
  const utils = trpc.useUtils();
  const kind = source.kind;
  const videoId = source.kind === "video" ? source.videoId : 0;
  const commentId = source.kind === "comment" ? source.commentId : 0;
  const announcementId =
    source.kind === "community" ? source.announcementId : 0;
  const roomId = source.kind === "hypeMessage" ? source.roomId : 0;
  const messageId = source.kind === "hypeMessage" ? source.messageId : 0;

  const fetchPage = useCallback(
    (offset: number): Promise<ReactorSheetPage> => {
      const limit = REACTOR_PAGE_SIZE;
      switch (kind) {
        case "comment":
          return utils.videos.comments.reactors.fetch({
            commentId,
            limit,
            offset,
          });
        case "community":
          return utils.community.reactors.fetch({
            announcementId,
            limit,
            offset,
          });
        case "hypeMessage":
          return utils.hypeRooms.messageReactors.fetch({
            roomId,
            messageId,
            limit,
            offset,
          });
        case "video":
        default:
          return utils.videos.reactors.fetch({ videoId, limit, offset });
      }
    },
    [utils, kind, videoId, commentId, announcementId, roomId, messageId]
  );

  return (
    <ReactorListSheet
      open={open}
      title={title}
      fetchPage={fetchPage}
      onClose={onClose}
    />
  );
}
