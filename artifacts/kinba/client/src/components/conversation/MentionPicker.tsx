import { useMemo, useState } from "react";
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
 * Shared @ mention picker for conversation surfaces (comments).
 * Uses existing home.searchAll — real users only, no fabricated suggestions.
 * Selecting a user calls onPick with their handle for inline @text insertion.
 */
export function MentionPicker({
  viewerId,
  excludeIds,
  onPick,
  autoFocus = true,
}: {
  viewerId?: number | null;
  excludeIds?: number[];
  onPick: (user: {
    id: number;
    name: string | null;
    username: string | null;
  }) => void;
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const trimmed = term.trim();
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

  return (
    <div className="conv-mention-picker" role="listbox" aria-label="Mention someone">
      <div className="conv-mention-picker-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={term}
          onChange={event => setTerm(event.target.value)}
          placeholder="Search people…"
          aria-label="Search people to mention"
          autoFocus={autoFocus}
          enterKeyHint="done"
        />
      </div>
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
          {users.map(user => (
            <li key={user.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick({
                    id: user.id,
                    name: user.name,
                    username: user.username,
                  });
                  setTerm("");
                }}
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
}
