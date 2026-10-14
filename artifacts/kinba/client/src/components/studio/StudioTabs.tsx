import {
  BarChart3,
  ChevronRight,
  Clapperboard,
  Eye,
  Film,
  Heart,
  ImagePlus,
  MessageCircle,
  PenLine,
  Share2,
  Video,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { VideoRecord } from "@/components/MediaHub";

export type StudioCreateAction = "video" | "photo" | "text" | "short";

export type StudioStats = {
  followersCount?: number | null;
  reactionsReceived?: number | null;
  iconsCount?: number | null;
};

/** Create tab — quick-action cards into each composer, plus a stats row. */
export function StudioCreateTab({
  stats,
  onAction,
}: {
  stats?: StudioStats | null;
  onAction: (action: StudioCreateAction) => void;
}) {
  const actions: Array<{
    id: StudioCreateAction;
    icon: typeof Video;
    title: string;
    desc: string;
  }> = [
    {
      id: "video",
      icon: Video,
      title: "Upload video",
      desc: "Share a video with your audience",
    },
    {
      id: "photo",
      icon: ImagePlus,
      title: "Post photo",
      desc: "Share photos, up to 20 per post",
    },
    {
      id: "text",
      icon: PenLine,
      title: "Write post",
      desc: "Share your thoughts as text",
    },
    {
      id: "short",
      icon: Clapperboard,
      title: "Record short",
      desc: "Quick vertical clip, up to 1 min",
    },
  ];
  return (
    <div className="studio-create">
      <div className="studio-stat-grid">
        <div>
          <strong>{stats?.followersCount ?? 0}</strong>
          <span>Followers</span>
        </div>
        <div>
          <strong>{stats?.reactionsReceived ?? 0}</strong>
          <span>Pookies</span>
        </div>
        <div>
          <strong>{stats?.iconsCount ?? 0}</strong>
          <span>ICONS</span>
        </div>
      </div>
      <div className="studio-actions" role="list" aria-label="Create something new">
        {actions.map(a => {
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              role="listitem"
              className="studio-action-card"
              onClick={() => onAction(a.id)}
            >
              <span className="studio-action-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <span className="studio-action-text">
                <b>{a.title}</b>
                <span>{a.desc}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Own published content — FB Creator Studio-style cards. Every account type. */
export function StudioContentTab({
  onViewAnalytics,
}: {
  onViewAnalytics: () => void;
}) {
  const videos = trpc.profile.videos.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows = videos.data ?? [];
  if (videos.isLoading) {
    return <p className="profile-loading-note">Loading your content…</p>;
  }
  if (videos.isError) {
    return (
      <div className="an-empty" role="alert">
        <Film size={28} aria-hidden="true" />
        <p>
          <strong>Couldn't load your content.</strong>
          <br />
          Check your connection and try again.
        </p>
        <button
          type="button"
          className="an-retry-btn"
          onClick={() => void videos.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="an-empty" role="status">
        <Film size={28} aria-hidden="true" />
        <p>
          <strong>No content yet.</strong>
          <br />
          Publish your first video, photo, or post to see it here.
        </p>
      </div>
    );
  }
  return (
    <div className="studio-content-list" role="list" aria-label="Your published content">
      {rows.map(v => (
        <StudioContentRow key={v.id} video={v} onViewAnalytics={onViewAnalytics} />
      ))}
    </div>
  );
}

const CONTENT_TYPE_META = {
  VIDEO: { label: "Video", icon: Video },
  IMAGE: { label: "Photo", icon: ImagePlus },
  TEXT: { label: "Text", icon: PenLine },
} as const;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function formatStudioDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function StudioContentRow({
  video,
  onViewAnalytics,
}: {
  video: VideoRecord;
  onViewAnalytics: () => void;
}) {
  const meta = CONTENT_TYPE_META[video.mediaType] ?? CONTENT_TYPE_META.VIDEO;
  const TypeIcon = meta.icon;
  const thumb = video.thumbnailUrl ?? video.gallery?.[0]?.url ?? null;
  const title =
    video.title?.trim() ||
    video.description?.trim().slice(0, 60) ||
    `Post #${video.id}`;
  return (
    <div className="studio-content-row" role="listitem">
      <div className="studio-content-thumb" aria-hidden="true">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : (
          <span className="studio-content-thumb-fallback">
            <TypeIcon size={22} />
          </span>
        )}
        {video.mediaType === "VIDEO" && video.durationSeconds > 0 ? (
          <span className="studio-content-duration">
            {Math.floor(video.durationSeconds / 60)}:
            {String(Math.floor(video.durationSeconds % 60)).padStart(2, "0")}
          </span>
        ) : null}
      </div>
      <div className="studio-content-main">
        <div className="studio-content-title">{title}</div>
        <div className="studio-content-meta">
          <span className="studio-content-type">
            <TypeIcon size={12} aria-hidden="true" />
            {meta.label}
          </span>
          <span>{formatStudioDate(video.createdAt)}</span>
        </div>
        <div className="studio-content-stats">
          <span>
            <Eye size={13} aria-hidden="true" />
            {formatCount(video.viewCount ?? 0)}
          </span>
          <span>
            <Heart size={13} aria-hidden="true" />
            {formatCount(video.reactionCount ?? 0)}
          </span>
          <span>
            <MessageCircle size={13} aria-hidden="true" />
            {formatCount(video.commentCount ?? 0)}
          </span>
          <span>
            <Share2 size={13} aria-hidden="true" />
            {formatCount(video.shareCount ?? 0)}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="studio-content-analytics"
        onClick={onViewAnalytics}
        aria-label={`View analytics for ${title}`}
      >
        <BarChart3 size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
