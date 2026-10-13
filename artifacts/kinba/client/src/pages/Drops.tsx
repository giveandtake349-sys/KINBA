import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  Package,
  RefreshCw,
  Search,
  Tag,
  Users,
} from "lucide-react";
import { TRPCClientError } from "@trpc/client";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { Skeleton } from "@/components/ui/skeleton";
import "./drops.css";

type DropRow = {
  id: number;
  sellerId: number;
  title: string;
  description: string;
  terms: string;
  mediaUrl: string;
  mediaWidth: number | null;
  mediaHeight: number | null;
  currency: string;
  originalPrice: string;
  discountedPrice: string;
  quantity: number;
  remainingQuantity: number;
  status: string;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  featured: boolean;
  endedAt: Date | string | null;
  archivedAt: Date | string | null;
};

type DropListFilter = "live" | "upcoming" | "mine";

const FILTERS: ReadonlyArray<{ id: DropListFilter; label: string }> = [
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "mine", label: "Mine" },
];

type QuickFilter = "all" | "live_now" | "ending_soon" | "mine";

const QUICK_FILTERS: ReadonlyArray<{ id: QuickFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "live_now", label: "Live now" },
  { id: "ending_soon", label: "Ending soon" },
  { id: "mine", label: "Mine" },
];

const ENDING_SOON_MS = 24 * 60 * 60 * 1000;

const EMPTY_COPY: Record<DropListFilter, { title: string; body: string }> = {
  live: {
    title: "No live drops right now.",
    body: "When a drop goes live, it will appear here.",
  },
  upcoming: {
    title: "No upcoming drops.",
    body: "Scheduled drops will show here before they start.",
  },
  mine: {
    title: "You have not created a drop yet.",
    body: "Drops you sell will appear under Mine.",
  },
};

export function getTrpcCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    return error.data?.code;
  }
  return undefined;
}

