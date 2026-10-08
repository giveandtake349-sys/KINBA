import { VideoRecord } from "@/components/MediaHub";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  BadgeCheck,
  ArrowLeft,
  Bookmark,
  Flag,
  MoreHorizontal,
  Play,
  Share2,
  UserRound,
  Video,
  Image as ImageIcon,
  Film,
  Loader2,
  Pencil,
  X,
  Link as LinkIcon,
  MessageSquare,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { uploadImage } from "@/lib/mediaUpload";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import { isReducedMotion } from "@/contexts/motionPreference";
import AvatarCropModal from "./AvatarCropModal";
import FollowListModal, { type FollowListMode } from "./FollowListModal";
import { ReportDialog } from "./ReportDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import "./profileRedesign.css";

export type ProfileSnapshot = {
  user?: {
    id: number;
    name: string | null;
    createdAt?: string | Date | null;
  } | null;
  profile?: {
    username?: string | null;
    photoUrl?: string | null;
    isVerified?: boolean;
    verificationStatus?: string | null;
    accountType?: "member" | "creator" | "company";
    about?: string | null;
    displayName?: string | null;
    birthday?: string | null;
  } | null;
  stats?: {
    reactionsReceived: number;
    iconsCount: number;
    followingCount: number;
    followersCount: number;
  };
};

type ProfileTab = "posts" | "videos" | "shorts" | "saved";

/** Every tab, in strip order. "Saved" only renders for the profile owner. */
const TAB_META: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "videos", label: "Videos" },
  { id: "shorts", label: "Shorts" },
  { id: "saved", label: "Saved" },
];

const EMPTY_COPY: Record<ProfileTab, { title: string; owner: string; guest: string }> = {
  posts: {
    title: "No posts yet",
    owner: "Share your first post with the community.",
    guest: "No posts to show yet.",
  },
  videos: {
    title: "No videos yet",
    owner: "Share your first video with the community.",
    guest: "No videos to show yet.",
  },
  shorts: {
    title: "No shorts yet",
    owner: "Post your first short with the community.",
    guest: "No shorts to show yet.",
  },
  saved: {
    title: "Nothing saved yet",
    owner: "Videos you save will show up here.",
    guest: "Nothing saved yet.",
  },
};

const VERIFIED_STATUSES = new Set(["verified", "business_verified", "official"]);

