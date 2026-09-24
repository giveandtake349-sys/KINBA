import { useMemo, useState } from "react";
import {
  CornerUpLeft,
  Copy,
  Flag,
  MoreHorizontal,
  Pin,
  Reply,
  X,
} from "lucide-react";
import {
  displayInviteName,
  displayMessageName,
  formatMessageClock,
  roleLabel,
  type MemberRow,
  type MessageRow,
} from "./shared";

import { REACTION_OPTIONS, type ReactionType } from "@shared/reactions";

export type HypeReactionId = ReactionType;

export const HYPE_REACTIONS: ReadonlyArray<{
  id: HypeReactionId;
  label: string;
  glyph: string;
}> = REACTION_OPTIONS;

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

function roleFor(
  row: MessageRow,
  hostId: number | null,
  members: MemberRow[]
): string {
  if (row.user.id != null && hostId != null && row.user.id === hostId) {
    return "host";
  }
  if (row.user.id == null) return "audience";
  const match = members.find(member => member.user.id === row.user.id);
  if (!match) return "audience";
  if (match.membership.role === "speaker") return "speaker";
  if (match.membership.role === "host") return "host";
  return "audience";
}

function replyCountLabel(n: number): string {
  if (n === 0) return "0 replies";
  return `${n} repl${n === 1 ? "y" : "ies"}`;
}

/**
 * Compact message card: avatar, name, role, clock time, body, reactions,
 * reply count. Actions open from the overflow (tap/long-press alternative)
 * — only valid actions for the current user are listed.
 */
