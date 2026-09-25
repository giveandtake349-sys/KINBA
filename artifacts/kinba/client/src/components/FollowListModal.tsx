import { useCallback, useEffect, useState } from "react";
import { UserCheck, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import "./profileRedesign.css";

export type FollowListMode = "followers" | "following";

type FollowListEntry = {
  userId: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
  isFollowing: boolean;
  isFollowedBy: boolean;
};

type FollowListModalProps = {
  open: boolean;
  mode: FollowListMode;
  userId: number;
  onClose: () => void;
};

/** Rows per request — the backend pages with offset, never a client slice. */
const FOLLOW_PAGE_SIZE = 50;

function entryLabel(entry: {
  name?: string | null;
  username?: string | null;
}): string {
  const name = entry.name?.trim();
  if (name && !name.includes("@")) return name;
  const username = entry.username?.trim();
  return username ? `@${username}` : "KINBA member";
}

/**
 * Follower / following list for a profile (JHILIK §6–§7).
 * Read-only list plus per-row Follow / Follow back, both backed by the
 * existing profile.toggleFollow mutation.
 */
export default function FollowListModal({
  open,
  mode,
  userId,
  onClose,
}: FollowListModalProps) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const active = open && Number.isInteger(userId) && userId > 0;

  const followersQuery = trpc.profile.followers.useQuery(
    { userId, limit: FOLLOW_PAGE_SIZE, offset: 0 },
    {
      enabled: active && mode === "followers",
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );
  const followingQuery = trpc.profile.following.useQuery(
    { userId, limit: FOLLOW_PAGE_SIZE, offset: 0 },
    {
      enabled: active && mode === "following",
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );

  const query = mode === "followers" ? followersQuery : followingQuery;
  // Page 0 comes from the query above; every later page is fetched from the
  // backend by offset and kept here so follow states stay in one list.
  const [extraPages, setExtraPages] = useState<FollowListEntry[][]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Raw size of the last backend batch (dedupe may drop rows locally, so the
  // "is there more?" check must use the backend answer, not the visible rows).
  const [lastBatchSize, setLastBatchSize] = useState<number | null>(null);
  const baseEntries: FollowListEntry[] = query.data ?? [];
  const entries: FollowListEntry[] = extraPages.length
    ? [...baseEntries, ...extraPages.flat()]
    : baseEntries;
  const loadedRowCount =
    baseEntries.length +
    extraPages.reduce((total, page) => total + page.length, 0);
  // Stop when the last backend batch came back short (or the list fits in
  // one page).
  const hasMore =
    (lastBatchSize !== null ? lastBatchSize : baseEntries.length) >=
    FOLLOW_PAGE_SIZE;
  const viewerId = auth.user?.id;

  const fetchFollowPage = async (offset: number) => {
    const fetcher =
      mode === "followers" ? utils.profile.followers : utils.profile.following;
    return fetcher.fetch({
      userId,
      limit: FOLLOW_PAGE_SIZE,
      offset,
    });
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const batch = await fetchFollowPage(loadedRowCount);
      const known = new Set(entries.map(row => row.userId));
      setLastBatchSize(batch.length);
      setExtraPages(prev => [
        ...prev,
        batch.filter(row => !known.has(row.userId)),
      ]);
    } catch {
      toast.error("Could not load more right now.");
    } finally {
      setLoadingMore(false);
    }
  };

  // Re-reads every already-loaded page after a follow toggle so the extra
  // rows keep correct Follow / Following labels (page 0 is refetched by the
  // invalidation below).
  const reloadLoadedPages = async () => {
    if (!extraPages.length) return;
    try {
      const refreshed = await Promise.all(
        extraPages.map((_, index) =>
          fetchFollowPage(
            baseEntries.length +
              extraPages
                .slice(0, index)
                .reduce((total, page) => total + page.length, 0)
          )
        )
      );
      setLastBatchSize(refreshed[refreshed.length - 1]?.length ?? lastBatchSize);
      setExtraPages(refreshed);
    } catch {
      // Page 0 is already refreshed; the rest keep their previous labels.
    }
  };

  const refreshFollowLists = useCallback(async () => {
    await Promise.all([
      utils.profile.followers.invalidate(),
      utils.profile.following.invalidate(),
      utils.profile.followState.invalidate(),
      utils.profile.byId.invalidate(),
      utils.profile.me.invalidate(),
      utils.notifications.unreadCount.invalidate(),
    ]);
  }, [utils]);

  const toggleFollow = trpc.profile.toggleFollow.useMutation({
    onSuccess: async () => {
      await refreshFollowLists();
      await reloadLoadedPages();
    },
    onError: error => {
      toast.error(error.message || "Could not update follow.");
    },
  });

  // A different profile/mode/open state starts from the first backend page.
  useEffect(() => {
    setExtraPages([]);
    setLastBatchSize(null);
    setLoadingMore(false);
  }, [open, mode, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleToggle = (entry: FollowListEntry) => {
    if (!auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    if (toggleFollow.isPending) return;
    toggleFollow.mutate({ userId: entry.userId });
  };

  const openProfile = (entry: FollowListEntry) => {
    onClose();
    navigate(`/profile/${entry.userId}`);
  };

  return (
    <div
      className="pr-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "followers" ? "Followers" : "Following"}
      onClick={onClose}
    >
      <div className="pr-modal" onClick={event => event.stopPropagation()}>
        <div className="pr-modal-header">
          <h2>{mode === "followers" ? "Followers" : "Following"}</h2>
          <button
            type="button"
            className="pr-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="pr-modal-body">
          {query.isPending ? (
            <p className="pr-follow-status">Loading…</p>
          ) : query.isError ? (
            <p className="pr-follow-status" role="alert">
              This list is unavailable right now. Please try again.
            </p>
          ) : entries.length === 0 ? (
            <p className="pr-follow-status">
              {mode === "followers"
                ? "No followers yet."
                : "Not following anyone yet."}
            </p>
          ) : (
            <div className="pr-follow-list">
              {entries.map(entry => {
                const isSelf = viewerId != null && entry.userId === viewerId;
                const label =
                  entry.isFollowing
                    ? "Following"
                    : entry.isFollowedBy
                      ? "Follow back"
                      : "Follow";
                return (
                  <div className="pr-follow-row" key={entry.userId}>
                    <button
                      type="button"
                      className="pr-follow-open"
                      onClick={() => openProfile(entry)}
                    >
                      <span className="pr-follow-avatar">
                        {entry.photoUrl ? (
                          <img
                            src={resolveMediaUrl(entry.photoUrl) ?? entry.photoUrl}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <Users size={16} />
                        )}
                      </span>
                      <span className="pr-follow-meta">
                        <strong>{entryLabel(entry)}</strong>
                        {entry.username?.trim() ? (
                          <small>@{entry.username.trim()}</small>
                        ) : null}
                      </span>
                    </button>
                    {!isSelf ? (
                      <button
                        type="button"
                        className={`pr-btn ${
                          entry.isFollowing
                            ? "pr-btn--outline"
                            : "pr-btn--primary"
                        } pr-follow-action`}
                        disabled={toggleFollow.isPending}
                        onClick={() => handleToggle(entry)}
                      >
                        {entry.isFollowing ? (
                          <UserCheck size={14} />
                        ) : (
                          <UserPlus size={14} />
                        )}
                        {label}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {hasMore ? (
                <button
                  type="button"
                  className="pr-btn pr-btn--outline pr-follow-more"
                  disabled={loadingMore || toggleFollow.isPending}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
