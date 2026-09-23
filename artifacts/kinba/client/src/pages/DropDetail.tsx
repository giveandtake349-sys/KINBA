import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Lock,
  Package,
  RefreshCw,
  Tag,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropStatusChip,
  formatDropTime,
  formatMoney,
  getTrpcCode,
  useNow,
  formatCountdown,
} from "./Drops";
import "./drops.css";

type DropRow = {
  id: number;
  sellerId: number;
  title: string;
  description: string;
  terms: string;
  mediaUrl: string;
  currency: string;
  originalPrice: string;
  discountedPrice: string;
  quantity: number;
  remainingQuantity: number;
  status: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  featured: boolean;
};

type ClaimRow = {
  id: number;
  dropId: number;
  userId: number;
  status: string;
  claimedAt: Date | string;
  fulfilledAt: Date | string | null;
  cancelledAt: Date | string | null;
  notes: string | null;
};

function DetailState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="drop-state" role="status">
      <span className="drop-state-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div className="drop-state-action">{action}</div> : null}
    </div>
  );
}

function countdownFor(
  drop: Pick<DropRow, "status" | "startsAt" | "endsAt">,
  nowMs: number
): { label: string; remaining: string } | null {
  if (drop.status === "scheduled" && drop.startsAt) {
    const remainingMs = new Date(drop.startsAt).getTime() - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Starts in", remaining: formatCountdown(remainingMs) };
  }
  if (drop.status === "live" && drop.endsAt) {
    const remainingMs = new Date(drop.endsAt).getTime() - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Ends in", remaining: formatCountdown(remainingMs) };
  }
  return null;
}

function claimStatusLabel(status: string): string {
  if (status === "claimed") return "Reserved";
  if (status === "fulfilled") return "Fulfilled";
  if (status === "cancelled") return "Cancelled";
  if (status === "released") return "Released";
  return status;
}

