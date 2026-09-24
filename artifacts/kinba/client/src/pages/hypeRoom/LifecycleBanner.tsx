import { CalendarClock, Clock3, Lock, Radio } from "lucide-react";
import { countdownFor, roomPhase, roomPhaseLabel, type RoomPhase } from "./shared";

type LifecycleRoom = {
  status: string;
  startsAt: Date | string;
  endsAt: Date | string;
  cancelReason?: string | null;
};

/**
 * Lifecycle banner — upcoming / ending / ended / archived messaging.
 * Server status stays authoritative; countdown is real window data only.
 * Terminal actions are already disabled by server gates in RoomHeader.
 */
export function LifecycleBanner({
  room,
  nowMs,
}: {
  room: LifecycleRoom;
  nowMs: number;
}) {
  const phase = roomPhase(room, nowMs);
  const countdown = countdownFor(room, nowMs);

  if (phase === "upcoming") {
    return (
      <div className="hype-room-lifecycle hype-room-lifecycle--upcoming" role="status">
        <CalendarClock size={15} aria-hidden="true" />
        <div>
          <strong>Upcoming</strong>
          <span>
            {countdown
              ? `${countdown.label} ${countdown.remaining}`
              : `Starts ${new Date(room.startsAt).toLocaleString()}`}
          </span>
        </div>
      </div>
    );
  }

  if (phase === "live" || phase === "ending") {
    return (
      <div
        className={`hype-room-lifecycle hype-room-lifecycle--${phase}`}
        role="status"
      >
        <Radio size={15} aria-hidden="true" />
        <div>
          <strong>{roomPhaseLabel(phase)}</strong>
          <span>
            {countdown
              ? `${countdown.label} ${countdown.remaining}`
              : "Live window"}
            {phase === "ending" ? " — room is closing soon" : ""}
          </span>
        </div>
      </div>
    );
  }

  if (phase === "ended") {
    return (
      <div className="hype-room-lifecycle hype-room-lifecycle--ended" role="status">
        <Clock3 size={15} aria-hidden="true" />
        <div>
          <strong>ROOM ENDED</strong>
          <span>This Hype Room has ended. History stays readable below.</span>
        </div>
      </div>
    );
  }

  if (phase === "archived") {
    return (
      <div className="hype-room-lifecycle hype-room-lifecycle--archived" role="status">
        <Lock size={15} aria-hidden="true" />
        <div>
          <strong>Archived</strong>
          <span>
            {room.cancelReason
              ? `Cancelled: ${room.cancelReason}`
              : "This room is no longer active."}
          </span>
        </div>
      </div>
    );
  }

  return null;
}
