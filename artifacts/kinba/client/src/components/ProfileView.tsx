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
  BadgeCheck,
  ArrowLeft,
  Flag,
  MoreHorizontal,
  Share2,
  UserRound,
  Video,
  Image as ImageIcon,
  Film,
  Loader2,
  Pencil,
  X,
  Link as LinkIcon,
  Heart,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { uploadImage } from "@/lib/mediaUpload";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import AvatarCropModal from "./AvatarCropModal";
import FollowListModal, { type FollowListMode } from "./FollowListModal";
import { ReportDialog } from "./ReportDialog";
import "./profileRedesign.css";

type ProfileSnapshot = {
  user?: { id: number; name: string | null } | null;
  profile?: {
    username?: string | null;
    photoUrl?: string | null;
    isVerified?: boolean;
    accountType?: "member" | "creator" | "company";
    about?: string | null;
  } | null;
  stats?: {
    reactionsReceived: number;
    iconsCount: number;
    followingCount: number;
    followersCount: number;
  };
};

type ProfileTab = "posts" | "videos" | "shorts" | "pookies";

function profileDisplayName(profile?: ProfileSnapshot): string {
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

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`pr-skeleton ${className}`} />;
}

export function ProfileSkeleton() {
  return (
    <main className="pr-page" aria-busy={true}>
      <div className="pr-header">
        <div className="pr-header-top">
          <SkeletonBlock className="pr-skeleton-avatar" />
          <div className="pr-header-info">
            <SkeletonBlock className="pr-skeleton-name" />
            <SkeletonBlock className="pr-skeleton-handle" />
          </div>
        </div>
        <SkeletonBlock className="pr-skeleton-about" />
        <div className="pr-stats">
          <SkeletonBlock className="pr-skeleton-stat" />
          <SkeletonBlock className="pr-skeleton-stat" />
          <SkeletonBlock className="pr-skeleton-stat" />
          <SkeletonBlock className="pr-skeleton-stat" />
        </div>
        <SkeletonBlock className="pr-skeleton-actions" />
      </div>
      <div className="pr-content">
        <div className="pr-tabs">
          <SkeletonBlock className="pr-skeleton-tab" />
          <SkeletonBlock className="pr-skeleton-tab" />
          <SkeletonBlock className="pr-skeleton-tab" />
        </div>
        <div className="pr-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock className="pr-skeleton-tile" key={i} />
          ))}
        </div>
      </div>
    </main>
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
  const sendRequestMut = trpc.directMessages.sendMessageRequest.useMutation();

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
      // The request was accepted, so the server created or reused the
      // conversation. Read it back from the inbox instead of forcing one open.
      let conversationId = 0;
      try {
        const conversations = await utils.directMessages.listConversations.fetch({
          limit: 50,
        });
        conversationId =
          conversations.find((conversation) => conversation.partner.id === recipientId)
            ?.id ?? 0;
      } catch {
        conversationId = 0;
      }
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
  const [about, setAbout] = useState(profile?.profile?.about ?? "");
  const [photoUrl, setPhotoUrl] = useState(profile?.profile?.photoUrl ?? "");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const update = trpc.profile.update.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) {
      setUsername(profile?.profile?.username ?? "");
      setAbout(profile?.profile?.about ?? "");
      setPhotoUrl(profile?.profile?.photoUrl ?? "");
      setMessage("");
    }
  }, [open, profile?.profile?.username, profile?.profile?.about, profile?.profile?.photoUrl]);

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
    const nextUsername = username.trim() || null;
    const currentUsername = profile?.profile?.username?.trim() || null;
    const nextPhotoUrl = photoUrl.trim() || null;
    const currentPhotoUrl = profile?.profile?.photoUrl || null;
    const nextAbout = about.trim() || null;
    const currentAbout = profile?.profile?.about?.trim() || null;
    const changes: {
      username?: string | null;
      photoUrl?: string | null;
      about?: string | null;
    } = {};
    if (nextUsername !== currentUsername) changes.username = nextUsername;
    if (nextPhotoUrl !== currentPhotoUrl) changes.photoUrl = nextPhotoUrl;
    if (nextAbout !== currentAbout) changes.about = nextAbout;
    if (!Object.keys(changes).length) {
      setMessage("No changes to save.");
      return;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [followList, setFollowList] = useState<FollowListMode | null>(null);
  const [messageComposeOpen, setMessageComposeOpen] = useState(false);
  const [messageOpening, setMessageOpening] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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

  const allVideos = (
    (userId ? publicVideosQuery.data : videosQuery.data) ?? []
  );

  const posts = allVideos.filter(v => v.mediaType === "IMAGE" || v.mediaType === "TEXT");
  const videos = allVideos.filter(
    v => v.mediaType === "VIDEO" && v.kind !== "SHORT"
  );
  const shorts = allVideos.filter(
    v => v.mediaType === "VIDEO" && v.kind === "SHORT"
  );
  const pookies = (isOwner ? bookmarkedVideosQuery.data : []) ?? [];

  const isLoading = activeTab === "pookies"
    ? bookmarkedVideosQuery.isPending
    : isOwner
      ? videosQuery.isPending
      : publicVideosQuery.isPending;

  const activeContent =
    activeTab === "posts"
      ? posts
      : activeTab === "videos"
        ? videos
        : activeTab === "shorts"
          ? shorts
          : pookies;

  const displayName = profileDisplayName(profile);
  const handle = profile?.profile?.username
    ? `@${profile.profile.username}`
    : null;
  const stats = profile?.stats;
  const isFollowing = Boolean(followState.data?.following);
  const about = profile?.profile?.about?.trim() || null;

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

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const tabOrder: ProfileTab[] = ["posts", "videos", "shorts", "pookies"];

  const scrollToTab = useCallback((tab: ProfileTab, behavior: ScrollBehavior = "smooth") => {
    const index = tabOrder.indexOf(tab);
    if (index === -1 || !contentRef.current) return;
    isScrollingContent.current = true;
    contentRef.current.scrollTo({
      left: index * contentRef.current.clientWidth,
      behavior,
    });
    setActiveTab(tab);
    if (tabsRef.current && tabButtonsRef.current[index]) {
      isScrollingTabs.current = true;
      tabButtonsRef.current[index].scrollIntoView({ behavior, inline: "center" });
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
      const clampedIndex = Math.max(0, Math.min(index, tabOrder.length - 1));
      const newTab = tabOrder[clampedIndex];
      if (newTab !== activeTab) {
        isScrollingTabs.current = true;
        setActiveTab(newTab);
        if (tabsRef.current && tabButtonsRef.current[clampedIndex]) {
          tabButtonsRef.current[clampedIndex].scrollIntoView({ behavior: "smooth", inline: "center" });
        }
        setTimeout(() => { isScrollingTabs.current = false; }, 150);
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeTab]);

  useEffect(() => {
    if (isScrollingTabs.current) return;
    scrollToTab(activeTab, "smooth");
  }, [activeTab, scrollToTab]);

  return (
    <main className="pr-page">
      <div className="pr-header">
        <div className="pr-header-top">
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
              <UserRound size={28} />
            )}
          </div>
          <div className="pr-header-info">
            <h1 className="pr-name">
              {displayName}
              {profile?.profile?.isVerified && (
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

        {about && <p className="pr-about">{about}</p>}

        <div className="pr-stats">
          <div className="pr-stat">
            <span className="pr-stat-value">{formatCount(stats?.iconsCount ?? 0)}</span>
            <span className="pr-stat-label">Posts</span>
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
              <Pencil size={15} />
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
                className="pr-btn pr-btn--primary"
                onClick={() => void handleMessageClick()}
                disabled={messageOpening}
                aria-label={`Message ${displayName}`}
              >
                {messageOpening ? (
                  <Loader2 size={15} className="pr-spin" />
                ) : (
                  <MessageSquare size={15} />
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
            <Share2 size={17} />
          </button>
          <div className="pr-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="pr-btn pr-btn--icon"
              onClick={() => setMenuOpen(v => !v)}
              aria-label="More options"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={17} />
            </button>
            {menuOpen && (
              <div className="pr-dropdown" role="menu">
                {isOwner && (
                  <button
                    type="button"
                    className="pr-dropdown-item"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); setEditOpen(true); }}
                  >
                    <Pencil size={15} />
                    Edit Profile
                  </button>
                )}
                <button
                  type="button"
                  className="pr-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    handleShare();
                  }}
                >
                  <Share2 size={15} />
                  Share Profile
                </button>
                <button
                  type="button"
                  className="pr-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    const url = userId
                      ? `${window.location.origin}/profile/${userId}`
                      : `${window.location.origin}/profile`;
                    void navigator.clipboard.writeText(url);
                    toast.success("Link copied.");
                  }}
                >
                  <LinkIcon size={15} />
                  Copy Link
                </button>
                {!isOwner && isAuthenticated && userId ? (
                  <button
                    type="button"
                    className="pr-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setReportOpen(true);
                    }}
                  >
                    <Flag size={15} />
                    Report User
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pr-content">
        <div className="pr-tabs" role="tablist" aria-label="Content tabs" ref={tabsRef}>
          {(
            [
              ["posts", "Posts", posts.length],
              ["videos", "Videos", videos.length],
              ["shorts", "Shorts", shorts.length],
              ["pookies", "Pookies", pookies.length],
            ] as const
          ).map(([id, label, count], index) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`pr-tab ${activeTab === id ? "pr-tab--active" : ""}`}
              onClick={() => scrollToTab(id as ProfileTab, "smooth")}
              ref={(el) => { tabButtonsRef.current[index] = el; }}
            >
              {id === "posts" ? <ImageIcon size={15} /> : id === "videos" ? <Video size={15} /> : id === "shorts" ? <Film size={15} /> : <Heart size={15} />}
              <span>{label}</span>
              {count > 0 && <span className="pr-tab-count">{count}</span>}
            </button>
          ))}
        </div>

        <div className="pr-content-pages" ref={contentRef} role="tabpanel" aria-label="Profile content">
          {tabOrder.map((tabId, pageIndex) => {
            const content = tabId === "posts"
              ? posts
              : tabId === "videos"
                ? videos
                : tabId === "shorts"
                  ? shorts
                  : pookies;
            const isLoadingTab = tabId === "pookies"
              ? bookmarkedVideosQuery.isPending
              : isOwner
                ? videosQuery.isPending
                : publicVideosQuery.isPending;

            return (
              <div key={tabId} className="pr-content-page" role="tabpanel" aria-labelledby={`tab-${tabId}`}>
                {isLoadingTab ? (
                  <div className="pr-grid">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonBlock className="pr-skeleton-tile" key={i} />
                    ))}
                  </div>
                ) : content.length > 0 ? (
                  <div className="pr-grid">
                    {content.map(video => (
                      <article
                        className="pr-tile"
                        key={video.id}
                        onClick={() => {
                          if (video.mediaType === "IMAGE" && onOpenPhoto) {
                            onOpenPhoto(video);
                          } else if (video.mediaType === "VIDEO" && video.kind === "SHORT" && onOpenShort) {
                            onOpenShort(video.id);
                          } else if (video.mediaType === "VIDEO" && onOpenVideo) {
                            onOpenVideo(video);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && video.mediaType === "IMAGE" && onOpenPhoto) {
                            e.preventDefault();
                            onOpenPhoto(video);
                          } else if ((e.key === "Enter" || e.key === " ") && video.mediaType === "VIDEO" && video.kind === "SHORT" && onOpenShort) {
                            e.preventDefault();
                            onOpenShort(video.id);
                          } else if ((e.key === "Enter" || e.key === " ") && video.mediaType === "VIDEO" && onOpenVideo) {
                            e.preventDefault();
                            onOpenVideo(video);
                          }
                        }}
                      >
                        {video.mediaType === "TEXT" ? (
                          <div className="pr-tile-text">
                            <span className="pr-tile-text-content">{video.title || video.description || ""}</span>
                          </div>
                        ) : video.mediaType === "IMAGE" ? (
                          <img
                            src={resolveMediaUrl(video.videoUrl) ?? video.videoUrl}
                            className="pr-tile-img"
                            alt={video.title || "Post"}
                            loading="lazy"
                          />
                        ) : resolveMediaUrl(video.thumbnailUrl) ? (
                          <img
                            src={resolveMediaUrl(video.thumbnailUrl)}
                            className="pr-tile-img"
                            alt={video.title}
                            loading="lazy"
                          />
                        ) : (
                          <div className="pr-tile-fallback">
                            <Video size={22} />
                          </div>
                        )}
                        {video.mediaType === "VIDEO" && (
                          <span className="pr-tile-play">
                            <Video size={13} />
                          </span>
                        )}
                        {video.mediaType !== "TEXT" && (
                          <div className="pr-tile-meta">
                            <span className="pr-tile-title">{video.title}</span>
                            <span className="pr-tile-views">{formatCount(video.viewCount)} views</span>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="pr-empty">
                    <div className="pr-empty-icon">
                      {tabId === "posts" ? (
                        <ImageIcon size={32} />
                      ) : tabId === "videos" ? (
                        <Video size={32} />
                      ) : tabId === "shorts" ? (
                        <Film size={32} />
                      ) : (
                        <Heart size={32} />
                      )}
                    </div>
                    <p className="pr-empty-title">No {tabId} yet</p>
                    <p className="pr-empty-desc">
                      {isOwner
                        ? `Share your first ${tabId === "posts" ? "photo" : tabId === "videos" ? "video" : tabId === "shorts" ? "short" : "pookied content"} with the community.`
                        : `This user hasn't posted any ${tabId} yet.`}
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
    </main>
  );
}