export default function DropDetail({
  params,
}: {
  params: { id?: string };
}) {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const nowMs = useNow(1000);
  const [claiming, setClaiming] = useState(false);

  const rawId = Number(params?.id);
  const dropId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const validId = dropId != null;

  const dropQuery = trpc.drops.byId.useQuery(
    { dropId: dropId ?? -1 },
    {
      enabled: validId,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    }
  );

  const drop = dropQuery.data?.drop ?? null;
  const serverNow = dropQuery.data?.serverNow ?? null;
  const dropReady = validId && !dropQuery.isPending && !dropQuery.isError;

  const errorCode = dropQuery.isError ? getTrpcCode(dropQuery.error) : undefined;
  const unavailable =
    errorCode === "PRECONDITION_FAILED" ||
    (dropQuery.isError &&
      typeof dropQuery.error?.message === "string" &&
      dropQuery.error.message.includes("currently disabled"));
  const notFound = errorCode === "NOT_FOUND";

  const myClaimQuery = trpc.drops.myClaim.useQuery(
    { dropId: dropId ?? -1 },
    {
      enabled: dropReady && drop != null && !unavailable && auth.isAuthenticated,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    }
  );

  const claimMut = trpc.drops.claim.useMutation();
  const utils = trpc.useUtils();

  const claim = useMemo(
    () => (myClaimQuery.data ?? null) as ClaimRow | null,
    [myClaimQuery.data]
  );

  const userId = auth.user?.id ?? null;
  const isSeller = drop != null && userId != null && drop.sellerId === userId;
  const countdown = drop ? countdownFor(drop, nowMs) : null;
  const soldOut =
    drop != null &&
    (drop.status === "sold_out" || drop.remainingQuantity <= 0);
  const isActiveClaim =
    claim != null && (claim.status === "claimed" || claim.status === "fulfilled");
  const canClaim =
    drop?.status === "live" &&
    !soldOut &&
    !isActiveClaim &&
    !auth.loading;

  const requireAuth = () => {
    if (auth.isAuthenticated) return true;
    auth.openAuth();
    return false;
  };

  const handleClaim = async () => {
    if (!requireAuth() || dropId == null) return;
    setClaiming(true);
    try {
      const result = await claimMut.mutateAsync({ dropId });
      await Promise.all([
        utils.drops.byId.invalidate(),
        utils.drops.myClaim.invalidate(),
        utils.drops.list.invalidate(),
      ]);
      if (result.created) {
        toast.success("You reserved this drop.");
      } else {
        toast.success("You already have a reservation for this drop.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not claim this drop."
      );
    } finally {
      setClaiming(false);
    }
  };

  const backToList = () => navigate("/drops");

  return (
    <div className="kinba-app drops-shell">
      <main className="drops-page section-shell">
        <button type="button" className="drops-back" onClick={backToList}>
          <ArrowLeft size={15} />
          Back to drops
        </button>

        {!validId ? (
          <DetailState
            icon={<Package size={22} />}
            title="Drop not found."
            body="That drop link is not valid."
            action={
              <button type="button" className="muted-btn" onClick={backToList}>
                Back to drops
              </button>
            }
          />
        ) : dropQuery.isPending ? (
          <div className="drop-detail-skeleton" aria-label="Loading drop">
            <Skeleton className="drop-skeleton-cover" />
            <Skeleton className="drop-skeleton-line w-2/3" />
            <Skeleton className="drop-skeleton-line w-1/2" />
            <Skeleton className="drop-skeleton-line w-full" />
          </div>
        ) : unavailable ? (
          <DetailState
            icon={<Package size={22} />}
            title="Drops are unavailable right now."
            body="This feature is currently disabled on the server."
          />
        ) : notFound || (dropQuery.isSuccess && drop == null) ? (
          <DetailState
            icon={<Package size={22} />}
            title="Drop not found."
            body="This drop does not exist or is no longer available."
            action={
              <button type="button" className="muted-btn" onClick={backToList}>
                Back to drops
              </button>
            }
          />
        ) : dropQuery.isError ? (
          <DetailState
            icon={<RefreshCw size={22} />}
            title="Could not load this drop."
            body="Something went wrong while fetching the drop. Try again."
            action={
              <button
                type="button"
                className="muted-btn"
                onClick={() => void dropQuery.refetch()}
              >
                Retry
              </button>
            }
          />
        ) : drop == null ? (
          <DetailState
            icon={<Package size={22} />}
            title="Drop not found."
            body="This drop does not exist or is no longer available."
            action={
              <button type="button" className="muted-btn" onClick={backToList}>
                Back to drops
              </button>
            }
          />
        ) : (
          <>
            <header className="drop-detail-header">
              <div className="drop-detail-heading">
                <div className="drop-card-top">
                  <DropStatusChip status={drop.status} />
                  {isSeller ? (
                    <span className="drop-host-badge">Yours</span>
                  ) : null}
                </div>
                <h1>{drop.title}</h1>
                <p className="drop-price">
                  <span className="drop-price-sale">
                    {formatMoney(drop.discountedPrice, drop.currency)}
                  </span>
                  <span className="drop-price-original">
                    {formatMoney(drop.originalPrice, drop.currency)}
                  </span>
                </p>
                {countdown ? (
                  <p className="drop-countdown" aria-live="polite">
                    <Clock3 size={14} aria-hidden="true" />
                    {countdown.label} {countdown.remaining}
                  </p>
                ) : null}
                <p className="drop-desc">{drop.description}</p>
                <dl className="drop-meta">
                  <div>
                    <dt>
                      <Tag size={13} aria-hidden="true" />
                      <span className="sr-only">Availability</span>
                    </dt>
                    <dd>
                      {soldOut
                        ? "Sold out"
                        : `${drop.remainingQuantity} of ${drop.quantity} left`}
                    </dd>
                  </div>
                  {drop.startsAt ? (
                    <div>
                      <dt>
                        <CalendarClock size={13} aria-hidden="true" />
                        <span className="sr-only">Starts</span>
                      </dt>
                      <dd>Starts {formatDropTime(drop.startsAt)}</dd>
                    </div>
                  ) : null}
                  {drop.endsAt ? (
                    <div>
                      <dt>
                        <CalendarClock size={13} aria-hidden="true" />
                        <span className="sr-only">Ends</span>
                      </dt>
                      <dd>Ends {formatDropTime(drop.endsAt)}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="drop-detail-actions">
                {claim && claim.status !== "cancelled" ? (
                  <span
                    className="drop-claim-badge"
                    aria-live="polite"
                  >
                    <CheckCircle2 size={15} aria-hidden="true" />
                    {claimStatusLabel(claim.status)}
                  </span>
                ) : canClaim ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={claiming || claimMut.isPending}
                    onClick={() => void handleClaim()}
                  >
                    {claiming || claimMut.isPending
                      ? "Reserving…"
                      : "Claim drop"}
                  </button>
                ) : null}
                {!auth.isAuthenticated && drop.status === "live" && !soldOut ? (
                  <button
                    type="button"
                    className="muted-btn"
                    onClick={() => auth.openAuth()}
                  >
                    <Lock size={14} aria-hidden="true" />
                    Sign in to claim
                  </button>
                ) : null}
                {drop.status === "sold_out" || drop.remainingQuantity <= 0 ? (
                  <p className="drop-action-note">This drop is sold out.</p>
                ) : drop.status === "ended" || drop.status === "archived" ? (
                  <p className="drop-action-note">This drop has ended.</p>
                ) : drop.status === "scheduled" ? (
                  <p className="drop-action-note">
                    This drop is not live yet.
                  </p>
                ) : null}
              </div>
            </header>

            <section className="drop-panel" aria-label="Drop details">
              <div className="drop-panel-header">
                <h2>Offer terms</h2>
              </div>
              <div className="drop-panel-body">
                <p className="drop-terms">{drop.terms}</p>
                <p className="drop-disclaimer">
                  Social reservation only — no payment or checkout is involved.
                  {serverNow
                    ? ` Server time: ${formatDropTime(serverNow)}.`
                    : ""}
                </p>
              </div>
            </section>
          </>
        )}
      </main>
      {auth.authDialogOpen && !auth.isAuthenticated ? (
        <SupabaseAuthDialog
          open
          onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
        />
      ) : null}
    </div>
  );
}
