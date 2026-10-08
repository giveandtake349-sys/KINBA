import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useParams } from "wouter";
import { X, Clock, Megaphone, Users, Radio, Package, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { resolveMediaUrl, isAbsoluteHttpUrl } from "@/lib/runtimeConfig";
import { Caption } from "@/components/Caption";
import { HashtagText } from "@/components/HashtagText";
import { ShortsFeed } from "@/components/MediaHub";
import type { VideoRecord } from "@/components/MediaHub";
import "./hashtagPage.css";

// Local formatting helpers (mirror MediaHub to avoid shared utils refactor)
function formatCount(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function relativeTime(value: Date | string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
}

function displayName(
  name: string | null | undefined,
  username?: string | null,
  fallback = "JHILIK member"
): string {
  const cleanName = name?.trim();
  if (cleanName && !cleanName.includes("@")) return cleanName;
  const cleanUsername = username?.trim();
  if (cleanUsername) return `@${cleanUsername}`;
  return fallback;
}

type HashtagContentItem = {
  type: "video" | "announcement" | "hype_room" | "hype_room_message" | "drop";
  id: number;
  title: string | null;
  body: string | null;
  createdAt: Date | string;
  authorId: number | null;
  authorName: string | null;
};

type HashtagInfo = {
  id: number;
  tag: string;
  displayTag: string;
  createdAt: Date;
} | null;

function HashtagSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="hashtag-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="hashtag-skeleton-item">
          <div className="hashtag-skeleton-avatar" />
          <div className="hashtag-skeleton-content">
            <div className="hashtag-skeleton-line long" />
            <div className="hashtag-skeleton-line medium" />
            <div className="hashtag-skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HashtagEmpty({ tag }: { tag: string }) {
  return (
    <div className="hashtag-empty">
      <div className="hashtag-empty-icon">
        <Radio size={32} />
      </div>
      <h3>No content for #{tag}</h3>
      <p>Be the first to post with this hashtag.</p>
    </div>
  );
}

function HashtagError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="hashtag-error">
      <div className="hashtag-error-icon">
        <X size={32} />
      </div>
      <h3>Could not load hashtag</h3>
      <p>Something went wrong while fetching the content.</p>
      <button type="button" className="primary-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

// Video Modal - uses existing ShortsFeed component for consistent video viewing
function VideoModal({
  video,
  onClose,
}: {
  video: HashtagContentItem | null;
  onClose: () => void;
}) {
  if (!video) return null;

  return (
    <div className="video-modal-overlay" onClick={onClose}>
      <div className="video-modal" onClick={e => e.stopPropagation()}>
        <ShortsFeed
          standaloneVideo={{
            id: video.id,
            title: video.title ?? "",
            description: video.body ?? "",
            videoUrl: "",
            thumbnailUrl: null,
            mediaType: "VIDEO",
            kind: "SHORT",
            durationSeconds: 0,
            width: 0,
            height: 0,
            sources: [],
            processingStatus: "READY",
            createdAt: video.createdAt,
            viewCount: 0,
            reactionCount: 0,
            commentCount: 0,
            shareCount: 0,
            viewerReacted: false,
            viewerReaction: null,
            viewerShared: false,
            bookmarkCount: 0,
            viewerBookmarked: false,
            owner: {
              id: video.authorId ?? 0,
              name: video.authorName ?? "Unknown",
              username: null,
              photoUrl: null,
              accountType: "member",
              isVerified: false,
            },
          }}
          initialVideoId={video.id}
          viewerMode={true}
          onBack={onClose}
        />
      </div>
    </div>
  );
}

// Announcement Detail Modal
function AnnouncementDetail({
  announcement,
  onClose,
}: {
  announcement: HashtagContentItem | null;
  onClose: () => void;
}) {
  if (!announcement) return null;

  return (
    <div className="announcement-modal-overlay" onClick={onClose}>
      <div className="announcement-modal" onClick={e => e.stopPropagation()}>
        <header className="announcement-modal-header">
          <h2>Announcement</h2>
          <button type="button" className="announcement-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="announcement-modal-body">
          {announcement.body && <HashtagText text={announcement.body} className="announcement-modal-body-text" />}
        </div>
        <footer className="announcement-modal-footer">
          <div className="announcement-modal-author">
            <strong>{announcement.authorName ?? "Unknown"}</strong>
            <span>{relativeTime(announcement.createdAt)}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ContentSection({
  title,
  icon,
  children,
  count,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  count: number;
}) {
  if (count === 0) return null;
  return (
    <section className="hashtag-content-section">
      <header className="hashtag-section-header">
        <div className="hashtag-section-title">
          {icon}
          <h3>{title}</h3>
          <span className="hashtag-section-count">{count}</span>
        </div>
      </header>
      <div className="hashtag-section-content">
        {children}
      </div>
    </section>
  );
}

function VideoItem({
  item,
  onOpen,
}: {
  item: HashtagContentItem;
  onOpen: (video: HashtagContentItem) => void;
}) {
  return (
    <article className="hashtag-item hashtag-item--video" data-id={item.id}>
      <div className="hashtag-item-header">
        <div className="hashtag-item-avatar">
          <div className="hashtag-item-avatar-placeholder">
            <Users size={16} />
          </div>
        </div>
        <div className="hashtag-item-meta">
          <div className="hashtag-item-author">
            <strong>{item.authorName ?? "Unknown"}</strong>
            <span>{relativeTime(item.createdAt)}</span>
          </div>
          <div className="hashtag-item-type">Video</div>
        </div>
      </div>
      <div className="hashtag-item-body">
        {item.title && <h4 className="hashtag-item-title">{item.title}</h4>}
        {item.body && <HashtagText text={item.body} className="hashtag-item-caption" />}
      </div>
      <button
        type="button"
        className="hashtag-item-action"
        onClick={() => onOpen(item)}
        aria-label="View video"
      >
        View
      </button>
    </article>
  );
}

function AnnouncementItem({
  item,
  onOpen,
}: {
  item: HashtagContentItem;
  onOpen: (announcement: HashtagContentItem) => void;
}) {
  return (
    <article className="hashtag-item hashtag-item--announcement" data-id={item.id}>
      <div className="hashtag-item-header">
        <div className="hashtag-item-avatar">
          <div className="hashtag-item-avatar-placeholder">
            <Megaphone size={16} />
          </div>
        </div>
        <div className="hashtag-item-meta">
          <div className="hashtag-item-author">
            <strong>{item.authorName ?? "Unknown"}</strong>
            <span>{relativeTime(item.createdAt)}</span>
          </div>
          <div className="hashtag-item-type">Announcement</div>
        </div>
      </div>
      <div className="hashtag-item-body">
        {item.body && <HashtagText text={item.body} className="hashtag-item-caption" />}
      </div>
      <button
        type="button"
        className="hashtag-item-action"
        onClick={() => onOpen(item)}
        aria-label="View announcement"
      >
        View
      </button>
    </article>
  );
}

function HypeRoomItem({
  item,
}: {
  item: HashtagContentItem;
}) {
  return (
    <article className="hashtag-item hashtag-item--hype-room" data-id={item.id}>
      <div className="hashtag-item-header">
        <div className="hashtag-item-avatar">
          <div className="hashtag-item-avatar-placeholder">
            <Radio size={16} />
          </div>
        </div>
        <div className="hashtag-item-meta">
          <div className="hashtag-item-author">
            <strong>{item.title ?? "Untitled Room"}</strong>
            <span>by {item.authorName ?? "Unknown"} · {relativeTime(item.createdAt)}</span>
          </div>
          <div className="hashtag-item-type">Hype Room</div>
        </div>
      </div>
      <div className="hashtag-item-body">
        {item.body && <HashtagText text={item.body} className="hashtag-item-caption" />}
      </div>
      <button
        type="button"
        className="hashtag-item-action"
        onClick={() => window.location.href = `/rooms/${item.id}`}
        aria-label="View room"
      >
        View room
      </button>
    </article>
  );
}

function HypeRoomMessageItem({
  item,
}: {
  item: HashtagContentItem;
}) {
  return (
    <article className="hashtag-item hashtag-item--hype-room-message" data-id={item.id}>
      <div className="hashtag-item-header">
        <div className="hashtag-item-avatar">
          <div className="hashtag-item-avatar-placeholder">
            <MessageCircle size={16} />
          </div>
        </div>
        <div className="hashtag-item-meta">
          <div className="hashtag-item-author">
            <strong>{item.authorName ?? "Unknown"}</strong>
            <span>{relativeTime(item.createdAt)}</span>
          </div>
          <div className="hashtag-item-type">Room message</div>
        </div>
      </div>
      <div className="hashtag-item-body">
        {item.body && <HashtagText text={item.body} className="hashtag-item-caption" />}
      </div>
      <button
        type="button"
        className="hashtag-item-action"
        onClick={() => window.location.href = `/rooms/${item.id}?msg=${item.id}`}
        aria-label="View message in room"
      >
        View message
      </button>
    </article>
  );
}

function DropItem({
  item,
}: {
  item: HashtagContentItem;
}) {
  return (
    <article className="hashtag-item hashtag-item--drop" data-id={item.id}>
      <div className="hashtag-item-header">
        <div className="hashtag-item-avatar">
          <div className="hashtag-item-avatar-placeholder">
            <Package size={16} />
          </div>
        </div>
        <div className="hashtag-item-meta">
          <div className="hashtag-item-author">
            <strong>{item.title ?? "Untitled Drop"}</strong>
            <span>by {item.authorName ?? "Unknown"} · {relativeTime(item.createdAt)}</span>
          </div>
          <div className="hashtag-item-type">Drop</div>
        </div>
      </div>
      <div className="hashtag-item-body">
        {item.body && <HashtagText text={item.body} className="hashtag-item-caption" />}
      </div>
      <button
        type="button"
        className="hashtag-item-action"
        onClick={() => window.location.href = `/drops/${item.id}`}
        aria-label="View drop"
      >
        View drop
      </button>
    </article>
  );
}

export default function HashtagPage() {
  const [, navigate] = useLocation();
  const params = useParams();
  const tagParam = params?.tag ?? "";
  const normalizedTag = tagParam.toLowerCase();

  const [selectedVideo, setSelectedVideo] = useState<HashtagContentItem | null>(null);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<HashtagContentItem | null>(null);

  const tagQuery = trpc.hashtag.byTag.useQuery(
    { tag: normalizedTag },
    {
      enabled: !!normalizedTag,
      retry: false,
      staleTime: 30_000,
    }
  );

  const contentQuery = trpc.hashtag.content.useQuery(
    { tag: normalizedTag, limit: 50 },
    {
      enabled: !!normalizedTag && tagQuery.data != null,
      retry: false,
      staleTime: 15_000,
    }
  );

  const tagInfo = tagQuery.data;
  const content = contentQuery.data ?? [];

  const grouped = useMemo(() => {
    const groups: Record<string, HashtagContentItem[]> = {
      video: [],
      announcement: [],
      hype_room: [],
      hype_room_message: [],
      drop: [],
    };
    for (const item of content) {
      groups[item.type].push(item);
    }
    return groups;
  }, [content]);

  const videoCount = grouped.video.length;
  const announcementCount = grouped.announcement.length;
  const hypeRoomCount = grouped.hype_room.length;
  const hypeRoomMessageCount = grouped.hype_room_message.length;
  const dropCount = grouped.drop.length;
  const totalCount = content.length;

  const isLoading = tagQuery.isPending || contentQuery.isPending;
  const isError = tagQuery.isError || contentQuery.isError;
  const notFound = tagQuery.isSuccess && tagQuery.data == null;

  const handleBack = () => navigate("/");

  const handleVideoOpen = (video: HashtagContentItem) => {
    setSelectedVideo(video);
  };

  const handleVideoClose = () => {
    setSelectedVideo(null);
  };

  const handleAnnouncementOpen = (announcement: HashtagContentItem) => {
    setSelectedAnnouncement(announcement);
  };

  const handleAnnouncementClose = () => {
    setSelectedAnnouncement(null);
  };

  if (!normalizedTag) {
    return (
      <div className="hashtag-page">
        <header className="hashtag-page-header">
          <button type="button" className="hashtag-back-btn" onClick={handleBack} aria-label="Back">
            <X size={20} />
          </button>
          <h1>Hashtag not found</h1>
        </header>
        <main className="hashtag-page-main">
          <HashtagEmpty tag="" />
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="hashtag-page">
        <header className="hashtag-page-header">
          <button type="button" className="hashtag-back-btn" onClick={handleBack} aria-label="Back">
            <X size={20} />
          </button>
          <div className="hashtag-title" data-testid="hashtag-title">
            <span className="hashtag-prefix">#</span>
            <span className="hashtag-display">{tagParam}</span>
          </div>
        </header>
        <main className="hashtag-page-main">
          <HashtagEmpty tag={tagParam} />
        </main>
      </div>
    );
  }

  if (isLoading && totalCount === 0) {
    return (
      <div className="hashtag-page">
        <header className="hashtag-page-header">
          <button type="button" className="hashtag-back-btn" onClick={handleBack} aria-label="Back">
            <X size={20} />
          </button>
          <div className="hashtag-title" data-testid="hashtag-title">
            <span className="hashtag-prefix">#</span>
            <span className="hashtag-display">{tagInfo?.displayTag ?? tagParam}</span>
          </div>
        </header>
        <main className="hashtag-page-main">
          <HashtagSkeleton count={5} />
        </main>
      </div>
    );
  }

  if (isError && totalCount === 0) {
    return (
      <div className="hashtag-page">
        <header className="hashtag-page-header">
          <button type="button" className="hashtag-back-btn" onClick={handleBack} aria-label="Back">
            <X size={20} />
          </button>
          <div className="hashtag-title" data-testid="hashtag-title">
            <span className="hashtag-prefix">#</span>
            <span className="hashtag-display">{tagInfo?.displayTag ?? tagParam}</span>
          </div>
        </header>
        <main className="hashtag-page-main">
          <HashtagError onRetry={() => { tagQuery.refetch(); contentQuery.refetch(); }} />
        </main>
      </div>
    );
  }

  const displayTag = tagInfo?.displayTag ?? tagParam;

  return (
    <div className="hashtag-page">
      <header className="hashtag-page-header">
        <button type="button" className="hashtag-back-btn" onClick={handleBack} aria-label="Back">
          <X size={20} />
        </button>
        <div className="hashtag-title" data-testid="hashtag-title">
          <span className="hashtag-prefix">#</span>
          <span className="hashtag-display">{displayTag}</span>
        </div>
        {totalCount > 0 && (
          <div className="hashtag-total-count">{totalCount} post{totalCount !== 1 ? "s" : ""}</div>
        )}
      </header>
      <main className="hashtag-page-main">
        {totalCount === 0 ? (
          <HashtagEmpty tag={displayTag} />
        ) : (
          <>
            <ContentSection
              title="Videos"
              icon={<Users size={18} />}
              count={videoCount}
            >
              {grouped.video.map(item => (
                <VideoItem key={`video-${item.id}`} item={item} onOpen={handleVideoOpen} />
              ))}
            </ContentSection>

            <ContentSection
              title="Announcements"
              icon={<Megaphone size={18} />}
              count={announcementCount}
            >
              {grouped.announcement.map(item => (
                <AnnouncementItem key={`announcement-${item.id}`} item={item} onOpen={handleAnnouncementOpen} />
              ))}
            </ContentSection>

            <ContentSection
              title="Hype Rooms"
              icon={<Radio size={18} />}
              count={hypeRoomCount}
            >
              {grouped.hype_room.map(item => (
                <HypeRoomItem key={`hype-room-${item.id}`} item={item} />
              ))}
            </ContentSection>

            <ContentSection
              title="Room Messages"
              icon={<MessageCircle size={18} />}
              count={hypeRoomMessageCount}
            >
              {grouped.hype_room_message.map(item => (
                <HypeRoomMessageItem key={`hype-room-message-${item.id}`} item={item} />
              ))}
            </ContentSection>

            <ContentSection
              title="Drops"
              icon={<Package size={18} />}
              count={dropCount}
            >
              {grouped.drop.map(item => (
                <DropItem key={`drop-${item.id}`} item={item} />
              ))}
            </ContentSection>
          </>
        )}
      </main>
      {selectedVideo && <VideoModal video={selectedVideo} onClose={handleVideoClose} />}
      {selectedAnnouncement && <AnnouncementDetail announcement={selectedAnnouncement} onClose={handleAnnouncementClose} />}
    </div>
  );
}