function profileDisplayName(profile?: ProfileSnapshot): string {
  const displayName = profile?.profile?.displayName?.trim();
  if (displayName) return displayName;
  const name = profile?.user?.name?.trim();
  if (name && !name.includes("@")) return name;
  const username = profile?.profile?.username?.trim();
  return username ? `@${username}` : "JHILIK member";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type TileVariant = "post" | "text" | "video" | "short";

/** How one record is presented: photos and text are posts, video splits by kind. */
function tileVariant(video: VideoRecord): TileVariant {
  if (video.mediaType === "TEXT") return "text";
  if (video.mediaType === "IMAGE") return "post";
  return video.kind === "SHORT" ? "short" : "video";
}

/**
 * The geometry of a tile. Real width/height wins so a portrait photo stays
 * portrait and a 4:3 video is never cropped into a 16:9 box; video without
 * stored dimensions falls back to the ratio its kind implies, and media with
 * no reliable dimensions sizes itself instead of guessing.
 */
function tileAspectRatio(video: VideoRecord): string | null {
  const variant = tileVariant(video);
  if (variant === "text") return null;
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  if (width > 0 && height > 0) return `${width} / ${height}`;
  if (variant === "short") return "9 / 16";
  if (variant === "video") return "16 / 9";
  return null;
}

/**
 * Server listings already filter to READY, but a row that is still encoding
 * must never reach a playable shelf, so keep the guard next to the presentation.
 */
function isPlayable(video: VideoRecord): boolean {
  if (video.mediaType !== "VIDEO") return true;
  const status = video.processingStatus;
  return !status || status === "READY";
}

function formatDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${total}s`;
}

/** Compact "3:24 · 2.4K views" line used under and over profile media. */
function tileStatLine(video: VideoRecord, variant: TileVariant): string {
  const parts: string[] = [];
  if (variant === "video" || variant === "short") {
    const duration = formatDuration(video.durationSeconds);
    if (duration) parts.push(duration);
  }
  parts.push(`${formatCount(video.viewCount)} views`);
  return parts.join(" · ");
}

function formatJoinedLabel(value?: string | Date | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Honour both the in-app motion toggle and the OS-level reduced motion setting. */
function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return isReducedMotion() || systemReduced ? "auto" : "smooth";
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`pr-skeleton ${className}`} />;
}

export function ProfileSkeleton() {
  return (
    <div className="pr-page" aria-busy={true}>
      <div className="pr-header">
        <div className="pr-identity">
          <div className="pr-avatar pr-avatar--hero pr-skeleton pr-skeleton-avatar" />
          <div className="pr-header-info">
            <div className="pr-skeleton pr-skeleton-name" />
            <div className="pr-skeleton pr-skeleton-handle" />
          </div>
        </div>
        <div className="pr-skeleton pr-skeleton-meta" />
        <div className="pr-skeleton pr-skeleton-about" />
        <div className="pr-stats">
          <div className="pr-stat">
            <div className="pr-skeleton pr-skeleton-stat-value" />
            <div className="pr-skeleton pr-skeleton-stat-label" />
          </div>
          <div className="pr-stat">
            <div className="pr-skeleton pr-skeleton-stat-value" />
            <div className="pr-skeleton pr-skeleton-stat-label" />
          </div>
          <div className="pr-stat">
            <div className="pr-skeleton pr-skeleton-stat-value" />
            <div className="pr-skeleton pr-skeleton-stat-label" />
          </div>
          <div className="pr-stat">
            <div className="pr-skeleton pr-skeleton-stat-value" />
            <div className="pr-skeleton pr-skeleton-stat-label" />
          </div>
        </div>
        <div className="pr-skeleton pr-skeleton-actions" />
      </div>
      <div className="pr-content">
        <div className="pr-tabs pr-skeleton-tabs">
          <div className="pr-skeleton pr-skeleton-tab" />
          <div className="pr-skeleton pr-skeleton-tab" />
          <div className="pr-skeleton pr-skeleton-tab" />
        </div>
        <div className="pr-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="pr-skeleton pr-skeleton-tile" key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageComposeModal({
  recipientId,
  recipientName,
  recipientPhotoUrl,
  open,
  onClose,
  onSent,
}: {
  recipientId: number;
  recipientName: string;
  recipientPhotoUrl: string | null;
  open: boolean;
  onClose: () => void;
  onSent: (conversationId: number, status: "accepted" | "pending") => void;
}) {
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const sendRequestMut = trpc.directMessages.sendMessageRequest.useMutation({
    onSuccess: () => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
    },
  });

  const handleSend = async () => {
    const trimmed = messageText.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const result = await sendRequestMut.mutateAsync({
        recipientId,
        body: trimmed,
        idempotencyKey,
      });
      if (result.status !== "accepted") {
        onSent(0, "pending");
        onClose();
        return;
      }
      // Use conversationId returned by the server when available
      const conversationId = (result as { conversationId?: number }).conversationId ?? 0;
      onSent(conversationId, "accepted");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="pr-modal-overlay" role="dialog" aria-modal="true" aria-label="New message">
      <div className="pr-modal">
        <div className="pr-modal-header">
          <h2>New Message</h2>
          <button type="button" className="pr-modal-close" onClick={onClose} aria-label="Close" disabled={sending}>
            <X size={18} />
          </button>
        </div>
        <div className="pr-modal-body">
          <div className="pr-message-recipient">
            <div className="pr-avatar pr-avatar--small">
              {recipientPhotoUrl ? (
                <img src={recipientPhotoUrl} alt="" />
              ) : (
                <UserRound size={20} />
              )}
            </div>
            <span>{recipientName}</span>
          </div>
          <label className="pr-field">
            <span className="pr-field-label">Message</span>
            <textarea
              className="pr-input pr-textarea"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="Write your message..."
              disabled={sending}
            />
            <span className="pr-field-hint">{messageText.length}/4000</span>
          </label>
          {error && <p className="pr-message pr-message--error" role="alert">{error}</p>}
          <div className="pr-modal-actions">
            <button type="button" className="pr-btn pr-btn--ghost" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              type="button"
              className="pr-btn pr-btn--primary"
              onClick={handleSend}
              disabled={sending || !messageText.trim()}
            >
              {sending ? (
                <>
                  <Loader2 size={14} className="pr-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send size={14} />
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Exported so Settings › Account can reuse the exact same edit surface. */
export function ProfileEditModal({
  profile,
  open,
  onClose,
}: {
  profile?: ProfileSnapshot;
  open: boolean;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(profile?.profile?.username ?? "");
  const [displayName, setDisplayName] = useState(profile?.profile?.displayName ?? "");
  const [about, setAbout] = useState(profile?.profile?.about ?? "");
  const [birthday, setBirthday] = useState(profile?.profile?.birthday ? new Date(profile.profile.birthday).toISOString().split("T")[0] : "");
  const [photoUrl, setPhotoUrl] = useState(profile?.profile?.photoUrl ?? "");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [birthdayError, setBirthdayError] = useState("");
  const update = trpc.profile.update.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) {
      setUsername(profile?.profile?.username ?? "");
      setDisplayName(profile?.profile?.displayName ?? "");
      setAbout(profile?.profile?.about ?? "");
      setBirthday(profile?.profile?.birthday ? new Date(profile.profile.birthday).toISOString().split("T")[0] : "");
      setPhotoUrl(profile?.profile?.photoUrl ?? "");
      setMessage("");
      setBirthdayError("");
    }
  }, [open, profile?.profile?.username, profile?.profile?.displayName, profile?.profile?.about, profile?.profile?.birthday, profile?.profile?.photoUrl]);

  const chooseAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Image must be under 5 MB.");
      return;
    }
    setCropFile(file);
    setCropOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBirthdayError("");
    const nextUsername = username.trim() || null;
    const currentUsername = profile?.profile?.username?.trim() || null;
    const nextDisplayName = displayName.trim() || null;
    const currentDisplayName = profile?.profile?.displayName?.trim() || null;
    const nextPhotoUrl = photoUrl.trim() || null;
    const currentPhotoUrl = profile?.profile?.photoUrl || null;
    const nextAbout = about.trim() || null;
    const currentAbout = profile?.profile?.about?.trim() || null;
    const nextBirthday = birthday || null;
    const currentBirthday = profile?.profile?.birthday
      ? new Date(profile.profile.birthday).toISOString().split("T")[0]
      : null;
    const changes: {
      username?: string | null;
      displayName?: string | null;
      photoUrl?: string | null;
      about?: string | null;
      birthday?: string | null;
    } = {};
    if (nextUsername !== currentUsername) changes.username = nextUsername;
    if (nextDisplayName !== currentDisplayName) changes.displayName = nextDisplayName;
    if (nextPhotoUrl !== currentPhotoUrl) changes.photoUrl = nextPhotoUrl;
    if (nextAbout !== currentAbout) changes.about = nextAbout;
    if (nextBirthday !== currentBirthday) changes.birthday = nextBirthday;
    if (!Object.keys(changes).length) {
      setMessage("No changes to save.");
      return;
    }
    if (birthday) {
      const date = new Date(birthday);
      if (isNaN(date.getTime()) || date > new Date()) {
        setBirthdayError("Invalid date or birthday cannot be in the future.");
        return;
      }
    }
    try {
      await update.mutateAsync(changes);
      await Promise.all([
        utils.profile.me.invalidate(),
        utils.profile.byId.invalidate(),
      ]);
      setMessage("Profile updated.");
      setTimeout(onClose, 600);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update profile."
      );
    }
  };

  if (!open) return null;

  return (
    <div className="pr-modal-overlay" role="dialog" aria-modal="true" aria-label="Edit profile">
      <div className="pr-modal">
        <div className="pr-modal-header">
          <h2>Edit Profile</h2>
          <button type="button" className="pr-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form className="pr-modal-body" onSubmit={submit}>
          <div className="pr-edit-avatar-section">
            <div className="pr-avatar pr-avatar--large">
              {photoUrl ? (
                <img src={photoUrl} alt="Profile preview" />
              ) : (
                <UserRound size={32} />
              )}
            </div>
            <label className="pr-edit-avatar-btn">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={chooseAvatar}
                disabled={uploading}
                className="pr-hidden-input"
              />
              {uploading ? (
                <Loader2 size={14} className="pr-spin" />
              ) : (
                <Pencil size={14} />
              )}
              {uploading ? "Uploading…" : "Change photo"}
            </label>
          </div>
          <label className="pr-field">
            <span className="pr-field-label">Username</span>
            <input
              className="pr-input"
              value={username}
              onChange={event => setUsername(event.target.value)}
              minLength={3}
              maxLength={64}
              pattern="[A-Za-z0-9_]+"
              placeholder="jhilik_creator"
            />
          </label>
          <label className="pr-field">
            <span className="pr-field-label">Display name</span>
            <input
              className="pr-input"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              maxLength={64}
              placeholder="Your name"
            />
          </label>
          <label className="pr-field">
            <span className="pr-field-label">Birthday</span>
            <input
              type="date"
              className="pr-input"
              value={birthday}
              onChange={event => setBirthday(event.target.value)}
              max={new Date().toISOString().split("T")[0]}
            />
            {birthdayError && <p className="pr-field-hint" style={{ color: "var(--error)" }}>{birthdayError}</p>}
          </label>
          <label className="pr-field">
            <span className="pr-field-label">Bio</span>
            <textarea
              className="pr-input pr-textarea"
              value={about}
              onChange={event => setAbout(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Tell people about yourself…"
            />
            <span className="pr-field-hint">{about.length}/500</span>
          </label>
          {message && (
            <p className="pr-message" role="status">{message}</p>
          )}
          <div className="pr-modal-actions">
            <button type="button" className="pr-btn pr-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="pr-btn pr-btn--primary"
              disabled={update.isPending || uploading}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
      <AvatarCropModal
        file={cropFile}
        open={cropOpen}
        onClose={() => { setCropOpen(false); setCropFile(null); }}
        onSaved={url => { setPhotoUrl(url); setMessage("Profile photo updated."); setCropOpen(false); setCropFile(null); }}
      />
    </div>
  );
}

/**
 * One content cell. Presentation lives here so the profile content surface can
 * be restyled or extended without touching the header, stats, or tab wiring.
 *
 * Geometry comes from the record itself: photos keep their real ratio, Shorts
 * stay 9:16, and long videos keep the ratio they were published at.
 */
function ProfileTile({
  video,
  onOpenPhoto,
  onOpenShort,
  onOpenVideo,
}: {
  video: VideoRecord;
  onOpenPhoto?: (video: VideoRecord) => void;
  onOpenShort?: (videoId: number) => void;
  onOpenVideo?: (video: VideoRecord) => void;
}) {
  const variant = tileVariant(video);
  const aspectRatio = tileAspectRatio(video);
  const isMedia = variant !== "text";
  const hasOverlay = variant === "post" || variant === "short";
  const stat = isMedia ? tileStatLine(video, variant) : "";

  // A tile only advertises itself as actionable when it can actually open
  // something: text posts have no detail view, so they stay plain articles.
  const open =
    variant === "post" && onOpenPhoto
      ? () => onOpenPhoto(video)
      : variant === "short" && onOpenShort
        ? () => onOpenShort(video.id)
        : variant === "video" && onOpenVideo
          ? () => onOpenVideo(video)
          : null;
  const openLabel =
    variant === "post" ? "photo" : variant === "short" ? "short" : "video";

  const mediaSrc =
    variant === "post"
      ? resolveMediaUrl(video.videoUrl) ?? (video.videoUrl.trim() || undefined)
      : resolveMediaUrl(video.thumbnailUrl);
  const mediaAlt = video.title || (variant === "post" ? "Post" : "Video thumbnail");

  const media = isMedia ? (
    <div className="pr-tile-media" style={aspectRatio ? { aspectRatio } : undefined}>
      {mediaSrc ? (
        <img src={mediaSrc} className="pr-tile-img" alt={mediaAlt} loading="lazy" />
      ) : (
        <div className="pr-tile-fallback">
          {variant === "post" ? <ImageIcon size={20} /> : <Video size={20} />}
        </div>
      )}
      {(variant === "video" || variant === "short") && (
        <span className="pr-tile-play" aria-hidden="true">
          <Play size={14} />
        </span>
      )}
      {hasOverlay && (
        <div className="pr-tile-overlay">
          {video.title && <span className="pr-tile-title">{video.title}</span>}
          <span className="pr-tile-stat">{stat}</span>
        </div>
      )}
    </div>
  ) : (
    <div className="pr-tile-text">
      <span className="pr-tile-text-content">{video.title || video.description || ""}</span>
    </div>
  );

  const body =
    variant === "video" ? (
      <div className="pr-tile-body">
        {video.title && <span className="pr-tile-title">{video.title}</span>}
        <span className="pr-tile-stat">{stat}</span>
      </div>
    ) : null;

  const className = `pr-tile pr-tile--${variant}${open ? "" : " pr-tile--static"}`;
  const content = (
    <>
      {media}
      {body}
    </>
  );

  if (!open) return <article className={className}>{content}</article>;

  return (
    <article
      className={className}
      onClick={open}
      role="button"
      tabIndex={0}
      aria-label={
        video.title ? `Open ${openLabel}: ${video.title}` : `Open ${openLabel}`
      }
      onKeyDown={event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      }}
    >
      {content}
    </article>
  );
}

/** One shelf, one rhythm: masonry for mixed media, catalog grids for the rest. */
const GRID_CLASS: Record<ProfileTab, string> = {
  posts: "pr-grid--posts",
  videos: "pr-grid--videos",
  shorts: "pr-grid--shorts",
  saved: "pr-grid--saved",
};

/** Loading placeholder shaped like the shelf it stands in for. */
function ContentSkeleton({ tab }: { tab: ProfileTab }) {
  const shape =
    tab === "shorts" ? " pr-skeleton-tile--tall" : tab === "videos" ? " pr-skeleton-tile--wide" : "";
  const count = tab === "videos" ? 4 : 6;
  return (
    <div className={`pr-grid ${GRID_CLASS[tab]}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock className={`pr-skeleton-tile${shape}`} key={i} />
      ))}
    </div>
  );
}

