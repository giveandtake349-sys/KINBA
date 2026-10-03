import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Send,
  ChevronLeft,
  MoreVertical,
  Loader2,
  Check,
  MessageSquare,
  AlertCircle,
  Shield,
  Plus,
  FileText,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nanoid } from "nanoid";
import { FeedPhotoLightbox } from "@/components/MediaHub";
import { AttachmentMenu, PendingAttachmentStrip } from "./MessageAttachments";
import {
  buildDmSendPayloads,
  parseDmMediaDisplay,
  probeDmMedia,
  startDmUpload,
  validateDmFile,
  type DmMessageMedia,
  type DmPendingAttachment,
  type DmUploadHandle,
} from "@/lib/dmAttachment";
import {
  DM_DOCUMENT_ACCEPT,
  DM_DOCUMENT_MEDIA_TYPE,
  DM_MAX_ATTACHMENTS,
  dmDocumentLabel,
  formatDmFileSize,
  type DMAttachmentKind,
} from "@shared/dmMedia";
import "./messages.css";

type OptimisticMessage = {
  idempotencyKey: string;
  text: string;
  media?: DmMessageMedia;
  preview?: {
    kind: DMAttachmentKind;
    name: string;
    size: number;
    previewUrl?: string;
  };
  failed: boolean;
};

