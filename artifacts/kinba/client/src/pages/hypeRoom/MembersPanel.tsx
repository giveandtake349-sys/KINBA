import { Mail, Send, Trash2, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  displayInviteName,
  displayMemberName,
  roleLabel,
  type InviteRow,
  type MemberRow,
} from "./shared";

/**
 * Members panel — role hierarchy presentation + real host controls only.
 * No fake presence/online indicators; no audio affordances.
 */
export function MembersPanel({
  members,
  invites,
  hostId,
  isHostViewer,
  viewerId,
  busy,
  loading,
  error,
  invitesReady,
  onRetry,
  onSetRole,
  onRemove,
}: {
  members: MemberRow[];
  invites: InviteRow[];
  hostId: number;
  isHostViewer: boolean;
  viewerId: number | null;
  busy: boolean;
  loading: boolean;
  error: boolean;
  invitesReady: boolean;
  onRetry: () => void;
  onSetRole: (userId: number, role: "speaker" | "audience") => void;
  onRemove: (userId: number) => void;
}) {
  return (
    <section
      className="hype-room-panel"
      aria-label="Room members"
      aria-busy={loading || undefined}
    >
      <div className="hype-room-panel-header">
        <h2>
          <Users size={15} aria-hidden="true" /> Members
          {!loading && !error ? (
            <span className="hype-room-panel-count">{members.length}</span>
          ) : null}
        </h2>
      </div>

      {loading ? (
        <div className="hype-room-panel-body">
          <Skeleton className="hype-room-skeleton-line w-full" />
          <Skeleton className="hype-room-skeleton-line w-2/3" />
        </div>
      ) : error ? (
        <div className="hype-room-panel-body">
          <p className="hype-room-panel-error">Could not load members.</p>
          <button type="button" className="muted-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : members.length === 0 ? (
        <div className="hype-room-panel-body">
          <p className="hype-room-panel-empty">
            No members yet. Join to get started.
          </p>
        </div>
      ) : (
        <ul className="hype-room-member-list">
          {members.map(member => {
            const memberIsHost =
              member.membership.role === "host" || member.user.id === hostId;
            const isSelf = member.user.id === viewerId;
            const currentRole = memberIsHost
              ? "host"
              : member.membership.role;
            // Hierarchy order: host, speaker, then audience — already natural list order from server.
            return (
              <li
                key={member.membership.id}
                className={`hype-room-member-row hype-room-member-row--${currentRole}`}
              >
                <span className="hype-room-member-main">
                  <span className="hype-room-member-name">
                    {displayMemberName(member)}
                  </span>
                  <span
                    className={`hype-room-role-badge hype-room-role--${currentRole}`}
                  >
                    {roleLabel(currentRole)}
                  </span>
                </span>
                {isHostViewer && !memberIsHost && !isSelf ? (
                  <span className="hype-room-member-actions">
                    {currentRole === "speaker" ? (
                      <button
                        type="button"
                        className="hype-room-icon-btn"
                        aria-label={`Move ${displayMemberName(member)} to audience`}
                        title="Move to audience"
                        disabled={busy}
                        onClick={() => onSetRole(member.user.id, "audience")}
                      >
                        <Users size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="hype-room-icon-btn"
                        aria-label={`Promote ${displayMemberName(member)} to speaker`}
                        title="Promote to speaker"
                        disabled={busy}
                        onClick={() => onSetRole(member.user.id, "speaker")}
                      >
                        <Send size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="hype-room-icon-btn"
                      aria-label={`Remove ${displayMemberName(member)}`}
                      title="Remove member"
                      disabled={busy}
                      onClick={() => onRemove(member.user.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isHostViewer && invitesReady ? (
        <div className="hype-room-invites-inline">
          <h3>
            <Mail size={13} aria-hidden="true" /> Room invites ({invites.length})
          </h3>
          {invites.length === 0 ? (
            <p className="hype-room-panel-empty">
              No invites yet. Use Invite to search for people.
            </p>
          ) : (
            <ul className="hype-room-invite-list">
              {invites.map(invite => (
                <li key={invite.id}>
                  <span>
                    {displayInviteName(invite.invitedUserId, members)}
                  </span>
                  <span
                    className={`hype-room-invite-status hype-room-invite-status--${invite.status}`}
                  >
                    {invite.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