export function MessageCard({
  row,
  members,
  hostId,
  viewerId,
  isHostViewer,
  isActiveMember,
  canReply,
  isPinned,
  replyCount,
  selected,
  busy,
  onSelect,
  onReply,
  onReact,
  onPin,
  onReport,
  onOpenThread,
}: {
  row: MessageRow;
  members: MemberRow[];
  hostId: number | null;
  viewerId?: number | null;
  isHostViewer: boolean;
  isActiveMember: boolean;
  canReply: boolean;
  isPinned: boolean;
  replyCount: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onReply: () => void;
  onReact: (reaction: HypeReactionId) => void;
  onPin?: () => void;
  onReport?: () => void;
  onOpenThread?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);

  const name = displayMessageName(row);
  const role = roleFor(row, hostId, members);
  const isTopLevel = row.message.parentId == null;
  const hasParent =
    row.message.parentId != null || (row.parent != null && row.parent.id != null);
  const canPin = isHostViewer && isTopLevel;
  const isOwn = row.user.id != null && row.user.id === viewerId;
  const canReport = !isOwn && !isHostViewer && row.user.id != null;

  const actions: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    run: () => void;
    danger?: boolean;
  }> = [];

  if (canReply && isTopLevel) {
    actions.push({
      id: "reply",
      label: "Reply",
      icon: <CornerUpLeft size={14} />,
      run: onReply,
    });
  }
  if (canReply) {
    actions.push({
      id: "react",
      label: "React",
      icon: <span aria-hidden="true">+</span>,
      run: () => setTrayOpen(open => !open),
    });
  }
  actions.push({
    id: "copy",
    label: "Copy text",
    icon: <Copy size={14} />,
    run: () => {
      void navigator.clipboard?.writeText(row.message.body).catch(() => {});
    },
  });
  if (onOpenThread && isTopLevel && replyCount > 0) {
    actions.push({
      id: "thread",
      label: `Open thread (${replyCount})`,
      icon: <Reply size={14} />,
      run: onOpenThread,
    });
  }
  if (onPin && canPin && !isPinned) {
    actions.push({
      id: "pin",
      label: "Pin message",
      icon: <Pin size={14} />,
      run: onPin,
    });
  }
  if (onReport && canReport) {
    actions.push({
      id: "report",
      label: "Report message",
      icon: <Flag size={14} />,
      run: onReport,
      danger: true,
    });
  }

  const mentionNames = useMemo(() => {
    if (!row.mentionUserIds?.length) return [] as string[];
    return row.mentionUserIds.map(id => displayInviteName(id, members));
  }, [row.mentionUserIds, members]);

  return (
    <li
      className={[
        "hype-room-message-card",
        isPinned ? "hype-room-message-card--pinned" : "",
        selected ? "hype-room-message-card--selected" : "",
        !isTopLevel ? "hype-room-message-card--reply" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-message-id={row.message.id}
    >
      <div className="hype-room-message-head">
        {row.user.photoUrl ? (
          <img
            className="hype-room-message-avatar"
            src={row.user.photoUrl}
            alt=""
            loading="lazy"
          />
        ) : (
          <span className="hype-room-message-avatar hype-room-message-avatar--initials" aria-hidden="true">
            {initialsOf(name)}
          </span>
        )}
        <span className="hype-room-message-identity">
          <span className="hype-room-message-name-row">
            <span className="hype-room-message-name">{name}</span>
            <span className={`hype-room-role-badge hype-room-role--${role}`}>
              {roleLabel(role === "member" ? "audience" : role)}
            </span>
            {isPinned ? (
              <span className="hype-room-message-pinned-tag">Pinned</span>
            ) : null}
          </span>
          <time
            className="hype-room-message-time"
            dateTime={String(row.message.createdAt)}
          >
            {formatMessageClock(row.message.createdAt)}
          </time>
        </span>
        <button
          type="button"
          className="hype-room-icon-btn hype-room-message-more"
          aria-label="Message actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={event => {
            event.stopPropagation();
            setMenuOpen(open => !open);
            onSelect();
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {hasParent ? (
        <div className="hype-room-message-parent">
          {row.parent ? (
            <>
              <span className="hype-room-message-parent-label">
                Reply to{" "}
                {row.parent.userId != null
                  ? displayInviteName(row.parent.userId, members)
                  : "message"}
              </span>
              <span className="hype-room-message-parent-body">
                {row.parent.body ?? ""}
              </span>
            </>
          ) : (
            <span className="hype-room-message-parent-label">
              Reply to a removed message
            </span>
          )}
        </div>
      ) : null}

      <p className="hype-room-message-body">{row.message.body}</p>

      {mentionNames.length > 0 ? (
        <p className="hype-room-message-mentions">
          Mentioned:{" "}
          {mentionNames.map((label, index) => (
            <span key={`${row.message.id}-m-${index}`} className="hype-room-mention-token">
              @{label}
            </span>
          ))}
        </p>
      ) : null}

      <div className="hype-room-message-foot">
        <div
          className="hype-room-reactions"
          role="group"
          aria-label="Message reactions"
        >
          {HYPE_REACTIONS.map(({ id, label, glyph }) => {
            const entry = (row.reactions ?? []).find(r => r.reaction === id);
            const count = entry?.count ?? 0;
            const mine = entry?.reactedByMe ?? false;
            const visible = count > 0 || mine;
            return (
              <button
                key={id}
                type="button"
                className={
                  mine
                    ? "hype-room-reaction hype-room-reaction--on"
                    : "hype-room-reaction"
                }
                aria-label={
                  mine
                    ? `Remove ${label} reaction`
                    : `React with ${label}`
                }
                aria-pressed={mine}
                title={label}
                disabled={!isActiveMember}
                onClick={event => {
                  event.stopPropagation();
                  onReact(id);
                }}
              >
                <span aria-hidden="true">{glyph}</span>
                {visible ? (
                  <span className="hype-room-reaction-count">{count}</span>
                ) : null}
              </button>
            );
          })}
          {isActiveMember ? (
            <button
              type="button"
              className="hype-room-reaction hype-room-reaction--add"
              aria-label="More reactions"
              aria-expanded={trayOpen}
              disabled={busy}
              onClick={event => {
                event.stopPropagation();
                setTrayOpen(open => !open);
              }}
            >
              +
            </button>
          ) : null}
        </div>

        {replyCount > 0 && onOpenThread && isTopLevel ? (
          <button
            type="button"
            className="hype-room-reply-count"
            onClick={event => {
              event.stopPropagation();
              onOpenThread();
            }}
          >
            ↳ {replyCountLabel(replyCount)}
          </button>
        ) : null}
      </div>

      {trayOpen ? (
        <div className="hype-room-reaction-tray" role="menu" aria-label="Reaction tray">
          {HYPE_REACTIONS.map(({ id, label, glyph }) => (
            <button
              key={`tray-${id}`}
              type="button"
              role="menuitem"
              aria-label={label}
              title={label}
              disabled={!isActiveMember}
              onClick={event => {
                event.stopPropagation();
                setTrayOpen(false);
                onReact(id);
              }}
            >
              {glyph}
            </button>
          ))}
          <button
            type="button"
            className="hype-room-reaction-tray-close"
            aria-label="Close reaction tray"
            onClick={event => {
              event.stopPropagation();
              setTrayOpen(false);
            }}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      {menuOpen ? (
        <div
          className="hype-room-message-menu"
          role="menu"
          aria-label="Message actions"
        >
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={
                action.danger
                  ? "hype-room-message-menu-item hype-room-message-menu-item--danger"
                  : "hype-room-message-menu-item"
              }
              disabled={busy}
              onClick={event => {
                event.stopPropagation();
                setMenuOpen(false);
                action.run();
              }}
            >
              <span aria-hidden="true">{action.icon}</span>
              {action.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="hype-room-message-menu-item"
            onClick={event => {
              event.stopPropagation();
              setMenuOpen(false);
            }}
          >
            <X size={14} />
            Close
          </button>
        </div>
      ) : null}
    </li>
  );
}
