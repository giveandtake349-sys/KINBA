import { useState } from "react";
import { Package } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { formatMoney, formatDropTime } from "../Drops";

type DropSummary = {
  id: number;
  title: string;
  mediaUrl: string;
  status: string;
  discountedPrice: string;
  originalPrice: string;
  currency: string;
  remainingQuantity: number;
  endsAt: Date | string | null;
};

/**
 * Room-linked Drop surface. Only renders when the room actually has an
 * attached drop — fields ride on the room detail response (getHypeRoom),
 * no fabricated counters. Buy reuses the existing drops.claim mutation,
 * same handling as the drop detail page.
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
  const auth = useAuth();
  const utils = trpc.useUtils();
  const claimMut = trpc.drops.claim.useMutation();
  const [claiming, setClaiming] = useState(false);

  const myClaimQuery = trpc.drops.myClaim.useQuery(
    { dropId: drop?.id ?? -1 },
    {
      enabled: drop != null && auth.isAuthenticated,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    }
  );

  if (loading) {
    return (
      <section className="hype-room-panel hype-room-drop-panel" aria-label="Room drop" aria-busy>
        <div className="hype-room-panel-header">
          <h2>
            <Package size={16} aria-hidden="true" /> Drop
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
            <Package size={16} aria-hidden="true" /> Drop
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

  const claim = myClaimQuery.data ?? null;
  const soldOut =
    drop.status === "sold_out" || drop.remainingQuantity <= 0;
  const isActiveClaim =
    claim != null &&
    (claim.status === "claimed" || claim.status === "fulfilled");
  const canClaim =
    drop.status === "live" &&
    !soldOut &&
    !isActiveClaim &&
    !auth.loading &&
    !claiming;
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

  const handleBuy = async () => {
    if (!auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    if (!canClaim) return;
    setClaiming(true);
    try {
      const result = await claimMut.mutateAsync({ dropId: drop.id });
      await Promise.all([
        utils.hypeRooms.byId.invalidate(),
        utils.drops.myClaim.invalidate(),
        utils.drops.list.invalidate(),
        utils.drops.byId.invalidate(),
      ]);
      toast.success(
        result.created
          ? "You reserved this drop."
          : "You already have a reservation for this drop."
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not claim this drop."
      );
    } finally {
      setClaiming(false);
    }
  };

  return (
    <section className="hype-room-panel hype-room-drop-panel" aria-label="Room drop">
      <div className="hype-room-panel-header">
        <h2>
          <Package size={16} aria-hidden="true" /> Drop
          <span className={`hype-room-drop-status hype-room-drop-status--${drop.status}`}>
            {statusLabel}
          </span>
        </h2>
      </div>
      <div className="hype-room-panel-body hype-room-drop-body">
        <div className="hype-room-drop-top">
          {drop.mediaUrl ? (
            <img
              className="hype-room-drop-thumb"
              src={drop.mediaUrl}
              alt=""
              loading="lazy"
            />
          ) : null}
          <div className="hype-room-drop-info">
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
          </div>
        </div>
        <div className="hype-room-drop-actions">
          <button
            type="button"
            className="primary-btn hype-room-drop-cta"
            onClick={() => void handleBuy()}
            disabled={!canClaim}
          >
            {claiming
              ? "Reserving…"
              : isActiveClaim
                ? "Reserved ✓"
                : soldOut
                  ? "Sold out"
                  : "Buy"}
          </button>
          <Link href={`/drops/${drop.id}`} className="muted-btn hype-room-drop-cta">
            View drop
          </Link>
        </div>
      </div>
    </section>
  );
}