export function formatDropTime(value: Date | string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMoney(amount: string, currency: string): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${currency} ${amount}`;
  return `${currency} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function DropStatusChip({ status }: { status: string }) {
  const label =
    status === "live"
      ? "Live"
      : status === "scheduled"
        ? "Scheduled"
        : status === "sold_out"
          ? "Sold out"
          : status === "ended"
            ? "Ended"
            : status === "archived"
              ? "Archived"
              : status === "draft"
                ? "Draft"
                : status;
  return (
    <span
      className={`drop-chip drop-chip--${status}`}
      aria-label={`Status: ${label}`}
    >
      <span className="drop-chip-dot" aria-hidden="true" />
      {label}
    </span>
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

function DropCard({
  drop,
  nowMs,
  isSeller,
  onOpen,
}: {
  drop: DropRow;
  nowMs: number;
  isSeller: boolean;
  onOpen: () => void;
}) {
  const countdown = countdownFor(drop, nowMs);
  const soldOut = drop.status === "sold_out" || drop.remainingQuantity <= 0;
  const original = Number(drop.originalPrice);
  const discounted = Number(drop.discountedPrice);
  const salePct =
    Number.isFinite(original) &&
    Number.isFinite(discounted) &&
    original > 0 &&
    discounted < original
      ? Math.round((1 - discounted / original) * 100)
      : 0;
  const claimed = Math.max(0, drop.quantity - drop.remainingQuantity);
  const claimedPct =
    drop.quantity > 0
      ? Math.min(100, Math.round((claimed / drop.quantity) * 100))
      : 0;
  return (
    <article
      className="drop-card drop-card--interactive"
      aria-labelledby={`drop-${drop.id}`}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {drop.mediaUrl ? (
        <div className="drop-card-cover">
          <img src={drop.mediaUrl} alt="" loading="lazy" />
          {salePct > 0 ? (
            <span className="drop-sale-badge" aria-label={`${salePct} percent off`}>
              -{salePct}%
            </span>
          ) : null}
        </div>
      ) : (
        <div className="drop-card-cover drop-card-cover--placeholder" aria-hidden="true">
          <Package size={32} strokeWidth={1.6} />
          {salePct > 0 ? (
            <span className="drop-sale-badge" aria-label={`${salePct} percent off`}>
              -{salePct}%
            </span>
          ) : null}
        </div>
      )}
      <div className="drop-card-body">
        <div className="drop-card-top">
          <DropStatusChip status={drop.status} />
          {isSeller ? <span className="drop-host-badge">Yours</span> : null}
        </div>
        <h3 id={`drop-${drop.id}`}>{drop.title}</h3>
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
        <dl className="drop-meta">
          <div>
            <dt>
              <Tag size={14} aria-hidden="true" />
              <span className="sr-only">Availability</span>
            </dt>
            <dd>
              {soldOut
                ? "Sold out"
                : `${drop.remainingQuantity} of ${drop.quantity} left`}
            </dd>
          </div>
          {drop.endsAt ? (
            <div>
              <dt>
                <CalendarClock size={14} aria-hidden="true" />
                <span className="sr-only">Ends</span>
              </dt>
              <dd>Ends {formatDropTime(drop.endsAt)}</dd>
            </div>
          ) : null}
        </dl>
        <div
          className="drop-stockbar"
          role="progressbar"
          aria-valuenow={claimedPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${claimedPct} percent claimed`}
        >
          <span style={{ width: `${claimedPct}%` }} />
        </div>
      </div>
    </article>
  );
}

function DropsState({
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

/**
 * Public drops discovery. Uses filter "live" for public lists so drafts are
 * never shown; "upcoming" and "mine" also strip drafts for non-owners
 * (server includes drafts under upcoming/all — client hides them publicly).
 */
export default function Drops() {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const [filter, setFilter] = useState<DropListFilter>("live");
  const nowMs = useNow(1000);

  const needsAuth = filter === "mine";
  const blockedByAuth =
    needsAuth && !auth.loading && !auth.isAuthenticated;

  const query = trpc.drops.list.useQuery(
    { filter },
    {
      enabled: !blockedByAuth,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );

  const rawDrops = useMemo(
    () => (query.data?.drops ?? []) as DropRow[],
    [query.data]
  );

  const drops = useMemo(() => {
    const userId = auth.user?.id ?? null;
    return rawDrops.filter(drop => {
      if (drop.status === "draft") {
        // Drafts only visible to their seller under Mine.
        if (filter !== "mine") return false;
        return userId != null && drop.sellerId === userId;
      }
      if (filter === "upcoming") return drop.status === "scheduled";
      if (filter === "live") {
        return (
          drop.status === "live" ||
          (drop.status === "scheduled" && drop.remainingQuantity > 0)
        );
      }
      return true;
    });
  }, [rawDrops, filter, auth.user?.id]);

  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const visibleDrops = useMemo(() => {
    const q = search.trim().toLowerCase();
    const userId = auth.user?.id ?? null;
    return drops.filter(drop => {
      if (q && !drop.title.toLowerCase().includes(q)) return false;
      if (quickFilter === "live_now") return drop.status === "live";
      if (quickFilter === "ending_soon") {
        if (drop.status !== "live" || !drop.endsAt) return false;
        const ms = new Date(drop.endsAt).getTime() - nowMs;
        return ms > 0 && ms <= ENDING_SOON_MS;
      }
      if (quickFilter === "mine") {
        return userId != null && drop.sellerId === userId;
      }
      return true;
    });
  }, [drops, search, quickFilter, nowMs, auth.user?.id]);

  const heroDrop = useMemo(() => {
    if (filter !== "live" || search.trim() || quickFilter !== "all") {
      return null;
    }
    return (
      visibleDrops.find(drop => drop.featured && drop.status === "live") ??
      visibleDrops.find(drop => drop.status === "live") ??
      null
    );
  }, [visibleDrops, filter, search, quickFilter]);

  const heroCountdown =
    heroDrop != null ? countdownFor(heroDrop, nowMs) : null;

  const authReady = !needsAuth || !auth.loading;
  const isLoading = authReady && query.isPending && !blockedByAuth;
  const errorCode = query.isError ? getTrpcCode(query.error) : undefined;
  const unavailable =
    errorCode === "PRECONDITION_FAILED" ||
    (query.isError &&
      typeof query.error?.message === "string" &&
      query.error.message.includes("currently disabled"));
  const unauthorized =
    blockedByAuth || errorCode === "UNAUTHORIZED";

  const goHome = () => navigate("/");
  const openDrop = (dropId: number) => navigate(`/drops/${dropId}`);

  return (
    <div className="kinba-app drops-shell">
      <main className="drops-page section-shell">
        <button type="button" className="drops-back" onClick={goHome}>
          <ArrowLeft size={16} />
          Back to feed
        </button>

        <header className="drops-header">
          <div>
            <p className="eyebrow eyebrow--bright">
              <Package size={14} aria-hidden="true" /> Limited drops
            </p>
            <h1>Drops</h1>
            <p className="drops-lede">
              Time-limited product drops with social reservations — no checkout.
            </p>
          </div>
        </header>

        <nav className="drop-filters" aria-label="Drop filters" role="tablist">
          {FILTERS.map(item => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "active" : ""}
                onClick={() => setFilter(item.id)}
              >
                {item.id === "mine" ? (
                  <Users size={14} aria-hidden="true" />
                ) : null}
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="drop-search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search drops…"
            aria-label="Search drops by title"
          />
        </div>

        <div className="drop-quick-chips" aria-label="Quick filters">
          {QUICK_FILTERS.map(item => {
            const active = quickFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                className={active ? "active" : ""}
                onClick={() => setQuickFilter(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {heroDrop != null && heroCountdown != null ? (
          <button
            type="button"
            className="drop-hero"
            onClick={() => openDrop(heroDrop.id)}
            aria-label={`Featured live drop: ${heroDrop.title}, ${heroCountdown.label} ${heroCountdown.remaining}`}
          >
            <span className="drop-hero-badge">
              <span className="drop-chip-dot" aria-hidden="true" />
              Live drop
            </span>
            <span className="drop-hero-title">{heroDrop.title}</span>
            <span className="drop-hero-countdown">
              <Clock3 size={14} aria-hidden="true" />
              {heroCountdown.label} {heroCountdown.remaining}
            </span>
            <span className="drop-hero-cta">Shop now</span>
          </button>
        ) : null}

        <section
          className="drop-results"
          aria-live="polite"
          aria-busy={isLoading || undefined}
        >
          {isLoading ? (
            <div className="drop-grid" aria-label="Loading drops">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="drop-card drop-card--skeleton" key={index}>
                  <Skeleton className="drop-skeleton-cover" />
                  <div className="drop-card-body">
                    <Skeleton className="drop-skeleton-line w-1/3" />
                    <Skeleton className="drop-skeleton-line w-3/4" />
                    <Skeleton className="drop-skeleton-line w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : unauthorized ? (
            <DropsState
              icon={<Users size={24} />}
              title="Sign in to view your drops."
              body="Mine shows drops you sell. Sign in to continue."
              action={
                auth.isAuthenticated ? null : (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => auth.openAuth()}
                  >
                    Sign in
                  </button>
                )
              }
            />
          ) : unavailable ? (
            <DropsState
              icon={<Package size={24} />}
              title="Drops are unavailable right now."
              body="This feature is currently disabled on the server."
            />
          ) : query.isError ? (
            <DropsState
              icon={<RefreshCw size={24} />}
              title="Could not load drops."
              body="Something went wrong while fetching the list. Try again."
              action={
                <button
                  type="button"
                  className="muted-btn"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </button>
              }
            />
          ) : visibleDrops.length === 0 ? (
            search.trim() || quickFilter !== "all" ? (
              <DropsState
                icon={<Search size={24} />}
                title="No drops match."
                body="Try a different search or quick filter."
                action={
                  <button
                    type="button"
                    className="muted-btn"
                    onClick={() => {
                      setSearch("");
                      setQuickFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <DropsState
                icon={<Package size={24} />}
                title={EMPTY_COPY[filter].title}
                body={EMPTY_COPY[filter].body}
              />
            )
          ) : (
            <div className="drop-grid">
              {visibleDrops.map(drop => (
                <DropCard
                  key={drop.id}
                  drop={drop}
                  nowMs={nowMs}
                  isSeller={
                    Boolean(auth.user?.id) && drop.sellerId === auth.user?.id
                  }
                  onOpen={() => openDrop(drop.id)}
                />
              ))}
            </div>
          )}
        </section>
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
