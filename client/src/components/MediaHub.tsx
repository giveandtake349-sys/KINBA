import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Heart,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Share2,
  Upload,
  Verified,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  getVideoMetadata,
  MAX_ANNOUNCEMENT_VIDEO_DIMENSION,
  MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
  uploadImage,
  uploadVideo,
  validateImageFile,
  type VideoMetadata,
} from "@/lib/mediaUpload";
import "./mediaHub.css";

type VideoKind = "LONG" | "SHORT";
type VideoRecord = {
  id: number;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  kind: VideoKind;
  durationSeconds: number;
  width: number;
  height: number;
  reactionCount: number;
  shareCount: number;
  viewerReacted: boolean;
  viewerShared: boolean;
  owner: {
    id: number;
    name: string | null;
    photoUrl: string | null;
    accountType: "member" | "creator" | "company";
    isVerified: boolean;
  };
};
type ImageSelection = { file: File; previewUrl: string };
type VideoSelection = {
  file: File;
  previewUrl: string;
  metadata: VideoMetadata;
  kind: VideoKind;
};
type AnnouncementVideoSelection = {
  file: File;
  previewUrl: string;
  metadata: VideoMetadata;
};
type Engagement = {
  reactionCount: number;
  shareCount: number;
  viewerReacted: boolean;
  viewerShared: boolean;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes
    ? `${minutes}:${String(remainder).padStart(2, "0")}`
    : `${seconds}s`;
}
function notifyError(error: unknown) {
  toast.error(
    error instanceof Error
      ? error.message
      : "The operation could not be completed."
  );
}
function VideoPreview({
  video,
  vertical = false,
}: {
  video: VideoRecord;
  vertical?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const ref = useRef<HTMLVideoElement>(null);
  const togglePlay = async () => {
    const element = ref.current;
    if (!element) return;
    if (element.paused) {
      await element.play();
      setPlaying(true);
    } else {
      element.pause();
      setPlaying(false);
    }
  };
  return (
    <div
      className={
        vertical
          ? "media-video-frame media-video-frame--short"
          : "media-video-frame media-video-frame--square"
      }
    >
      <video
        ref={ref}
        src={video.videoUrl}
        poster={video.thumbnailUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="media-video-controls">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause video" : "Play video"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          onClick={() => setMuted(current => !current)}
          aria-label={muted ? "Unmute video" : "Mute video"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <span>{formatDuration(video.durationSeconds)}</span>
        <div className="media-native-controls">
          <button
            type="button"
            onClick={() => ref.current?.requestFullscreen?.()}
            aria-label="Open fullscreen video"
          >
            ↗
          </button>
        </div>
      </div>
    </div>
  );
}
function UploadVideoPanel() {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<VideoKind>("LONG");
  const [selection, setSelection] = useState<VideoSelection | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createVideo = trpc.videos.create.useMutation();
  const clearSelection = () => {
    if (selection) URL.revokeObjectURL(selection.previewUrl);
    setSelection(null);
    if (inputRef.current) inputRef.current.value = "";
  };
  const selectVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const metadata = await getVideoMetadata(file, {
        maxDurationSeconds:
          kind === "LONG"
            ? MAX_LONG_VIDEO_DURATION_SECONDS
            : MAX_SHORT_VIDEO_DURATION_SECONDS,
        orientation: kind === "LONG" ? "square" : "portrait",
      });
      clearSelection();
      setSelection({
        file,
        previewUrl: URL.createObjectURL(file),
        metadata,
        kind,
      });
    } catch (error) {
      notifyError(error);
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selection || !title.trim()) return;
    setBusy(true);
    try {
      const videoUrl = await uploadVideo(selection.file, selection.kind);
      await createVideo.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        videoUrl,
        thumbnailUrl: null,
        kind: selection.kind,
        durationSeconds: selection.metadata.durationSeconds,
        width: selection.metadata.width,
        height: selection.metadata.height,
      });
      await Promise.all([
        utils.videos.list.invalidate({ kind: "LONG" }),
        utils.videos.list.invalidate({ kind: "SHORT" }),
      ]);
      clearSelection();
      setTitle("");
      setDescription("");
      toast.success(
        selection.kind === "LONG"
          ? "Video published to the main feed."
          : "Short published."
      );
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => clearSelection, [kind]);
  return (
    <details className="media-publish-panel">
      <summary>
        <Upload size={17} /> Publish a video
      </summary>
      <form onSubmit={submit} className="media-publish-form">
        <div
          className="media-kind-switch"
          role="tablist"
          aria-label="Video format"
        >
          <button
            type="button"
            className={kind === "LONG" ? "active" : ""}
            onClick={() => setKind("LONG")}
            role="tab"
            aria-selected={kind === "LONG"}
          >
            Main video · 30 min
          </button>
          <button
            type="button"
            className={kind === "SHORT" ? "active" : ""}
            onClick={() => setKind("SHORT")}
            role="tab"
            aria-selected={kind === "SHORT"}
          >
            Short · 1 min
          </button>
        </div>
        <p className="media-form-hint">
          {kind === "LONG"
            ? "Square 1:1 video, up to 1080p HD and 30 minutes."
            : "Vertical portrait video, up to 1080p HD and 1 minute."}
        </p>
        <label>
          Title
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            minLength={3}
            maxLength={180}
            required
            placeholder="Give your video a clear title"
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            maxLength={2400}
            rows={3}
            placeholder="Tell viewers what this video is about"
          />
        </label>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/ogg"
          onChange={selectVideo}
          className="sr-only"
        />
        {selection ? (
          <div className="media-selection">
            <video src={selection.previewUrl} controls muted playsInline />
            <div>
              <strong>{selection.file.name}</strong>
              <span>
                {selection.metadata.width}×{selection.metadata.height} ·{" "}
                {formatDuration(selection.metadata.durationSeconds)}
              </span>
            </div>
            <button
              type="button"
              className="muted-btn"
              onClick={clearSelection}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="secondary-media-btn"
            onClick={() => inputRef.current?.click()}
          >
            Choose {kind === "LONG" ? "square main video" : "vertical Short"}
          </button>
        )}
        <button
          className="primary-btn"
          type="submit"
          disabled={!selection || !title.trim() || busy}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}{" "}
          {busy ? "Publishing" : "Publish video"}
        </button>
      </form>
    </details>
  );
}
function EngagementActions({
  video,
  engagement,
  onReact,
  onShare,
  reacting,
  sharing,
}: {
  video: VideoRecord;
  engagement: Engagement;
  onReact: () => void;
  onShare: () => void;
  reacting: boolean;
  sharing: boolean;
}) {
  return (
    <div className="media-engagement-actions">
      <button
        type="button"
        className={engagement.viewerReacted ? "is-active" : ""}
        onClick={onReact}
        disabled={reacting}
        aria-pressed={engagement.viewerReacted}
      >
        <Heart
          size={16}
          fill={engagement.viewerReacted ? "currentColor" : "none"}
        />{" "}
        <span>{engagement.viewerReacted ? "Liked" : "React/Like"}</span>{" "}
        <strong>{engagement.reactionCount}</strong>
      </button>
      <button
        type="button"
        className={engagement.viewerShared ? "is-active" : ""}
        onClick={onShare}
        disabled={sharing}
      >
        <Share2 size={16} /> <span>{sharing ? "Sharing" : "Share"}</span>{" "}
        <strong>{engagement.shareCount}</strong>
      </button>
    </div>
  );
}
function LongFormFeed() {
  const utils = trpc.useUtils();
  const auth = useAuth();
  const videosQuery = trpc.videos.list.useQuery(
    { kind: "LONG" },
    { refetchOnWindowFocus: false }
  );
  const [overrides, setOverrides] = useState<Record<number, Engagement>>({});
  const [pendingReact, setPendingReact] = useState<number | null>(null);
  const [pendingShare, setPendingShare] = useState<number | null>(null);
  const reactMutation = trpc.videos.react.useMutation();
  const shareMutation = trpc.videos.share.useMutation();
  const engagementFor = (video: VideoRecord): Engagement =>
    overrides[video.id] ?? {
      reactionCount: video.reactionCount,
      shareCount: video.shareCount,
      viewerReacted: video.viewerReacted,
      viewerShared: video.viewerShared,
    };
  const react = async (video: VideoRecord) => {
    if (!auth.isAuthenticated) return auth.openAuth();
    const previous = engagementFor(video);
    const next = {
      ...previous,
      viewerReacted: !previous.viewerReacted,
      reactionCount: previous.reactionCount + (previous.viewerReacted ? -1 : 1),
    };
    setOverrides(current => ({ ...current, [video.id]: next }));
    setPendingReact(video.id);
    try {
      const synced = await reactMutation.mutateAsync({ videoId: video.id });
      setOverrides(current => ({ ...current, [video.id]: synced }));
      await utils.videos.list.invalidate({ kind: "LONG" });
    } catch (error) {
      setOverrides(current => ({ ...current, [video.id]: previous }));
      notifyError(error);
    } finally {
      setPendingReact(null);
    }
  };
  const share = async (video: VideoRecord) => {
    if (!auth.isAuthenticated) return auth.openAuth();
    try {
      if (navigator.share)
        await navigator.share({
          title: video.title,
          text: video.description,
          url: `${window.location.origin}/videos/${video.id}`,
        });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(
          `${window.location.origin}/videos/${video.id}`
        );
        toast.success("Video link copied.");
      }
      const previous = engagementFor(video);
      const next = {
        ...previous,
        viewerShared: true,
        shareCount: previous.shareCount + (previous.viewerShared ? 0 : 1),
      };
      setOverrides(current => ({ ...current, [video.id]: next }));
      setPendingShare(video.id);
      const synced = await shareMutation.mutateAsync({ videoId: video.id });
      setOverrides(current => ({ ...current, [video.id]: synced }));
      await utils.videos.list.invalidate({ kind: "LONG" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notifyError(error);
    } finally {
      setPendingShare(null);
    }
  };
  return (
    <section
      className="media-section long-form-section"
      aria-labelledby="main-video-feed-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Main video feed</p>
          <h2 id="main-video-feed-heading">Watch what matters.</h2>
        </div>
        <span>Square HD · up to 30 minutes</span>
      </div>
      {videosQuery.isLoading ? (
        <div className="loading-row">
          <Loader2 className="spin" /> Loading videos
        </div>
      ) : videosQuery.data?.length ? (
        <div className="long-video-grid">
          {videosQuery.data.map(video => {
            const engagement = engagementFor(video as VideoRecord);
            return (
              <article className="long-video-card" key={video.id}>
                <VideoPreview video={video as VideoRecord} />
                <div className="long-video-copy">
                  <div className="media-owner">
                    <div>
                      <strong>{video.owner.name ?? "KINBA member"}</strong>
                      <span>
                        {video.owner.isVerified ? (
                          <>
                            <Verified size={12} /> Verified{" "}
                            {video.owner.accountType}
                          </>
                        ) : (
                          video.owner.accountType
                        )}
                      </span>
                    </div>
                    <span>{formatDuration(video.durationSeconds)}</span>
                  </div>
                  <h3>{video.title}</h3>
                  <p>{video.description}</p>
                  <EngagementActions
                    video={video as VideoRecord}
                    engagement={engagement}
                    onReact={() => react(video as VideoRecord)}
                    onShare={() => share(video as VideoRecord)}
                    reacting={pendingReact === video.id}
                    sharing={pendingShare === video.id}
                  />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="media-empty">
          <Play size={18} />
          <h3>No main videos yet.</h3>
          <p>Publish a square HD video to start the main feed.</p>
        </div>
      )}
      <UploadVideoPanel />
    </section>
  );
}
function ShortsFeed() {
  const query = trpc.videos.list.useQuery(
    { kind: "SHORT" },
    { refetchOnWindowFocus: false }
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, (query.data?.length ?? 1) - 1));
    const target = viewportRef.current?.querySelector<HTMLElement>(
      `[data-short-index="${clamped}"]`
    );
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setActiveIndex(clamped);
  };
  const onScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = Math.round(
      viewport.scrollTop / Math.max(viewport.clientHeight, 1)
    );
    setActiveIndex(Math.max(0, Math.min(index, (query.data?.length ?? 1) - 1)));
  };
  return (
    <section
      className="media-section shorts-section"
      aria-labelledby="shorts-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Shorts</p>
          <h2 id="shorts-heading">One minute. One idea.</h2>
        </div>
        <div className="shorts-controls">
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            disabled={!query.data?.length || activeIndex === 0}
            aria-label="Previous Short"
          >
            ↑
          </button>
          <span>
            {query.data?.length
              ? `${activeIndex + 1} / ${query.data.length}`
              : "0 / 0"}
          </span>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={
              !query.data?.length ||
              activeIndex === (query.data?.length ?? 1) - 1
            }
            aria-label="Next Short"
          >
            ↓
          </button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="loading-row">
          <Loader2 className="spin" /> Loading Shorts
        </div>
      ) : query.data?.length ? (
        <div className="shorts-viewport" ref={viewportRef} onScroll={onScroll}>
          {query.data.map((video, index) => (
            <article
              className="short-card"
              data-short-index={index}
              key={video.id}
            >
              <video
                src={video.videoUrl}
                poster={video.thumbnailUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
              />
              <div className="short-overlay">
                <div>
                  <strong>{video.title}</strong>
                  <p>{video.description}</p>
                  <span>
                    {video.owner.name ?? "KINBA member"} ·{" "}
                    {formatDuration(video.durationSeconds)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <Play size={18} />
          <h3>No Shorts yet.</h3>
          <p>
            Publish a vertical video of 60 seconds or less to start the Shorts
            feed.
          </p>
        </div>
      )}
    </section>
  );
}
function AnnouncementComposer({ onCreated }: { onCreated: () => void }) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<ImageSelection[]>([]);
  const [video, setVideo] = useState<AnnouncementVideoSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const createAnnouncement = trpc.community.create.useMutation();
  const clearImages = () => {
    images.forEach(image => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };
  const clearVideo = () => {
    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
  };
  const chooseImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length + images.length > 10)
      return toast.error("Choose up to 10 images for one announcement.");
    try {
      files.forEach(validateImageFile);
      setImages(current => [
        ...current,
        ...files.map(file => ({ file, previewUrl: URL.createObjectURL(file) })),
      ]);
    } catch (error) {
      notifyError(error);
    }
  };
  const chooseVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const metadata = await getVideoMetadata(file, {
        maxDurationSeconds: MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
        maxDimension: MAX_ANNOUNCEMENT_VIDEO_DIMENSION,
        orientation: "any",
      });
      clearVideo();
      setVideo({ file, previewUrl: URL.createObjectURL(file), metadata });
    } catch (error) {
      notifyError(error);
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim() && !images.length && !video)
      return toast.error("Add text, an image, or a video first.");
    setBusy(true);
    try {
      const uploadedImages = await Promise.all(
        images.map(async (image, index) => ({
          mediaType: "IMAGE" as const,
          mediaUrl: await uploadImage("post", image.file),
          sortOrder: index,
          width: null,
          height: null,
          durationSeconds: null,
        }))
      );
      const uploadedVideo = video
        ? [
            {
              mediaType: "VIDEO" as const,
              mediaUrl: await uploadVideo(video.file, "ANNOUNCEMENT"),
              sortOrder: images.length,
              width: video.metadata.width,
              height: video.metadata.height,
              durationSeconds: video.metadata.durationSeconds,
            },
          ]
        : [];
      await createAnnouncement.mutateAsync({
        body: body.trim(),
        attachments: [...uploadedImages, ...uploadedVideo],
      });
      clearImages();
      clearVideo();
      setBody("");
      onCreated();
      toast.success("Community announcement published.");
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="announcement-composer" onSubmit={submit}>
      <label>
        Announcement
        <textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Share an official update with your community"
        />
      </label>
      <div className="announcement-picker-row">
        <button
          type="button"
          className="secondary-media-btn"
          onClick={() => imageInputRef.current?.click()}
        >
          Add images · {images.length}/10
        </button>
        <button
          type="button"
          className="secondary-media-btn"
          onClick={() => videoInputRef.current?.click()}
        >
          Add video · 5 min max
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={chooseImages}
          className="sr-only"
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/ogg"
          onChange={chooseVideo}
          className="sr-only"
        />
      </div>
      {images.length || video ? (
        <div className="announcement-selection">
          {images.map(image => (
            <img
              key={image.previewUrl}
              src={image.previewUrl}
              alt="Announcement preview"
            />
          ))}
          {video && <video src={video.previewUrl} controls muted playsInline />}
          <button
            type="button"
            className="muted-btn"
            onClick={() => {
              clearImages();
              clearVideo();
            }}
          >
            Clear media
          </button>
        </div>
      ) : null}
      <p className="media-form-hint">
        Verified creators and companies can combine up to 10 images with one
        video.
      </p>
      <button className="primary-btn" type="submit" disabled={busy}>
        {busy ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <Megaphone size={16} />
        )}{" "}
        {busy ? "Publishing" : "Publish announcement"}
      </button>
    </form>
  );
}
function CommunityAnnouncements() {
  const auth = useAuth();
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const query = trpc.community.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const canPost = Boolean(
    profileQuery.data?.profile?.isVerified &&
      ["creator", "company"].includes(profileQuery.data.profile.accountType)
  );
  return (
    <section
      className="media-section community-section"
      aria-labelledby="community-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Community announcements</p>
          <h2 id="community-heading">Official word from the network.</h2>
        </div>
        <span>Verified creators & companies</span>
      </div>
      {canPost && <AnnouncementComposer onCreated={() => query.refetch()} />}
      {query.isLoading ? (
        <div className="loading-row">
          <Loader2 className="spin" /> Loading announcements
        </div>
      ) : query.data?.length ? (
        <div className="announcement-list">
          {query.data.map(announcement => (
            <article className="announcement-card" key={announcement.id}>
              <div className="announcement-author">
                <div className="announcement-author-avatar">
                  {announcement.author.photoUrl ? (
                    <img src={announcement.author.photoUrl} alt="" />
                  ) : (
                    <Megaphone size={16} />
                  )}
                </div>
                <div>
                  <strong>
                    {announcement.author.name ?? "KINBA organization"}{" "}
                    <Verified size={13} />
                  </strong>
                  <span>{announcement.author.accountType} · verified</span>
                </div>
                <time dateTime={new Date(announcement.createdAt).toISOString()}>
                  {new Date(announcement.createdAt).toLocaleDateString()}
                </time>
              </div>
              {announcement.body && <p>{announcement.body}</p>}
              <div
                className={`announcement-attachments ${announcement.attachments.length > 1 ? "has-grid" : ""}`}
              >
                {announcement.attachments.map(attachment =>
                  attachment.mediaType === "IMAGE" ? (
                    <img
                      key={attachment.id}
                      src={attachment.mediaUrl}
                      alt="Community announcement attachment"
                      loading="lazy"
                    />
                  ) : (
                    <video
                      key={attachment.id}
                      src={attachment.mediaUrl}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <Megaphone size={18} />
          <h3>No announcements yet.</h3>
          <p>Verified creators and companies will appear here.</p>
        </div>
      )}
    </section>
  );
}
export default function MediaHub() {
  return (
    <div className="media-hub">
      <LongFormFeed />
      <ShortsFeed />
      <CommunityAnnouncements />
    </div>
  );
}
