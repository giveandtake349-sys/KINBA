import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Check, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { ConversationAuthor } from "./shared";

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

function labelOf(user: ConversationAuthor & { photoUrl?: string | null }) {
  const name = user.name?.trim();
  const username = user.username?.trim();
  if (name && username) return name;
  if (name) return name;
  if (username) return `@${username}`;
  return "Member";
}

/**
 * Imperative handle the composer uses to drive keyboard selection while its
 * own input keeps focus: ArrowUp/ArrowDown move the highlight, Enter picks
 * the highlighted row.
 */
export type MentionPickerHandle = {
  moveHighlight: (delta: number) => void;
  /** Picks the highlighted row; returns false when the list is empty. */
  selectHighlighted: () => boolean;
};

/**
 * Shared @ mention picker for conversation surfaces (comments).
 * Uses existing home.searchAll — real users only, no fabricated suggestions.
 * Selecting a user calls onPick with their id/name/username so the caller
 * can preserve the actual identity (never just a display name).
 *
 * Two modes:
 * - Button mode (default): renders its own search input and autofocuses it.
 * - Typing mode (`query` provided): the composer input is the typing surface,
 *   so the search box is hidden and the controlled `query` drives results.
 */
export const MentionPicker = forwardRef<
  MentionPickerHandle,
  {
    viewerId?: number | null;
    excludeIds?: number[];
    onPick: (user: {
      id: number;
      name: string | null;
      username: string | null;
    }) => void;
    autoFocus?: boolean;
    /** Controlled search text (typing mode); omits the internal search box. */
    query?: string;
  }
>(function MentionPicker(
  { viewerId, excludeIds, onPick, autoFocus = true, query: controlledQuery },
  ref
) {
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const activeQuery = controlledQuery ?? term;
  const trimmed = activeQuery.trim();
  const query = trpc.home.searchAll.useQuery(
    { term: trimmed },
    {
      enabled: trimmed.length >= 1,
      refetchOnWindowFocus: false,
    }
  );

  const users = useMemo(() => {
    const rows = query.data?.users ?? [];
    const excluded = new Set<number>([
      ...(excludeIds ?? []),
      ...(viewerId != null ? [viewerId] : []),
    ]);
    return rows.filter(row => !excluded.has(row.id));
  }, [query.data, excludeIds, viewerId]);

  // Clamp the highlight into range whenever the result list shrinks, so a
  // stale index can never point at nothing.
  const safeHighlight = users.length
    ? Math.min(highlight, users.length - 1)
    : 0;

  useEffect(() => {
    setHighlight(0);
  }, [trimmed]);

  useImperativeHandle(
    ref,
    () => ({
      moveHighlight(delta: number) {
        if (users.length === 0) return;
        setHighlight(prev => (prev + delta + users.length) % users.length);
      },
      selectHighlighted() {
        const user = users[safeHighlight];
        if (!user) return false;
        onPick({
          id: user.id,
          name: user.name,
          username: user.username,
        });
        return true;
      },
    }),
    [users, safeHighlight, onPick]
  );

  const pick = (user: {
    id: number;
    name: string | null;
    username: string | null;
  }) => {
    onPick(user);
    setTerm("");
  };

  return (
    <div className="conv-mention-picker" role="listbox" aria-label="Mention someone">
      {controlledQuery === undefined ? (
        <div className="conv-mention-picker-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={term}
            onChange={event => setTerm(event.target.value)}
            onKeyDown={event => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight(prev =>
                  users.length ? (prev + 1) % users.length : 0
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight(prev =>
                  users.length ? (prev - 1 + users.length) % users.length : 0
                );
              } else if (event.key === "Enter") {
                const user = users[safeHighlight];
                if (user) {
                  event.preventDefault();
                  pick({
                    id: user.id,
                    name: user.name,
                    username: user.username,
                  });
                }
              }
            }}
            placeholder="Search people…"
            aria-label="Search people to mention"
            autoFocus={autoFocus}
            enterKeyHint="done"
          />
        </div>
      ) : null}
      {query.isPending && trimmed ? (
        <p className="conv-mention-picker-hint">Searching…</p>
      ) : query.isError ? (
        <p className="conv-mention-picker-hint">Search is unavailable.</p>
      ) : !trimmed ? (
        <p className="conv-mention-picker-hint">Type a name or @username.</p>
      ) : users.length === 0 ? (
        <p className="conv-mention-picker-hint">No people found.</p>
      ) : (
        <ul className="conv-mention-picker-list">
          {users.map((user, index) => (
            <li key={user.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={index === highlight ? "is-highlighted" : undefined}
                onMouseDown={event => {
                  // Keep the composer input focused so the caret survives.
                  event.preventDefault();
                }}
                onMouseEnter={() => setHighlight(index)}
                onClick={() =>
                  pick({
                    id: user.id,
                    name: user.name,
                    username: user.username,
                  })
                }
              >
                <span className="conv-mention-avatar" aria-hidden="true">
                  {user.photoUrl ? (
                    <img src={user.photoUrl} alt="" />
                  ) : (
                    initialsOf(labelOf(user))
                  )}
                </span>
                <span className="conv-mention-meta">
                  <strong>{labelOf(user)}</strong>
                  {user.username ? (
                    <span>@{user.username}</span>
                  ) : null}
                </span>
                <Check size={14} className="conv-mention-check" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
