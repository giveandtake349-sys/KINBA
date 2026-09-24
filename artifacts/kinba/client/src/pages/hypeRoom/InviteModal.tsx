import { UserPlus, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { InviteRow, InviteTarget, MemberRow } from "./shared";

/**
 * Invite sheet — createInvite + listInvites only. No fake share links.
 * Search uses existing home.searchAll (debounced by parent).
 */
export function InviteModal({
  roomTitle,
  term,
  onTermChange,
  search,
  searchLoading,
  searchError,
  results,
  invites,
  members,
  inviting,
  canInvite,
  onClose,
  onInvite,
}: {
  roomTitle: string;
  term: string;
  onTermChange: (value: string) => void;
  search: string;
  searchLoading: boolean;
  searchError: boolean;
  results: InviteTarget[];
  invites: InviteRow[];
  members: MemberRow[];
  inviting: boolean;
  canInvite: boolean;
  onClose: () => void;
  onInvite: (userId: number) => void;
}) {
  return (
    <div className="action-modal-layer" role="presentation">
      <button
        type="button"
        className="action-modal-backdrop"
        aria-label="Close invite"
        onClick={onClose}
      />
      <section
        className="action-modal report-dialog hype-room-invite-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Invite to room"
      >
        <div className="action-modal-head">
          <h2>
            <UserPlus size={18} aria-hidden="true" /> Invite to room
          </h2>
          <button type="button" aria-label="Close invite" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-form report-dialog-form">
          <p className="report-dialog-hint">
            Inviting to <strong>{roomTitle}</strong>. Search by name or
            username. Current members cannot be invited again.
          </p>
          <label htmlFor="hype-invite-search">
            Search
            <input
              id="hype-invite-search"
              value={term}
              onChange={event => onTermChange(event.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder="Name or @username (min 2 characters)"
            />
          </label>

          {invites.length > 0 ? (
            <div className="hype-room-invite-pending">
              <h3>Sent invites ({invites.length})</h3>
              <ul className="hype-room-invite-list">
                {invites.map(invite => {
                  const match = members.find(
                    member => member.user.id === invite.invitedUserId
                  );
                  return (
                    <li key={invite.id}>
                      <span>
                        {match
                          ? match.user.username ||
                            match.user.name ||
                            `User #${invite.invitedUserId}`
                          : `User #${invite.invitedUserId}`}
                      </span>
                      <span
                        className={`hype-room-invite-status hype-room-invite-status--${invite.status}`}
                      >
                        {invite.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div
            className="hype-room-invite-results"
            aria-live="polite"
            aria-busy={searchLoading || undefined}
          >
            {search.trim().length < 2 ? (
              <p className="hype-room-panel-empty">
                Type at least 2 characters to search.
              </p>
            ) : searchLoading ? (
              <Skeleton className="hype-room-skeleton-line w-full" />
            ) : searchError ? (
              <p className="hype-room-panel-error">
                Could not search right now.
              </p>
            ) : results.length === 0 ? (
              <p className="hype-room-panel-empty">
                No people found (or they are already members).
              </p>
            ) : (
              <ul className="hype-room-invite-results-list">
                {results.map(user => (
                  <li key={user.id}>
                    <span>
                      {user.username || user.name || `User #${user.id}`}
                    </span>
                    <button
                      type="button"
                      className="muted-btn"
                      disabled={inviting || !canInvite}
                      onClick={() => onInvite(user.id)}
                    >
                      Invite
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="report-dialog-actions">
            <button type="button" className="muted-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
