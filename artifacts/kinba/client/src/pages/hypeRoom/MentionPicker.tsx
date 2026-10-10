import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Check, Search } from "lucide-react";
import { displayMemberName, roleLabel, type MemberRow } from "./shared";

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

/**
 * Imperative handle the composer uses to drive keyboard selection while its
 * own textarea keeps focus: ArrowUp/ArrowDown move the highlight, Enter picks
 * the highlighted member.
 */
export type HypeMentionPickerHandle = {
  moveHighlight: (delta: number) => void;
  /** Toggles the highlighted member; returns false when the list is empty. */
  selectHighlighted: () => boolean;
};

/**
 * @ mention picker: current room members only, search/filter, avatar,
 * display name, role. Uses existing mentionedUserIds flow — no notifications
 * fabricated on the client.
 *
 * Two modes:
 * - Button mode (default): renders its own search box.
 * - Typing mode (`query` provided): the composer textarea is the typing
 *   surface, so the search box is hidden and the controlled `query` filters.
 */
export const MentionPicker = forwardRef<
  HypeMentionPickerHandle,
  {
    members: MemberRow[];
    viewerId: number | null;
    hostId: number | null;
    selectedIds: number[];
    onToggle: (userId: number) => void;
    /** Controlled filter text (typing mode); omits the internal search box. */
    query?: string;
  }
>(function MentionPicker(
  { members, viewerId, hostId, selectedIds, onToggle, query: controlledQuery },
  ref
) {
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const activeTerm = controlledQuery ?? term;

  const options = useMemo(() => {
    const query = activeTerm.trim().toLowerCase();
    return members.filter(member => {
      if (member.user.id === viewerId) return false;
      if (!query) return true;
      const name = displayMemberName(member).toLowerCase();
      const username = (member.user.username ?? "").toLowerCase();
      return name.includes(query) || username.includes(query);
    });
  }, [members, viewerId, activeTerm]);

  const safeHighlight = options.length
    ? Math.min(highlight, options.length - 1)
    : 0;

  useEffect(() => {
    setHighlight(0);
  }, [activeTerm]);

  useImperativeHandle(
    ref,
    () => ({
      moveHighlight(delta: number) {
        if (options.length === 0) return;
        setHighlight(prev => (prev + delta + options.length) % options.length);
      },
      selectHighlighted() {
        const member = options[safeHighlight];
        if (!member) return false;
        onToggle(member.user.id);
        return true;
      },
    }),
    [options, safeHighlight, onToggle]
  );

  const toggle = (member: MemberRow) => {
    onToggle(member.user.id);
    setTerm("");
  };

  return (
    <div
      className="hype-room-mention-picker"
      role="listbox"
      aria-label="Mention a member"
    >
      {controlledQuery === undefined ? (
        <>
          <label className="sr-only" htmlFor="hype-room-mention-search">
            Search members to mention
          </label>
          <div className="hype-room-mention-search">
            <Search size={14} aria-hidden="true" />
            <input
              id="hype-room-mention-search"
              value={term}
              onChange={event => setTerm(event.target.value)}
              onKeyDown={event => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlight(prev =>
                    options.length ? (prev + 1) % options.length : 0
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlight(prev =>
                    options.length
                      ? (prev - 1 + options.length) % options.length
                      : 0
                  );
                } else if (event.key === "Enter") {
                  const member = options[safeHighlight];
                  if (member) {
                    event.preventDefault();
                    toggle(member);
                  }
                }
              }}
              placeholder="Search members…"
              autoComplete="off"
              maxLength={80}
            />
          </div>
        </>
      ) : null}
      {options.length === 0 ? (
        <p className="hype-room-panel-empty">No matching members.</p>
      ) : (
        options.map((member, index) => {
          const selected = selectedIds.includes(member.user.id);
          const name = displayMemberName(member);
          const role =
            member.user.id === hostId
              ? "host"
              : member.membership.role === "speaker"
                ? "speaker"
                : "audience";
          return (
            <button
              key={member.membership.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={[
                selected
                  ? "hype-room-mention-option hype-room-mention-option--on"
                  : "hype-room-mention-option",
                index === safeHighlight ? "is-highlighted" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={event => {
                // Keep the composer textarea focused so the caret survives.
                event.preventDefault();
              }}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => toggle(member)}
            >
              <span className="hype-room-mention-option-main">
                {member.user.photoUrl ? (
                  <img
                    className="hype-room-mention-avatar"
                    src={member.user.photoUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="hype-room-mention-avatar hype-room-mention-avatar--initials"
                    aria-hidden="true"
                  >
                    {initialsOf(name)}
                  </span>
                )}
                <span className="hype-room-mention-text">
                  <span className="hype-room-mention-name">{name}</span>
                  <span
                    className={`hype-room-role-badge hype-room-role--${role}`}
                  >
                    {roleLabel(role)}
                  </span>
                </span>
              </span>
              {selected ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          );
        })
      )}
    </div>
  );
});
