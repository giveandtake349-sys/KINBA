import { useMemo, useState } from "react";
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
 * @ mention picker: current room members only, search/filter, avatar,
 * display name, role. Uses existing mentionedUserIds flow — no notifications
 * fabricated on the client.
 */
export function MentionPicker({
  members,
  viewerId,
  hostId,
  selectedIds,
  onToggle,
}: {
  members: MemberRow[];
  viewerId: number | null;
  hostId: number | null;
  selectedIds: number[];
  onToggle: (userId: number) => void;
}) {
  const [term, setTerm] = useState("");

  const options = useMemo(() => {
    const query = term.trim().toLowerCase();
    return members.filter(member => {
      if (member.user.id === viewerId) return false;
      if (!query) return true;
      const name = displayMemberName(member).toLowerCase();
      const username = (member.user.username ?? "").toLowerCase();
      return name.includes(query) || username.includes(query);
    });
  }, [members, viewerId, term]);

  return (
    <div
      className="hype-room-mention-picker"
      role="listbox"
      aria-label="Mention a member"
    >
      <label className="sr-only" htmlFor="hype-room-mention-search">
        Search members to mention
      </label>
      <div className="hype-room-mention-search">
        <Search size={14} aria-hidden="true" />
        <input
          id="hype-room-mention-search"
          value={term}
          onChange={event => setTerm(event.target.value)}
          placeholder="Search members…"
          autoComplete="off"
          maxLength={80}
        />
      </div>
      {options.length === 0 ? (
        <p className="hype-room-panel-empty">No matching members.</p>
      ) : (
        options.map(member => {
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
              className={
                selected
                  ? "hype-room-mention-option hype-room-mention-option--on"
                  : "hype-room-mention-option"
              }
              onClick={() => onToggle(member.user.id)}
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
              {selected ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          );
        })
      )}
    </div>
  );
}
