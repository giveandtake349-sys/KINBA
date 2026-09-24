import { MessageSquare, Radio, Users } from "lucide-react";

/**
 * Professional empty-chat onboarding for zero-message rooms.
 * No fake buttons — only explains real capabilities; host/member CTAs
 * are optional real actions passed by the parent.
 */
export function EmptyRoom({
  isLive,
  isHost,
  isActiveMember,
  hostAction,
  memberAction,
}: {
  isLive: boolean;
  isHost: boolean;
  isActiveMember: boolean;
  hostAction?: { label: string; onClick: () => void };
  memberAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="hype-room-empty" role="status">
      <span className="hype-room-empty-icon" aria-hidden="true">
        <Radio size={22} />
      </span>
      <h3>
        {isLive ? "This room is live — say hello" : "Welcome to this Hype Room"}
      </h3>
      <p className="hype-room-empty-lede">
        A temporary live community for real conversation. Here you can:
      </p>
      <ul className="hype-room-empty-list">
        <li>
          <MessageSquare size={14} aria-hidden="true" /> Discuss with the room
          while it is live
        </li>
        <li>
          <Users size={14} aria-hidden="true" /> Ask questions and reply in
          threads
        </li>
        <li>
          <span aria-hidden="true">👍</span> React to messages to join the vibe
        </li>
        <li>
          <span aria-hidden="true">🎁</span> Participate in Drops when the room
          is linked to one
        </li>
      </ul>
      {isHost && hostAction ? (
        <button type="button" className="primary-btn" onClick={hostAction.onClick}>
          {hostAction.label}
        </button>
      ) : null}
      {!isHost && !isActiveMember && memberAction && isLive ? (
        <button
          type="button"
          className="primary-btn"
          onClick={memberAction.onClick}
        >
          {memberAction.label}
        </button>
      ) : null}
      {!isHost && isActiveMember ? (
        <p className="hype-room-empty-hint">
          You are in the room — type below when chat opens.
        </p>
      ) : null}
      {!isLive ? (
        <p className="hype-room-empty-hint">
          Chat opens when the room goes live.
        </p>
      ) : null}
    </div>
  );
}