export default function MessageDetail() {
  const { isAuthenticated, user, session } = useAuth();
  const [, navigateLoc] = useLocation();
  const utils = trpc.useUtils();
  const params = useParams();
  const conversationId = Number(params.id);

  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<
    Record<number, OptimisticMessage>
  >({});
  const [attachments, setAttachments] = useState<DmPendingAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const attachmentsRef = useRef<DmPendingAttachment[]>([]);
  const uploadHandlesRef = useRef<Map<string, DmUploadHandle>>(new Map());
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const optimisticCounterRef = useRef(0);

  const updateAttachments = useCallback(
    (
      updater: (previous: DmPendingAttachment[]) => DmPendingAttachment[]
    ) => {
      const next = updater(attachmentsRef.current);
      attachmentsRef.current = next;
      setAttachments(next);
    },
    []
  );

  const patchAttachment = useCallback(
    (id: string, patch: (item: DmPendingAttachment) => DmPendingAttachment) => {
      updateAttachments(previous =>
        previous.map(item => (item.id === id ? patch(item) : item))
      );
    },
    [updateAttachments]
  );

  const registerPreviewUrl = useCallback((url: string) => {
    previewUrlsRef.current.add(url);
    return url;
  }, []);

  const releasePreviewUrl = useCallback((url?: string) => {
    if (!url || !url.startsWith("blob:")) return;
    previewUrlsRef.current.delete(url);
    try {
      URL.revokeObjectURL(url);
    } catch {
      // The URL may already be revoked; nothing to clean up.
    }
  }, []);

  useEffect(() => {
    const pendingUploads = uploadHandlesRef.current;
    const pendingUrls = previewUrlsRef.current;
    return () => {
      for (const handle of pendingUploads.values()) handle.abort();
      pendingUploads.clear();
      for (const url of pendingUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      pendingUrls.clear();
    };
  }, []);

  const conversationQuery = trpc.directMessages.listMessages.useQuery(
    { conversationId, limit: 50 },
    {
      enabled: isAuthenticated && conversationId > 0,
      refetchInterval: 5000,
    }
  );
  const markReadMut = trpc.directMessages.markConversationRead.useMutation({
    onSuccess: () => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
    },
  });

  const sendMessageMut = trpc.directMessages.sendMessage.useMutation({
    onSuccess: () => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
    },
    onError: error => {
      console.error("Failed to send message:", error);
    },
  });

  const blockMut = trpc.directMessages.blockConversation.useMutation({
    onSuccess: () => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
      navigateLoc("/messages");
    },
    onError: error => {
      console.error("Failed to block conversation:", error);
    },
  });

  const messages = conversationQuery.data ?? [];
  const isLoading = conversationQuery.isPending;
  const isError = conversationQuery.isError;

  // Determine partner from messages (the other participant, not current user)
  const partner = messages.find((m) => m.senderId !== user?.id)?.sender ?? messages[0]?.sender;
  const partnerName = partner?.name || partner?.username || "Unknown";
  const partnerPhoto = partner?.photoUrl;
  const partnerId = partner?.id;

  // Only mark as read when there are actually unread messages from the partner
  useEffect(() => {
    if (!isAuthenticated || !conversationId) return;
    const hasUnread = messages.some((m) => m.senderId !== user?.id && !m.readAt);
    if (hasUnread) {
      markReadMut.mutate({ conversationId });
    }
  }, [conversationId, isAuthenticated, user?.id, messages, markReadMut]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, optimisticMessages]);

  const uploadingCount = attachments.filter(
    item => item.status === "uploading"
  ).length;
  const readyCount = attachments.filter(item => item.status === "ready").length;
  const hasText = messageText.trim().length > 0;
  const canSend =
    !sending && uploadingCount === 0 && (hasText || readyCount > 0);

  const startUpload = useCallback(
    async (kind: DMAttachmentKind, file: File, id: string) => {
      try {
        // Probe before upload so invalid/oversized-duration videos never hit
        // storage, and images get real intrinsic dimensions for the message.
        const metadata = await probeDmMedia(kind, file);
        const handle = startDmUpload({
          kind,
          file,
          accessToken: session?.access_token ?? null,
          onProgress: percent =>
            patchAttachment(id, item => ({ ...item, progress: percent })),
        });
        uploadHandlesRef.current.set(id, handle);
        const uploaded = await handle.promise;
        const media: DmMessageMedia = {
          mediaUrl: uploaded.url,
          mediaType: uploaded.mediaType,
          mediaWidth: metadata.width ?? null,
          mediaHeight: metadata.height ?? null,
          mediaDuration: metadata.duration ?? null,
        };
        patchAttachment(id, item => ({
          ...item,
          status: "ready",
          progress: 100,
          name: uploaded.name,
          size: uploaded.size,
          media,
          error: undefined,
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Upload failed. Please try again.";
        patchAttachment(id, item => ({
          ...item,
          status: "error",
          error: message,
        }));
      } finally {
        uploadHandlesRef.current.delete(id);
      }
    },
    [session?.access_token, patchAttachment]
  );

  const handleFilesSelected = useCallback(
    (kind: DMAttachmentKind, files: readonly File[] | FileList) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;
      const room = Math.max(0, DM_MAX_ATTACHMENTS - attachmentsRef.current.length);
      if (incoming.length > room) {
        toast.info(
          `You can attach up to ${DM_MAX_ATTACHMENTS} files at a time.`
        );
      }
      const accepted = incoming.slice(0, room);
      const created: DmPendingAttachment[] = [];

      for (const file of accepted) {
        try {
          validateDmFile(kind, file);
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "That file can't be sent."
          );
          continue;
        }
        const id = nanoid(10);
        created.push({
          id,
          kind,
          file,
          name: file.name,
          size: file.size,
          previewUrl: registerPreviewUrl(URL.createObjectURL(file)),
          status: "uploading",
          progress: 0,
        });
      }
      if (created.length === 0) return;

      updateAttachments(previous => [...previous, ...created]);
      for (const item of created) {
        void startUpload(item.kind, item.file, item.id);
      }
    },
    [registerPreviewUrl, startUpload, updateAttachments]
  );

  /**
   * Opens the picker for the tapped action. The three file inputs are always
   * mounted (never conditionally rendered with the menu), so the refs cannot be
   * null here. The picker is triggered *first*, inside the same user gesture
   * that tapped the menu item, and the menu is closed afterwards — closing
   * first must never be able to tear down the control the picker runs on.
   */
  const handlePickAttachment = useCallback((kind: DMAttachmentKind) => {
    if (kind === "image") photoInputRef.current?.click();
    else if (kind === "video") videoInputRef.current?.click();
    else documentInputRef.current?.click();
    setAttachmentMenuOpen(false);
  }, []);

  const handleFileInputChange = useCallback(
    (kind: DMAttachmentKind, event: React.ChangeEvent<HTMLInputElement>) => {
      // Snapshot the files *before* clearing the value: clearing resets the
      // input's live FileList, and consuming the reference afterwards would
      // silently drop the selection (no chip, no upload).
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      handleFilesSelected(kind, files);
    },
    [handleFilesSelected]
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      const handle = uploadHandlesRef.current.get(id);
      if (handle) {
        uploadHandlesRef.current.delete(id);
        handle.abort();
      }
      const item = attachmentsRef.current.find(entry => entry.id === id);
      releasePreviewUrl(item?.previewUrl);
      updateAttachments(previous =>
        previous.filter(entry => entry.id !== id)
      );
    },
    [releasePreviewUrl, updateAttachments]
  );

  const handleRetryAttachment = useCallback(
    (id: string) => {
      const item = attachmentsRef.current.find(entry => entry.id === id);
      if (!item || item.status !== "error") return;
      patchAttachment(id, entry => ({
        ...entry,
        status: "uploading",
        progress: 0,
        error: undefined,
      }));
      void startUpload(item.kind, item.file, item.id);
    },
    [patchAttachment, startUpload]
  );

  const dispatchMessage = useCallback(
    async (optimisticId: number, entry: OptimisticMessage) => {
      try {
        await sendMessageMut.mutateAsync({
          conversationId,
          body: entry.text,
          idempotencyKey: entry.idempotencyKey,
          ...(entry.media ? { media: entry.media } : {}),
        });
        // Pull the persisted row in before dropping the optimistic bubble so
        // the thread never flashes empty.
        await utils.directMessages.listMessages.invalidate();
        setOptimisticMessages(previous => {
          const next = { ...previous };
          delete next[optimisticId];
          return next;
        });
        releasePreviewUrl(entry.preview?.previewUrl);
      } catch (error) {
        console.error("Send failed:", error);
        setOptimisticMessages(previous => ({
          ...previous,
          [optimisticId]: { ...(previous[optimisticId] ?? entry), failed: true },
        }));
      }
    },
    [conversationId, sendMessageMut, utils, releasePreviewUrl]
  );

  const handleSendMessage = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (sending || uploadingCount > 0) return;

      const payloads = buildDmSendPayloads(
        messageText,
        attachmentsRef.current
      );
      if (payloads.length === 0) return;

      setSending(true);
      setMessageText("");

      const consumedIds = new Set(
        payloads
          .map(payload => payload.attachmentId)
          .filter((id): id is string => Boolean(id))
      );
      const consumed = attachmentsRef.current.filter(item =>
        consumedIds.has(item.id)
      );
      updateAttachments(previous =>
        previous.filter(item => !consumedIds.has(item.id))
      );

      const entries: Array<[number, OptimisticMessage]> = payloads.map(
        payload => {
          const attachment = payload.attachmentId
            ? consumed.find(item => item.id === payload.attachmentId)
            : undefined;
          const optimisticId = (optimisticCounterRef.current += 1);
          return [
            optimisticId,
            {
              idempotencyKey: nanoid(),
              text: payload.body,
              media: payload.media,
              preview: attachment
                ? {
                    kind: attachment.kind,
                    name: attachment.name,
                    size: attachment.size,
                    previewUrl: attachment.previewUrl,
                  }
                : undefined,
              failed: false,
            },
          ];
        }
      );
      setOptimisticMessages(previous => ({
        ...previous,
        ...Object.fromEntries(entries),
      }));

      // Sequential sends keep multi-image ordering intact; each message keeps
      // its own idempotency key so a failed one can be retried on its own.
      for (const [optimisticId, entry] of entries) {
        await dispatchMessage(optimisticId, entry);
      }
      setSending(false);
    },
    [
      sending,
      uploadingCount,
      messageText,
      updateAttachments,
      dispatchMessage,
    ]
  );

  const handleRetryMessage = useCallback(
    (optimisticId: number) => {
      const entry = optimisticMessages[optimisticId];
      if (!entry || sending) return;
      setOptimisticMessages(previous => ({
        ...previous,
        [optimisticId]: { ...previous[optimisticId], failed: false },
      }));
      setSending(true);
      void dispatchMessage(optimisticId, entry).finally(() =>
        setSending(false)
      );
    },
    [optimisticMessages, sending, dispatchMessage]
  );

  const handleRemoveMessage = useCallback(
    (optimisticId: number) => {
      const entry = optimisticMessages[optimisticId];
      releasePreviewUrl(entry?.preview?.previewUrl);
      setOptimisticMessages(previous => {
        const next = { ...previous };
        delete next[optimisticId];
        return next;
      });
    },
    [optimisticMessages, releasePreviewUrl]
  );

  const handleBack = useCallback(() => {
    navigateLoc("/messages");
  }, [navigateLoc]);

  const handleMenuToggle = useCallback(() => {
    setShowMenu((prev) => !prev);
  }, []);

  const handleBlock = useCallback(async () => {
    if (!window.confirm("Block this conversation? You won't receive messages from this person.")) return;
    setBlocking(true);
    try {
      await blockMut.mutateAsync({ conversationId });
    } finally {
      setBlocking(false);
      setShowMenu(false);
    }
  }, [conversationId, blockMut, navigateLoc]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  if (!isAuthenticated) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
            <ChevronLeft size={22} />
          </button>
          <div className="header-info">
            <h1>Messages</h1>
          </div>
        </header>
        <div className="messages-empty" style={{ flex: 1 }}>
          <MessageSquare size={48} />
          <h2>Sign in to view conversation</h2>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
            <ChevronLeft size={22} />
          </button>
          <div className="header-info">
            <h1>Loading...</h1>
          </div>
        </header>
        <div className="messages-loading" style={{ flex: 1 }}>
          <Loader2 size={24} className="spin" />
          <span>Loading messages...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
            <ChevronLeft size={22} />
          </button>
          <div className="header-info">
            <h1>Error</h1>
          </div>
        </header>
        <div className="messages-empty" style={{ flex: 1 }}>
          <AlertCircle size={48} />
          <h2>Failed to load conversation</h2>
          <p>Please try again later.</p>
          <button type="button" className="primary-btn" onClick={handleBack}>
            Back to Messages
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="message-detail-shell">
      <header className="message-detail-header">
        <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <div className="header-info">
          <div className="partner-avatar" onClick={() => navigateLoc(`/profile/${partner?.id}`)}>
            {partnerPhoto ? (
              <img src={partnerPhoto} alt="" />
            ) : (
              <div className="avatar-placeholder">{partnerName[0]?.toUpperCase() || "?"}</div>
            )}
          </div>
          <div className="partner-details">
            <strong>{partnerName}</strong>
            <span className="status">Active now</span>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="header-action"
            aria-label="More options"
            onClick={handleMenuToggle}
            ref={menuRef}
          >
            <MoreVertical size={22} />
          </button>
          {showMenu && (
            <div className="header-menu" role="menu" aria-label="Conversation options">
              <button
                type="button"
                className="header-menu-item"
                role="menuitem"
                onClick={handleBlock}
                disabled={blocking}
              >
                <Shield size={16} />
                <span>{blocking ? "Blocking..." : "Block conversation"}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="message-detail-messages" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="messages-empty" style={{ flex: 1, padding: "2rem" }}>
            <MessageSquare size={48} />
            <h2>No messages yet</h2>
            <p>Start the conversation!</p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isOwn = msg.senderId === user?.id;
              const showTime = idx === 0 || 
                (messages[idx - 1] && new Date(msg.createdAt).getTime() - new Date(messages[idx - 1].createdAt).getTime() > 5 * 60 * 1000);
              const mediaUrl = msg.mediaUrl;
              const displayUrl =
                mediaUrl && /^https?:\/\//i.test(mediaUrl) ? mediaUrl : undefined;
              const isVideo = Boolean(msg.mediaType?.startsWith("video"));
              const isDocument = msg.mediaType === DM_DOCUMENT_MEDIA_TYPE;
              const documentMeta = isDocument ? parseDmMediaDisplay(mediaUrl) : null;
              return (
                <div
                  key={msg.id}
                  className={`message-bubble${isOwn ? " own" : ""}`}
                  data-message-id={msg.id}
                >
                  {showTime && (
                    <div className="message-date">
                      {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                    </div>
                  )}
                  <div className="message-content">
                    {!isOwn && idx > 0 && messages[idx - 1]?.senderId !== msg.senderId && (
                      <div className="message-sender-name">{msg.sender.name || msg.sender.username}</div>
                    )}
                    <div className={`message-body${msg.mediaUrl ? " has-media" : ""}`}>
                      {msg.mediaUrl && (
                        <div className="message-media">
                          {!displayUrl ? (
                            <span className="dm-media-unavailable">Attachment</span>
                          ) : isVideo ? (
                            <video src={displayUrl} controls preload="metadata" playsInline />
                          ) : isDocument ? (
                            <a
                              className="dm-doc"
                              href={displayUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${
                                documentMeta?.name ?? "document"
                              }`}
                            >
                              <span className="dm-doc-icon" aria-hidden="true">
                                <FileText size={18} />
                              </span>
                              <span className="dm-doc-text">
                                <span className="dm-doc-name">
                                  {documentMeta?.name ?? "Document"}
                                </span>
                                <span className="dm-doc-sub">
                                  {[
                                    documentMeta
                                      ? dmDocumentLabel(documentMeta.ext)
                                      : "FILE",
                                    documentMeta
                                      ? formatDmFileSize(documentMeta.size)
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" • ")}
                                </span>
                              </span>
                            </a>
                          ) : (
                            <img
                              src={displayUrl}
                              alt="Shared photo"
                              loading="lazy"
                              onClick={() => setLightboxUrl(displayUrl)}
                            />
                          )}
                        </div>
                      )}
                      {msg.body && <p>{msg.body}</p>}
                    </div>
                    <time className="message-time" dateTime={new Date(msg.createdAt).toISOString()}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    {isOwn && msg.readAt && <Check size={14} className="read-receipt" aria-label="Read" />}
                  </div>
                </div>
              );
            })}
            {Object.entries(optimisticMessages).map(([idStr, msg]) => {
                const id = Number(idStr);
                return (
                  <div key={idStr} className={`message-bubble own optimistic${msg.failed ? " failed" : ""}`}>
                    <div className="message-content">
                      <div className={`message-body${msg.media ? " has-media" : ""}`}>
                        {msg.media && msg.preview && (
                          <div className="message-media">
                            {msg.preview.kind === "image" && msg.preview.previewUrl ? (
                              <img src={msg.preview.previewUrl} alt={msg.preview.name} />
                            ) : msg.preview.kind === "video" && msg.preview.previewUrl ? (
                              <video
                                src={msg.preview.previewUrl}
                                controls
                                preload="metadata"
                                muted
                                playsInline
                              />
                            ) : (
                              <div className="dm-doc dm-doc--pending">
                                <span className="dm-doc-icon" aria-hidden="true">
                                  <FileText size={18} />
                                </span>
                                <span className="dm-doc-text">
                                  <span className="dm-doc-name">{msg.preview.name}</span>
                                  <span className="dm-doc-sub">
                                    {formatDmFileSize(msg.preview.size)}
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        {msg.text && <p>{msg.text}</p>}
                      </div>
                      <div className="message-time sending">
                        {msg.failed ? (
                          <>
                            <span className="send-error">Failed to send</span>
                            <button
                              type="button"
                              className="retry-btn"
                              onClick={() => handleRetryMessage(id)}
                              disabled={sending}
                            >
                              <Loader2 size={12} className="spin" />
                              Retry
                            </button>
                            <button
                              type="button"
                              className="retry-btn retry-btn--ghost"
                              onClick={() => handleRemoveMessage(id)}
                              disabled={sending}
                            >
                              Remove
                            </button>
                      </>
                    ) : (
                      <>
                        <Loader2 size={12} className="spin" />
                        Sending...
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="composer-shell">
        <PendingAttachmentStrip
          items={attachments}
          onRemove={handleRemoveAttachment}
          onRetry={handleRetryAttachment}
        />
        <form className="message-detail-input" onSubmit={handleSendMessage}>
          <div className="input-actions">
            <button
              type="button"
              className="input-action-btn attach-btn"
              aria-label="Add attachment"
              aria-haspopup="menu"
              aria-expanded={attachmentMenuOpen}
              onClick={() => setAttachmentMenuOpen(open => !open)}
              disabled={sending}
            >
              <Plus size={20} />
            </button>
            <AttachmentMenu
              open={attachmentMenuOpen}
              onPick={handlePickAttachment}
              onClose={() => setAttachmentMenuOpen(false)}
            />
          </div>
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              placeholder="Message..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={1}
              style={{ minHeight: "44px", maxHeight: "160px" }}
              disabled={sending}
              aria-label="Message input"
            />
          </div>
          <button
            type="submit"
            className="send-btn"
            disabled={!canSend}
            aria-label="Send message"
          >
            {sending ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
          </button>
        </form>
        {/*
          Always mounted, never `hidden`: `hidden`/`display:none` takes the
          input out of layout and mobile browsers/WebView ignore a
          programmatic .click() on a non-rendered file input, so the picker
          never opens. `.sr-only` keeps it laid out (1×1, clipped) while
          invisible — the same pattern the app's other working pickers use.
        */}
        <input
          ref={photoInputRef}
          type="file"
          className="sr-only"
          accept="image/*"
          multiple
          onChange={event => handleFileInputChange("image", event)}
          aria-label="Choose photos to send"
        />
        <input
          ref={videoInputRef}
          type="file"
          className="sr-only"
          accept="video/*"
          onChange={event => handleFileInputChange("video", event)}
          aria-label="Choose a video to send"
        />
        <input
          ref={documentInputRef}
          type="file"
          className="sr-only"
          accept={DM_DOCUMENT_ACCEPT}
          onChange={event => handleFileInputChange("document", event)}
          aria-label="Choose a document to send"
        />
      </div>

      {lightboxUrl && (
        <FeedPhotoLightbox
          imageUrl={lightboxUrl}
          alt="Shared photo"
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </div>
  );
}
