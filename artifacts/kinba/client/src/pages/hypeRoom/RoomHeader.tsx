import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Clock3,
  Eye,
  Flag,
  Info,
  Lock,
  MoreHorizontal,
  Radio,
  Settings,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  countdownFor,
  roomPhase,
  roomPhaseLabel,
  type RoomPhase,
} from "./shared";

export type HeaderRoom = {
  id: number;
  title: string;
  topic: string | null;
  description: string | null;
  status: string;
  durationHours: number;
  startsAt: Date | string;
  endsAt: Date | string;
  visibility: "public" | "link_only";
  hostId: number;
  cancelReason?: string | null;
};

type OverflowItemId =
  | "info"
  | "settings"
  | "invite"
  | "report"
  | "leave";

function StatusPill({ phase }: { phase: RoomPhase }) {
  const label = roomPhaseLabel(phase);
  return (
    <span
      className={`hype-room-phase hype-room-phase--${phase}`}
      aria-label={`Status: ${label}`}
    >
      <span className="hype-room-phase-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function OverflowMenu({
  items,
  onAction,
  busy,
}: {
  items: Array<{ id: OverflowItemId; label: string; icon: ReactNode; danger?: boolean }>;
  onAction: (id: OverflowItemId) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (
        layerRef.current &&
        !layerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="hype-room-overflow" ref={layerRef}>
      <button
        type="button"
        className="hype-room-icon-btn hype-room-overflow-trigger"
        aria-label="Room menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="hype-room-overflow-menu" role="menu" aria-label="Room actions">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={
                item.danger
                  ? "hype-room-overflow-item hype-room-overflow-item--danger"
                  : "hype-room-overflow-item"
              }
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onAction(item.id);
              }}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RoomInfoDialog({
  room,
  hostName,
  participantCount,
  onClose,
}: {
  room: HeaderRoom;
  hostName: string | null;
  participantCount: number | null;
  onClose: () => void;
}) {
  return (
    <div className="action-modal-layer" role="presentation">
      <button
        type="button"
        className="action-modal-backdrop"
        aria-label="Close room information"
        onClick={onClose}
      />
      <section
        className="action-modal report-dialog hype-room-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Room information"
      >
        <div className="action-modal-head">
          <h2>
            <Info size={18} aria-hidden="true" /> Room information
          </h2>
          <button type="button" aria-label="Close room information" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="hype-room-info-body">
          <p className="hype-room-info-title">{room.title}</p>
          {room.topic ? <p className="hype-room-topic">{room.topic}</p> : null}
          {room.description ? (
            <p className="hype-room-info-desc">{room.description}</p>
          ) : null}
          <dl className="hype-room-meta">
            <div>
              <dt>
                <Users size={13} aria-hidden="true" />
                <span className="sr-only">Host</span>
              </dt>
              <dd>{hostName ?? "Loading host…"}</dd>
            </div>
            <div>
              <dt>
                <Users size={13} aria-hidden="true" />
                <span className="sr-only">Participants</span>
              </dt>
              <dd>
                {participantCount != null
                  ? `${participantCount} participant${participantCount === 1 ? "" : "s"}`
                  : "Loading…"}
              </dd>
            </div>
            <div>
              <dt>
                <Clock3 size={13} aria-hidden="true" />
                <span className="sr-only">Duration</span>
              </dt>
              <dd>{room.durationHours}h window</dd>
            </div>
            <div>
              <dt>
                <CalendarClock size={13} aria-hidden="true" />
                <span className="sr-only">Starts</span>
              </dt>
              <dd>{new Date(room.startsAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                <CalendarClock size={13} aria-hidden="true" />
                <span className="sr-only">Ends</span>
              </dt>
              <dd>{new Date(room.endsAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                <Eye size={13} aria-hidden="true" />
                <span className="sr-only">Visibility</span>
              </dt>
              <dd>{room.visibility === "public" ? "Public" : "Link only"}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}

export function RoomHeader({
  room,
  nowMs,
  isHost,
  isActiveMember,
  showJoin,
  showLeave,
  canEnd,
  canCancel,
  canEditSettings,
  showSignIn,
  participantCount,
  hostName,
  hostPhoto,
  actionBusy,
  joinPending,
  leavePending,
  endPending,
  cancelPending,
  onJoin,
  onLeave,
  onEnd,
  onCancel,
  onOpenSettings,
  onOpenInvite,
  onOpenReport,
  onSignIn,
}: {
  room: HeaderRoom;
  nowMs: number;
  isHost: boolean;
  isActiveMember: boolean;
  showJoin: boolean;
  showLeave: boolean;
  canEnd: boolean;
  canCancel: boolean;
  canEditSettings: boolean;
  showSignIn: boolean;
  participantCount: number | null;
  hostName: string | null;
  hostPhoto: string | null;
  actionBusy: boolean;
  joinPending: boolean;
  leavePending: boolean;
  endPending: boolean;
  cancelPending: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onOpenReport: () => void;
  onSignIn: () => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const phase = roomPhase(room, nowMs);
  const countdown = countdownFor(room, nowMs);
  const isEnded = phase === "ended" || phase === "archived";

  const overflowItems: Array<{
    id: OverflowItemId;
    label: string;
    icon: ReactNode;
    danger?: boolean;
  }> = [
    { id: "info", label: "Room information", icon: <Info size={15} /> },
  ];
  if (canEditSettings) {
    overflowItems.push(
      { id: "settings", label: "Settings", icon: <Settings size={15} /> },
      { id: "invite", label: "Invite people", icon: <UserPlus size={15} /> }
    );
  }
  if (!isHost && isActiveMember && !isEnded) {
    overflowItems.push({
      id: "leave",
      label: "Leave room",
      icon: <X size={15} />,
      danger: true,
    });
  }
  if (!isHost) {
    overflowItems.push({
      id: "report",
      label: "Report room",
      icon: <Flag size={15} />,
    });
  }

  const handleOverflow = (id: OverflowItemId) => {
    if (id === "info") {
      setInfoOpen(true);
      return;
    }
    if (id === "settings") onOpenSettings();
    if (id === "invite") onOpenInvite();
    if (id === "report") onOpenReport();
    if (id === "leave") onLeave();
  };

  const hostInitials = hostName
    ? hostName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("")
    : "?";

  return (
    <header className="hype-room-header">
      <div className="hype-room-topbar">
        <span className="hype-room-identity">
          <Radio size={13} aria-hidden="true" />
          HYPE ROOM
        </span>
        <OverflowMenu
          items={overflowItems}
          onAction={handleOverflow}
          busy={actionBusy}
        />
      </div>

      <div className="hype-room-hero">
        <div className="hype-room-hero-status">
          <StatusPill phase={phase} />
          {isHost ? <span className="hype-room-host-badge">You host</span> : null}
          {isActiveMember && !isHost ? (
            <span className="hype-room-member-badge">Joined</span>
          ) : null}
        </div>

        <h1>{room.title}</h1>

        <div className="hype-room-host-row">
          {hostPhoto ? (
            <img
              className="hype-room-host-avatar"
              src={hostPhoto}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="hype-room-host-avatar hype-room-host-avatar--initials" aria-hidden="true">
              {hostInitials}
            </span>
          )}
          <span className="hype-room-host-text">
            <span className="hype-room-host-label">Hosted by</span>
            <span className="hype-room-host-name">
              {hostName ?? "Loading host…"}
            </span>
          </span>
        </div>

        {room.topic ? <p className="hype-room-topic">{room.topic}</p> : null}
        {room.description ? (
          <p className="hype-room-desc hype-room-detail-desc">{room.description}</p>
        ) : null}

        <div className="hype-room-hero-facts">
          <span className="hype-room-fact" title="Participants">
            <Users size={13} aria-hidden="true" />
            {participantCount != null
              ? `${participantCount} here`
              : "Loading…"}
          </span>
          {countdown ? (
            <span
              className={`hype-room-fact hype-room-fact--countdown ${
                phase === "ending" ? "hype-room-fact--urgent" : ""
              }`}
              aria-live="polite"
            >
              <Clock3 size={13} aria-hidden="true" />
              {countdown.label} {countdown.remaining}
            </span>
          ) : (
            <span className="hype-room-fact">
              <CalendarClock size={13} aria-hidden="true" />
              {room.durationHours}h window
            </span>
          )}
          <span className="hype-room-fact">
            <Eye size={13} aria-hidden="true" />
            {room.visibility === "public" ? "Public" : "Link only"}
          </span>
        </div>

        {showJoin || showLeave || canEnd || canCancel || showSignIn ? (
          <div className="hype-room-detail-actions">
            {showJoin ? (
              <button
                type="button"
                className="primary-btn"
                disabled={actionBusy}
                onClick={onJoin}
              >
                {joinPending ? "Joining…" : "Join room"}
              </button>
            ) : null}
            {showLeave ? (
              <button
                type="button"
                className="muted-btn"
                disabled={actionBusy}
                onClick={onLeave}
              >
                {leavePending ? "Leaving…" : "Leave room"}
              </button>
            ) : null}
            {canEnd ? (
              <button
                type="button"
                className="danger-btn"
                disabled={actionBusy}
                onClick={onEnd}
              >
                {endPending ? "Ending…" : "End room"}
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="danger-btn"
                disabled={actionBusy}
                onClick={onCancel}
              >
                {cancelPending ? "Cancelling…" : "Cancel room"}
              </button>
            ) : null}
            {showSignIn ? (
              <button type="button" className="muted-btn" onClick={onSignIn}>
                <Lock size={14} aria-hidden="true" />
                Sign in to join
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {phase === "ended" ? (
        <p className="hype-room-terminal-note" role="status">
          <Clock3 size={14} aria-hidden="true" />
          This Hype Room has ended. History stays readable below.
        </p>
      ) : phase === "archived" ? (
        <p className="hype-room-terminal-note" role="status">
          <Lock size={14} aria-hidden="true" />
          {room.cancelReason
            ? `Archived — ${room.cancelReason}`
            : "This room is archived."}
        </p>
      ) : null}

      {infoOpen ? (
        <RoomInfoDialog
          room={room}
          hostName={hostName}
          participantCount={participantCount}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
    </header>
  );
}
