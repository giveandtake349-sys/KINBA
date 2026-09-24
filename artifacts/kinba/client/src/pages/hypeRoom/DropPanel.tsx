import { Package } from "lucide-react";
import { Link } from "wouter";
import { formatMoney, formatDropTime } from "../Drops";

type DropSummary = {
  id: number;
  title: string;
  status: string;
  discountedPrice: string;
  originalPrice: string;
  currency: string;
  remainingQuantity: number;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
};

/**
 * Room-linked Drop surface. Only renders when the room actually has a
 * non-null dropId and the Drop loads from existing drops.byId — no
 * fabricated counters, no duplicate claim endpoints.
 */
export function DropPanel({
  drop,
  loading,
  error,
  onRetry,
}: {
  drop: DropSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <section className="hype-room-panel hype-room-drop-panel" aria-label="Room drop" aria-busy>
        <div className="hype-room-panel-header">
          <h2>
            <Package size={15} aria-hidden="true" /> Drop
          </h2>
        </div>
        <div className="hype-room-panel-body">
          <p className="hype-room-panel-empty">Loading drop…</p>
        </div>
      </section>
    );
  }

  if (error || !drop) {
    return (
      <section className="hype-room-panel hype-room-drop-panel" aria-label="Room drop">
        <div className="hype-room-panel-header">
          <h2>
            <Package size={15} aria-hidden="true" /> Drop
          </h2>
        </div>
        <div className="hype-room-panel-body">
          <p className="hype-room-panel-error">Could not load this drop.</p>
          <button type="button" className="muted-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  const soldOut =
    drop.status === "sold_out" || drop.remainingQuantity <= 0;
  const statusLabel =
    drop.status === "live"
      ? soldOut
        ? "Sold out"
        : "Live"
      : drop.status === "scheduled"
        ? "Scheduled"
        : drop.status === "ended"
          ? "Ended"
          : drop.status === "archived"
            ? "Archived"
            : drop.status;

  return (
    <section className="hype-room-panel hype-room-drop-panel" aria-label="Room drop">
      <div className="hype-room-panel-header">
        <h2>
          <Package size={15} aria-hidden="true" /> Drop
          <span className={`hype-room-drop-status hype-room-drop-status--${drop.status}`}>
            {statusLabel}
          </span>
        </h2>
      </div>
      <div className="hype-room-panel-body hype-room-drop-body">
        <p className="hype-room-drop-title">{drop.title}</p>
        <p className="hype-room-drop-meta">
          {formatMoney(drop.discountedPrice, drop.currency)}
          {drop.discountedPrice !== drop.originalPrice
            ? ` (was ${formatMoney(drop.originalPrice, drop.currency)})`
            : ""}{" "}
          · {Math.max(0, drop.remainingQuantity)} left
        </p>
        {drop.endsAt ? (
          <p className="hype-room-drop-meta">Ends {formatDropTime(drop.endsAt)}</p>
        ) : null}
        <Link href={`/drops/${drop.id}`} className="primary-btn hype-room-drop-cta">
          View drop &amp; claim
        </Link>
      </div>
    </section>
  );
}
