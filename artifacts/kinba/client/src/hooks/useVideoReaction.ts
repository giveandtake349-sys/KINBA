/**
 * Optimistic viewer reaction state for a video/post.
 *
 * Every gesture funnels through one commit: a tap asks to toggle the default
 * "like" (which means "remove" when something is already active), the picker
 * asks for a specific type. The server's M2 toggle decides insert/remove/replace
 * from that single type, so the UI only has to mirror the response — no
 * client-only state that could disagree with the backend.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  adoptSingleReaction,
  applySingleReaction,
  tappedReactionType,
  type SingleReactionState,
} from "@/lib/reactionState";
import type { ReactionType } from "@shared/reactions";

export type VideoReactionTarget = {
  id: number;
  reactionCount: number;
  viewerReacted: boolean;
  viewerReaction?: ReactionType | null;
};

export type UseVideoReactionOptions = {
  onError?: (error: unknown) => void;
};

function defaultOnError(error: unknown) {
  toast.error(
    error instanceof Error
      ? error.message
      : "The operation could not be completed."
  );
}

export function useVideoReaction(
  target: VideoReactionTarget,
  options: UseVideoReactionOptions = {}
) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const mutation = trpc.videos.react.useMutation();
  const [override, setOverride] = useState<SingleReactionState | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const state: SingleReactionState = override ?? {
    reactionCount: target.reactionCount,
    viewerReacted: target.viewerReacted,
    viewerReaction: target.viewerReaction ?? null,
  };

  const commit = useCallback(
    async (type: ReactionType) => {
      if (!auth.isAuthenticated) {
        auth.openAuth();
        return;
      }
      if (pendingRef.current) return;
      const previous = state;
      pendingRef.current = true;
      setPending(true);
      setOverride(applySingleReaction(previous, type));
      try {
        const response = await mutation.mutateAsync({
          videoId: target.id,
          reaction: type,
        });
        setOverride(adoptSingleReaction(previous, type, response));
        await utils.home.feed.invalidate();
        await utils.videos.list.invalidate();
      } catch (error) {
        setOverride(previous);
        (onErrorRef.current ?? defaultOnError)(error);
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [auth, mutation, state, target.id, utils]
  );

  const active = state.viewerReacted ? state.viewerReaction : null;

  return {
    state,
    pending,
    /** Tap on the default control: remove the active type, else add "like". */
    react: () => void commit(tappedReactionType(active)),
    /** Picker selection: inserts, replaces, or removes via the same commit. */
    select: (type: ReactionType) => void commit(type),
  };
}
