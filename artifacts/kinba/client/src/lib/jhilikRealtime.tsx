import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { useSupabaseAuth } from "../contexts/SupabaseAuthContext";
import { trpc } from "./trpc";

/**
 * Shared, best-effort feed invalidation channel.
 * React Query remains the source of truth and continues to provide the
 * fallback when Realtime is unavailable or a table is not published.
 */
export function JHILIKRealtimeBridge() {
  const auth = useSupabaseAuth();
  const utils = trpc.useUtils();

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshFeed = () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void Promise.all([
          utils.home.feed.refetch(),
          utils.videos.list.refetch(),
          utils.community.list.refetch(),
          utils.community.mine.refetch(),
        ]);
      }, 150);
    };
    const invalidateFeed = () => {
      refreshFeed();
      void Promise.all([
        utils.home.feed.invalidate(),
        utils.videos.list.invalidate(),
        utils.community.list.invalidate(),
        utils.community.mine.invalidate(),
      ]);
    };
    const invalidateComments = () => {
      void Promise.all([
        utils.home.feed.invalidate(),
        utils.videos.comments.list.invalidate(),
        utils.community.comments.list.invalidate(),
        utils.community.list.invalidate(),
      ]);
    };

    const channel: RealtimeChannel = supabase
      .channel("jhilik:public-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "videos" }, invalidateFeed)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_announcements" },
        invalidateFeed,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "video_reactions" }, invalidateFeed)
      .on("postgres_changes", { event: "*", schema: "public", table: "video_shares" }, invalidateFeed)
      .on("postgres_changes", { event: "*", schema: "public", table: "video_comments" }, invalidateComments)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_comments" },
        invalidateComments,
      );

    if (auth.session) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_messages" },
        () => void utils.directMessages.getUnreadMessageCount.invalidate(),
      );
    }

    channel.subscribe(status => {
      if (status === "SUBSCRIBED") {
        console.info("[Realtime] JHILIK feed channel subscribed");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn("[Realtime] Feed channel unavailable; query fallback remains active");
      }
    });

    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [auth.session, utils]);

  return null;
}