export default function ProfileView({
  profile,
  isOwner,
  isAuthenticated,
  isAdmin,
  userId,
  onBack,
  ownerTools,
  onOpenVideo,
  onOpenPhoto,
  onOpenShort,
}: {
  profile?: ProfileSnapshot;
  isOwner: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  userId?: number;
  onBack: () => void;
  ownerTools?: React.ReactNode;
  onOpenVideo?: (video: VideoRecord) => void;
  onOpenPhoto?: (video: VideoRecord) => void;
  onOpenShort?: (videoId: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [followList, setFollowList] = useState<FollowListMode | null>(null);
  const [messageComposeOpen, setMessageComposeOpen] = useState(false);
  const [messageOpening, setMessageOpening] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabButtonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const isScrollingTabs = useRef(false);
  const isScrollingContent = useRef(false);

  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const followState = trpc.profile.followState.useQuery(
    { userId: userId as number },
    {
      enabled: isAuthenticated && !isOwner && Boolean(userId),
      refetchOnWindowFocus: false,
    }
  );
  const toggleFollow = trpc.profile.toggleFollow.useMutation({
    onSuccess: () => void followState.refetch(),
  });

  const videosQuery = trpc.profile.videos.useQuery(undefined, {
    enabled: isOwner,
    refetchOnWindowFocus: false,
  });
  const publicVideosQuery = trpc.profile.videosById.useQuery(
    { userId: userId as number },
    { enabled: Boolean(userId), refetchOnWindowFocus: false }
  );
  const bookmarkedVideosQuery = trpc.videos.bookmarked.useQuery(undefined, {
    enabled: isOwner,
    refetchOnWindowFocus: false,
  });

  // One source per shelf: the same query supplies the items, the loading
  // state, and the error state, so a tab can never show one while claiming
  // another. Saved is always the owner's own bookmark shelf.
  const shelfQuery = (tab: ProfileTab) =>
    tab === "saved"
      ? bookmarkedVideosQuery
      : userId
        ? publicVideosQuery
        : videosQuery;

  const allVideos = shelfQuery("posts").data ?? [];

  const posts = allVideos.filter(
    v => (v.mediaType === "IMAGE" || v.mediaType === "TEXT") && isPlayable(v)
  );
  const videos = allVideos.filter(
    v => v.mediaType === "VIDEO" && v.kind !== "SHORT" && isPlayable(v)
  );
  const shorts = allVideos.filter(
    v => v.mediaType === "VIDEO" && v.kind === "SHORT" && isPlayable(v)
  );
  const saved = ((isOwner ? bookmarkedVideosQuery.data : []) ?? []).filter(
    isPlayable
  );

  const itemsForTab = (tab: ProfileTab): VideoRecord[] =>
    tab === "posts"
      ? posts
      : tab === "videos"
        ? videos
        : tab === "shorts"
          ? shorts
          : saved;

  const loadingForTab = (tab: ProfileTab): boolean => shelfQuery(tab).isPending;
  const errorForTab = (tab: ProfileTab): boolean => shelfQuery(tab).isError;
  const retryForTab = (tab: ProfileTab): void => void shelfQuery(tab).refetch();

  // Saved is the owner's private shelf: visitors never see the tab, so the
  // strip never advertises content it cannot load for them.
  const tabs = TAB_META.filter(tab => tab.id !== "saved" || isOwner).map(tab => ({
    ...tab,
    count: itemsForTab(tab.id).length,
  }));
  const tabIds = tabs.map(tab => tab.id);
  const active: ProfileTab = tabIds.includes(activeTab) ? activeTab : tabIds[0];

  const displayName = profileDisplayName(profile);
  const handle = profile?.profile?.username
    ? `@${profile.profile.username}`
    : null;
  const stats = profile?.stats;
  const isFollowing = Boolean(followState.data?.following);
  const about = profile?.profile?.about?.trim() || null;
  const isVerified =
    Boolean(profile?.profile?.isVerified) ||
    VERIFIED_STATUSES.has(profile?.profile?.verificationStatus ?? "");
  const accountTypeLabel =
    profile?.profile?.accountType === "creator"
      ? "Creator"
      : profile?.profile?.accountType === "company"
        ? "Company"
        : null;
  const joinedLabel = formatJoinedLabel(profile?.user?.createdAt);

  const handleFollow = useCallback(() => {
    if (!userId) return;
    void toggleFollow.mutateAsync({ userId });
  }, [userId, toggleFollow]);

  const handleShare = useCallback(() => {
    const url = userId
      ? `${window.location.origin}/profile/${userId}`
      : `${window.location.origin}/profile`;
    if (navigator.share) {
      void navigator.share({ title: displayName, url });
    } else {
      void navigator.clipboard.writeText(url);
      toast.success("Profile link copied.");
    }
  }, [userId, displayName]);

  const handleMessageSent = useCallback(
    (conversationId: number, status: "accepted" | "pending") => {
      if (conversationId > 0) {
        navigate(`/messages/${conversationId}`);
      } else if (status === "accepted") {
        toast.success("Message sent");
      } else {
        toast.success("Message request sent");
      }
    },
    [navigate]
  );

  const handleMessageClick = useCallback(async () => {
    if (!userId) return;
    setMessageOpening(true);
    try {
      // Open an existing thread directly; the inbox only ever lists
      // conversations the server already authorized us to see.
      const conversations = await utils.directMessages.listConversations.fetch({
        limit: 50,
      });
      const existing = conversations.find(
        (conversation) => conversation.partner.id === userId
      );
      if (existing) {
        navigate(`/messages/${existing.id}`);
        return;
      }
      setMessageComposeOpen(true);
    } catch {
      // Inbox lookup failed: fall back to the server-authoritative flow,
      // which applies the follow/request rules for a brand-new thread.
      setMessageComposeOpen(true);
    } finally {
      setMessageOpening(false);
    }
  }, [userId, utils, navigate]);

  // Keep the id list readable from callbacks without re-creating them.
  const tabIdsRef = useRef<ProfileTab[]>(["posts", "videos", "shorts"]);
  useEffect(() => {
    tabIdsRef.current = tabIds;
  }, [tabIds]);

  const scrollToTab = useCallback((tab: ProfileTab, behavior: ScrollBehavior = scrollBehavior()) => {
    const index = tabIdsRef.current.indexOf(tab);
    if (index === -1 || !contentRef.current) return;
    isScrollingContent.current = true;
    contentRef.current.scrollTo({
      left: index * contentRef.current.clientWidth,
      behavior,
    });
    setActiveTab(tab);
    const button = tabButtonsRef.current[index];
    if (button) {
      isScrollingTabs.current = true;
      // block "nearest": the strip is pinned, so never drag the page itself.
      button.scrollIntoView({ behavior, block: "nearest", inline: "center" });
    }
    setTimeout(() => {
      isScrollingContent.current = false;
      isScrollingTabs.current = false;
    }, 350);
  }, []);

  useEffect(() => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const handleScroll = () => {
      if (isScrollingContent.current) return;
      const index = Math.round(container.scrollLeft / container.clientWidth);
      const ids = tabIdsRef.current;
      const clampedIndex = Math.max(0, Math.min(index, ids.length - 1));
      const newTab = ids[clampedIndex];
      if (newTab && newTab !== activeTab) {
        isScrollingTabs.current = true;
        setActiveTab(newTab);
        tabButtonsRef.current[clampedIndex]?.scrollIntoView({
          behavior: scrollBehavior(),
          block: "nearest",
          inline: "center",
        });
        setTimeout(() => { isScrollingTabs.current = false; }, 150);
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeTab]);

  // Re-align the panels when the active tab changes from a tap or a swipe.
  // The first run only records the initial tab: loading must never yank the
  // page down to the strip before the visitor has seen the profile header.
  const initialTabRef = useRef<ProfileTab | null>(null);
  useEffect(() => {
    if (initialTabRef.current === null) {
      initialTabRef.current = active;
      return;
    }
    if (initialTabRef.current !== active) {
      initialTabRef.current = active;
      if (!isScrollingTabs.current) scrollToTab(active, scrollBehavior());
    }
  }, [active, scrollToTab]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const ids = tabIdsRef.current;
    const position = ids.indexOf(active);
    const next = Math.max(
      0,
      Math.min(
        ids.length - 1,
        event.key === "ArrowLeft"
          ? position - 1
          : event.key === "ArrowRight"
            ? position + 1
            : event.key === "Home"
              ? 0
              : ids.length - 1
      )
    );
    scrollToTab(ids[next], scrollBehavior());
    tabButtonsRef.current[next]?.focus();
  };

  return (
    <div className="pr-page">
      <div className="pr-header">
        <div className="pr-identity">
          <button
            type="button"
            className="pr-back-btn"
            onClick={onBack}
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="pr-avatar pr-avatar--hero">
            {profile?.profile?.photoUrl ? (
              <img
                src={profile.profile.photoUrl}
                alt={`${displayName}'s avatar`}
              />
            ) : (
              <UserRound size={32} />
            )}
          </div>
          <div className="pr-header-info">
            <h1 className="pr-name">
              <span className="pr-name-text">{displayName}</span>
              {isVerified && (
                <BadgeCheck
                  className="pr-verified-badge"
                  size={18}
                  aria-label="Verified"
                />
              )}
            </h1>
            {handle && <span className="pr-handle">{handle}</span>}
          </div>
        </div>

        {(joinedLabel || accountTypeLabel) && (
          <p className="pr-meta">
            {joinedLabel && <span>Joined {joinedLabel}</span>}
            {joinedLabel && accountTypeLabel && (
              <span className="pr-meta-sep" aria-hidden="true">·</span>
            )}
            {accountTypeLabel && <span>{accountTypeLabel}</span>}
          </p>
        )}

        {about && <p className="pr-about">{about}</p>}

        <div className="pr-stats">
          <div className="pr-stat">
            <span className="pr-stat-value">{formatCount(stats?.iconsCount ?? 0)}</span>
            <span className="pr-stat-label">Icons</span>
          </div>
          <button
            type="button"
            className="pr-stat pr-stat--link"
            aria-label="Show followers"
            onClick={() => setFollowList("followers")}
          >
            <span className="pr-stat-value">{formatCount(stats?.followersCount ?? 0)}</span>
            <span className="pr-stat-label">Followers</span>
          </button>
          <button
            type="button"
            className="pr-stat pr-stat--link"
            aria-label="Show following"
            onClick={() => setFollowList("following")}
          >
            <span className="pr-stat-value">{formatCount(stats?.followingCount ?? 0)}</span>
            <span className="pr-stat-label">Following</span>
          </button>
          <div className="pr-stat">
            <span className="pr-stat-value">{formatCount(stats?.reactionsReceived ?? 0)}</span>
            <span className="pr-stat-label">Pookies</span>
          </div>
        </div>

        <div className="pr-actions">
          {isOwner ? (
            <button
              type="button"
              className="pr-btn pr-btn--primary"
              onClick={() => setEditOpen(true)}
            >
              <Pencil size={16} />
              Edit Profile
            </button>
          ) : isAuthenticated && userId ? (
            <>
              <button
                type="button"
                className={`pr-btn ${isFollowing ? "pr-btn--outline" : "pr-btn--primary"}`}
                onClick={handleFollow}
                disabled={toggleFollow.isPending || followState.isPending}
              >
                {toggleFollow.isPending
                  ? "…"
                  : isFollowing
                    ? "Following"
                    : "Follow"}
              </button>
              <button
                type="button"
                className="pr-btn pr-btn--outline"
                onClick={() => void handleMessageClick()}
                disabled={messageOpening}
                aria-label={`Message ${displayName}`}
              >
                {messageOpening ? (
                  <Loader2 size={16} className="pr-spin" />
                ) : (
                  <MessageSquare size={16} />
                )}
                Message
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="pr-btn pr-btn--icon"
            onClick={handleShare}
            aria-label="Share profile"
          >
            <Share2 size={18} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="pr-btn pr-btn--icon"
                aria-label="More options"
              >
                <MoreHorizontal size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8}>
              {isOwner && (
                <>
                  <DropdownMenuItem
                    onClick={() => { setEditOpen(true); }}
                    className="flex items-center gap-2"
                  >
                    <Pencil size={16} />
                    Edit Profile
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => { handleShare(); }}
                className="flex items-center gap-2"
              >
                <Share2 size={16} />
                Share Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const url = userId
                    ? `${window.location.origin}/profile/${userId}`
                    : `${window.location.origin}/profile`;
                  void navigator.clipboard.writeText(url);
                  toast.success("Link copied.");
                }}
                className="flex items-center gap-2"
              >
                <LinkIcon size={16} />
                Copy Link
              </DropdownMenuItem>
              {!isOwner && isAuthenticated && userId && (
                <DropdownMenuItem
                  onClick={() => { setReportOpen(true); }}
                  className="flex items-center gap-2"
                >
                  <Flag size={16} />
                  Report User
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="pr-content">
        <div
          className="pr-tabs"
          role="tablist"
          aria-label="Profile content"
          ref={tabsRef}
          onKeyDown={handleTabKeyDown}
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`profile-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              aria-controls={`profile-panel-${tab.id}`}
              tabIndex={active === tab.id ? 0 : -1}
              className={`pr-tab ${active === tab.id ? "pr-tab--active" : ""}`}
              onClick={() => scrollToTab(tab.id, scrollBehavior())}
              ref={(el) => { tabButtonsRef.current[index] = el; }}
            >
              <span className="pr-tab-label">{tab.label}</span>
              {tab.count > 0 && <span className="pr-tab-count">{tab.count}</span>}
            </button>
          ))}
        </div>

        <div className="pr-content-pages" ref={contentRef}>
          {tabs.map(tab => {
            const content = itemsForTab(tab.id);
            const isLoadingTab = loadingForTab(tab.id);
            const hasError = errorForTab(tab.id);
            const copy = EMPTY_COPY[tab.id];
            const emptyIcon =
              tab.id === "posts" ? (
                <ImageIcon size={32} />
              ) : tab.id === "videos" ? (
                <Video size={32} />
              ) : tab.id === "shorts" ? (
                <Film size={32} />
              ) : (
                <Bookmark size={32} />
              );

            return (
              <div
                key={tab.id}
                id={`profile-panel-${tab.id}`}
                className="pr-content-page"
                role="tabpanel"
                aria-labelledby={`profile-tab-${tab.id}`}
                aria-busy={isLoadingTab}
              >
                {isLoadingTab ? (
                  <ContentSkeleton tab={tab.id} />
                ) : hasError ? (
                  <div className="pr-empty pr-empty--error" role="alert">
                    <div className="pr-empty-icon">
                      <AlertTriangle size={32} />
                    </div>
                    <p className="pr-empty-title">
                      Couldn&apos;t load {tab.label.toLowerCase()}
                    </p>
                    <p className="pr-empty-desc">
                      This shelf didn&apos;t load. Check your connection and try again.
                    </p>
                    <button
                      type="button"
                      className="pr-btn pr-btn--outline pr-empty-action"
                      onClick={() => retryForTab(tab.id)}
                    >
                      <RotateCcw size={14} />
                      Try again
                    </button>
                  </div>
                ) : content.length > 0 ? (
                  <div className={`pr-grid ${GRID_CLASS[tab.id]}`}>
                    {content.map(video => (
                      <ProfileTile
                        key={video.id}
                        video={video}
                        onOpenPhoto={onOpenPhoto}
                        onOpenShort={onOpenShort}
                        onOpenVideo={onOpenVideo}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="pr-empty">
                    <div className="pr-empty-icon">{emptyIcon}</div>
                    <p className="pr-empty-title">{copy.title}</p>
                    <p className="pr-empty-desc">
                      {isOwner ? copy.owner : copy.guest}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isOwner && ownerTools && (
        <section className="pr-owner-tools">
          {ownerTools}
        </section>
      )}

      <ProfileEditModal
        profile={profile}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="user"
        targetId={userId ?? null}
        title="Report user"
      />
      <FollowListModal
        open={followList !== null}
        mode={followList ?? "followers"}
        userId={userId ?? profile?.user?.id ?? 0}
        onClose={() => setFollowList(null)}
      />
      <MessageComposeModal
        recipientId={userId ?? 0}
        recipientName={displayName}
        recipientPhotoUrl={profile?.profile?.photoUrl ?? null}
        open={messageComposeOpen}
        onClose={() => setMessageComposeOpen(false)}
        onSent={handleMessageSent}
      />
    </div>
  );
}
