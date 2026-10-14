import type { CSSProperties } from "react";
import {
  BarChart3,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Share2,
  Type as TypeIcon,
  Video as VideoIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

/** Compact number formatting for dashboard KPIs (1.2K, 3.4M). */
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function formatPct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

const TYPE_META = {
  VIDEO: { label: "Videos", icon: VideoIcon },
  IMAGE: { label: "Photos", icon: ImageIcon },
  TEXT: { label: "Text posts", icon: TypeIcon },
} as const;

/**
 * Content analytics — own content only (views, reach, engagement).
 * Shared by the creator portal (/campaigns → Analytics) and JHILIK Studio.
 * Works for EVERY account type: the query only ever returns the viewer's
 * own content stats.
 * Confirmed "number 2" engagement-preview visual language: KPI cards,
 * engagement HERO (dark card with bars), FB Creator Studio-style tables,
 * gridline chart with day labels. Every number comes from the real DB —
 * thin data renders an honest empty state, never invented figures.
 */
export function ContentAnalytics() {
  const stats = trpc.analytics.creatorDashboard.useQuery(undefined, {
    refetchOnWindowFocus: false,
    // The dashboard does a bulk rollup server-side; give it room on slow
    // networks before React Query treats it as failed.
    retry: 1,
  });
  const data = stats.data;

  if (stats.isLoading) {
    return <p className="profile-loading-note">Loading analytics…</p>;
  }
  // FIX (2026-10-14): previously a failed/hung query left the tab on the
  // spinner forever with no way out. Show an honest error + retry.
  if (stats.isError) {
    return (
      <div className="an-empty" role="alert">
        <BarChart3 size={28} aria-hidden="true" />
        <p>
          <strong>Couldn't load analytics.</strong>
          <br />
          Check your connection and try again.
        </p>
        <button
          type="button"
          className="an-retry-btn"
          onClick={() => void stats.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!data || !data.hasData) {
    return (
      <div className="an-empty" role="status">
        <BarChart3 size={28} aria-hidden="true" />
        <p>
          <strong>Not enough data yet.</strong>
          <br />
          Views and impressions are tracked from real activity — check back
          after your content gets seen.
        </p>
      </div>
    );
  }

  const { totals, byType, series, topVideos } = data;
  const engMax = Math.max(1, totals.reactions, totals.comments, totals.shares);
  const chartMax = Math.max(1, ...series.map(p => p.views));
  const dayLetter = (day: string) =>
    "SMTWTFS"[new Date(`${day}T12:00:00Z`).getUTCDay()];

  return (
    <div className="an-wrap">
      <div className="an-head">
        <h3>
          <BarChart3 size={18} aria-hidden="true" /> Analytics
        </h3>
        <span className="an-live">Live</span>
      </div>

      <div className="an-kpis">
        <div className="an-kpi">
          <b>{formatCompact(totals.views)}</b>
          <span>Views</span>
        </div>
        <div className="an-kpi">
          <b>{formatCompact(totals.reach)}</b>
          <span>Reach</span>
        </div>
        <div className="an-kpi">
          <b>{formatCompact(totals.impressions)}</b>
          <span>Impressions</span>
        </div>
      </div>

      {/* ENGAGEMENT HERO — dark card, unmissable */}
      <div className="an-eng">
        <div className="an-eng-head">
          <b>Engagement</b>
          <span className="an-eng-rate">
            {formatPct(totals.engagementRate)}
            <i>eng. rate</i>
          </span>
        </div>
        <div className="an-eng-grid">
          <div className="an-eng-row">
            <b>{formatCompact(totals.reactions)}</b>
            <span>
              <Heart size={13} aria-hidden="true" /> Reactions
            </span>
            <div className="an-bar">
              <div
                style={{ width: `${(totals.reactions / engMax) * 100}%` }}
              />
            </div>
          </div>
          <div className="an-eng-row">
            <b>{formatCompact(totals.comments)}</b>
            <span>
              <MessageCircle size={13} aria-hidden="true" /> Comments
            </span>
            <div className="an-bar">
              <div
                style={{ width: `${(totals.comments / engMax) * 100}%` }}
              />
            </div>
          </div>
          <div className="an-eng-row">
            <b>{formatCompact(totals.shares)}</b>
            <span>
              <Share2 size={13} aria-hidden="true" /> Shares
            </span>
            <div className="an-bar">
              <div style={{ width: `${(totals.shares / engMax) * 100}%` }} />
            </div>
          </div>
        </div>
        <div className="an-formula">
          (reactions + comments + shares) ÷ reach · Facebook formula
        </div>
      </div>

      {/* PERFORMANCE TABLE — FB Creator Studio style */}
      {topVideos.length > 0 ? (
        <div className="an-card">
          <b>Performance</b>
          <div className="an-table" role="table" aria-label="Top content performance">
            <div className="an-thead" role="row">
              <span>Post</span>
              <span>Views</span>
              <span>Eng.</span>
              <span>Rate</span>
            </div>
            {topVideos.map(video => {
              const Icon = video.contentType
                ? TYPE_META[video.contentType].icon
                : VideoIcon;
              return (
                <div className="an-trow" role="row" key={video.videoId}>
                  <span className="an-post">
                    <Icon size={15} aria-hidden="true" />
                    <span>{video.title}</span>
                  </span>
                  <span>{formatCompact(video.views)}</span>
                  <span>{formatCompact(video.engagements)}</span>
                  <b>{formatPct(video.engagementRate)}</b>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* BY CONTENT TYPE */}
      <div className="an-card">
        <b>By content type</b>
        <div
          className="an-table"
          role="table"
          aria-label="Performance by content type"
        >
          <div className="an-thead" role="row">
            <span>Type</span>
            <span>Views</span>
            <span>Eng.</span>
            <span>Rate</span>
          </div>
          {(Object.keys(TYPE_META) as Array<keyof typeof TYPE_META>).map(
            key => {
              const meta = TYPE_META[key];
              const Icon = meta.icon;
              const row = byType[key];
              // Facebook formula, computed from real DB numbers.
              const rate =
                row.reach > 0
                  ? +((row.engagements / row.reach) * 100).toFixed(1)
                  : null;
              return (
                <div className="an-trow" role="row" key={key}>
                  <span className="an-post">
                    <Icon size={15} aria-hidden="true" />
                    <span>{meta.label}</span>
                  </span>
                  <span>{formatCompact(row.views)}</span>
                  <span>{formatCompact(row.engagements)}</span>
                  <b>{formatPct(rate)}</b>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* 7-DAY CHART — gridlines + day labels */}
      <div className="an-card">
        <b>Last 7 days</b>
        <div className="an-chart">
          <div className="an-grid" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div
            className="an-bars"
            role="img"
            aria-label="Views per day, last 7 days"
          >
            {series.map(point => (
              <div
                key={point.day}
                style={{ "--v": `${(point.views / chartMax) * 100}%` } as CSSProperties}
              >
                <em />
              </div>
            ))}
          </div>
        </div>
        <div className="an-xlabels" aria-hidden="true">
          {series.map(point => (
            <span key={point.day}>{dayLetter(point.day)}</span>
          ))}
        </div>
      </div>

      <p className="an-fine">
        Real database numbers — deduplicated, bot-filtered, self-views excluded.
      </p>
    </div>
  );
}
