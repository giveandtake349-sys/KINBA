import { useCallback, useEffect, useRef, useState } from "react";
import { Users, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import {
  REACTION_OPTIONS,
  normalizeReaction,
  type ReactionType,
} from "@shared/reactions";
import "../profileRedesign.css";
import "./reactions.css";

export type ReactorSheetEntry = {
  userId: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
  isVerified?: boolean;
  reactions: ReactionType[];
};

export type ReactorSheetPage = {
  reactors: ReactorSheetEntry[];
  hasMore: boolean;
  offset: number;
  limit: number;
  viewerReactions: ReactionType[];
};

export const REACTOR_PAGE_SIZE = 50;

export type ReactorListSheetProps = {
  open: boolean;
  title: string;
  /** Backend-paged fetch for one offset — the sheet never slices client-side. */
  fetchPage: (offset: number) => Promise<ReactorSheetPage>;
  onClose: () => void;
};

const GLYPH_BY_TYPE = new Map(
  REACTION_OPTIONS.map(option => [option.id, option.glyph])
);

/**
 * Historical reactors rows carry legacy types; normalize them to the single
 * supported reaction so the sheet paints one glyph per viewer instead of
 * falling back to a raw database string.
 */
function normalizeTypes(
  types: readonly ReactionType[] | null | undefined
): ReactionType[] {
  const out: ReactionType[] = [];
  for (const type of types ?? []) {
    const normalized = normalizeReaction(type);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function entryLabel(entry: ReactorSheetEntry): string {
  const name = entry.name?.trim();
  if (name && !name.includes("@")) return name;
  const username = entry.username?.trim();
  return username ? `@${username}` : "JHILIK member";
}

type Status = "loading" | "ready" | "error";

/**
 * M6: the offset-paged list of everyone who reacted to one target.
 *
 * Shared by all four sources so paging, dedupe, empty/error/retry states and
 * profile navigation behave identically wherever it opens from. Rows are
 * deduped by userId on the way in, but the next offset always comes from the
 * backend batch size so the server's cursor never drifts.
 */
export function ReactorListSheet({
  open,
  title,
  fetchPage,
  onClose,
}: ReactorListSheetProps) {
  const auth = useAuth();
  const [, navigate] = useLocation();

  const [reactors, setReactors] = useState<ReactorSheetEntry[]>([]);
  const [viewerReactions, setViewerReactions] = useState<ReactionType[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const loadRef = useRef(fetchPage);
  loadRef.current = fetchPage;

  const loadPage = useCallback(async (offset: number, initial: boolean) => {
    if (initial) {
      setStatus("loading");
      setMoreError(false);
    } else {
      setLoadingMore(true);
      setMoreError(false);
    }
    try {
      const page = await loadRef.current(offset);
      const batch = Array.isArray(page.reactors)
        ? page.reactors.map(row => ({
            ...row,
            reactions: normalizeTypes(row.reactions),
          }))
        : [];
      setReactors(previous => {
        if (initial) return batch;
        const known = new Set(previous.map(row => row.userId));
        return [...previous, ...batch.filter(row => !known.has(row.userId))];
      });
      setViewerReactions(normalizeTypes(page.viewerReactions));
      setNextOffset(offset + batch.length);
      setHasMore(Boolean(page.hasMore));
      setStatus("ready");
    } catch {
      if (initial) setStatus("error");
      else setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  // A new open (or an explicit retry) always restarts from the first page.
  useEffect(() => {
    if (!open) return;
    setReactors([]);
    setViewerReactions([]);
    setNextOffset(0);
    setHasMore(false);
    setMoreError(false);
    void loadPage(0, true);
  }, [open, attempt, loadPage]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const openProfile = (userId: number) => {
    onClose();
    navigate(`/profile/${userId}`);
  };

  return (
    <div
      className="pr-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="pr-modal" onClick={event => event.stopPropagation()}>
        <div className="pr-modal-header">
          <h2>{title}</h2>
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
          {viewerReactions.length > 0 ? (
            <p className="reaction-reactor-viewer">
              <Users size={14} aria-hidden="true" />
              You reacted with
              <span className="reaction-reactor-types">
                {viewerReactions.map(type => {
                  const option = REACTION_OPTIONS.find(
                    row => row.id === type
                  );
                  return (
                    <span
                      key={type}
                      className="reaction-reactor-type"
                      role="img"
                      aria-label={option?.label ?? type}
                      title={option?.label ?? type}
                    >
                      <span aria-hidden="true">{option?.glyph}</span>
                    </span>
                  );
                })}
              </span>
            </p>
          ) : null}

          {status === "loading" ? (
            <p className="pr-follow-status">Loading…</p>
          ) : status === "error" ? (
            <p className="pr-follow-status" role="alert">
              This list is unavailable right now. Please try again.{" "}
              <button
                type="button"
                className="pr-btn pr-btn--outline"
                onClick={() => setAttempt(value => value + 1)}
              >
                Retry
              </button>
            </p>
          ) : reactors.length === 0 ? (
            <p className="pr-follow-status">No reactions yet.</p>
          ) : (
            <div className="pr-follow-list">
              {reactors.map(entry => {
                const isSelf =
                  auth.user?.id != null && entry.userId === auth.user.id;
                return (
                  <div className="pr-follow-row" key={entry.userId}>
                    <button
                      type="button"
                      className="pr-follow-open"
                      onClick={() => openProfile(entry.userId)}
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
                    <span className="reaction-reactor-row-actions">
                      {isSelf ? (
                        <span className="reaction-reactor-self">You</span>
                      ) : null}
                      <span
                        className="reaction-reactor-types"
                        role="img"
                        aria-label={`Reacted with ${entry.reactions
                          .map(
                            type =>
                              REACTION_OPTIONS.find(option => option.id === type)
                                ?.label ?? type
                          )
                          .join(", ")}`}
                      >
                        {entry.reactions.map(type => (
                          <span key={type} className="reaction-reactor-type">
                            <span aria-hidden="true">
                              {REACTION_OPTIONS.find(option => option.id === type)
                                ?.glyph}
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                  </div>
                );
              })}
              {moreError ? (
                <p className="pr-follow-status" role="alert">
                  Could not load more right now.{" "}
                  <button
                    type="button"
                    className="pr-btn pr-btn--outline"
                    disabled={loadingMore}
                    onClick={() => void loadPage(nextOffset, false)}
                  >
                    Retry
                  </button>
                </p>
              ) : null}
              {hasMore && !moreError ? (
                <button
                  type="button"
                  className="pr-btn pr-btn--outline pr-follow-more"
                  disabled={loadingMore}
                  onClick={() => void loadPage(nextOffset, false)}
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
