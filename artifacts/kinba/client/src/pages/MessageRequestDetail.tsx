import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Send,
  ChevronLeft,
  Loader2,
  AlertCircle,
  MessageSquare,
  Plus,
  X,
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

export default function MessageRequestDetail() {
  const { isAuthenticated, user, session } = useAuth();
  const [, navigateLoc] = useLocation();
  const utils = trpc.useUtils();
  const params = useParams();
  const requestId = Number(params.requestId);

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

  const attachmentsRef = useRef<DmPendingAttachment[]>([]);
  const uploadHandlesRef = useRef<Map<string, DmUploadHandle>>(new Map());
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const optimisticCounterRef = useRef(0);

  const updateAttachments = useCallback(
    (updater: (previous: DmPendingAttachment[]) => DmPendingAttachment[]) => {
      const next = updater(attachmentsRef.current);
      attachmentsRef.current = next;
      setAttachments(next);
    },
    []
  );

  const patchAttachment = useCallback(
    (id: string, patch: (item: DmPendingAttachment) => DmPendingAttachment) => {
      updateAttachments((previous) =>
        previous.map((item) => (item.id === id ? patch(item) : item))
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

  const requestQuery = trpc.directMessages.listMessageRequests.useQuery(
    { limit: 1 },
    { enabled: isAuthenticated, refetchInterval: 30000 }
  );

  const sendReplyMut = trpc.directMessages.replyToMessageRequest.useMutation({
    onSuccess: (result) => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.listMessageRequests.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
      if (result?.conversation?.id) {
        navigateLoc(`/messages/${result.conversation.id}`);
      }
    },
    onError: (error) => {
      console.error("Failed to reply to message request:", error);
    },
  });

  const request = requestQuery.data?.find((r) => r.id === requestId);

  const isLoading = requestQuery.isPending;
  const isError = requestQuery.isError;

  const startUpload = useCallback(
    async (kind: DMAttachmentKind, file: File, id: string) => {
      try {
        const metadata = await probeDmMedia(kind, file);
        const handle = startDmUpload({
          kind,
          file,
          accessToken: session?.access_token ?? null,
          onProgress: (percent) =>
            patchAttachment(id, (item) => ({ ...item, progress: percent })),
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
        patchAttachment(id, (item) => ({
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
        patchAttachment(id, (item) => ({
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
        toast.info(`You can attach up to ${DM_MAX_ATTACHMENTS} files at a time.`);
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

      updateAttachments((previous) => [...previous, ...created]);
      for (const item of created) {
        void startUpload(item.kind, item.file, item.id);
      }
    },
    [registerPreviewUrl, startUpload, updateAttachments]
  );

  const handleFileSelected = useCallback(
    (kind: DMAttachmentKind, files: FileList) => {
      const fileArray = Array.from(files);
      handleFilesSelected(kind, fileArray);
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
      const item = attachmentsRef.current.find((entry) => entry.id === id);
      releasePreviewUrl(item?.previewUrl);
      updateAttachments((previous) =>
        previous.filter((entry) => entry.id !== id)
      );
    },
    [releasePreviewUrl, updateAttachments]
  );

  const handleRetryAttachment = useCallback(
    (id: string) => {
      const item = attachmentsRef.current.find((entry) => entry.id === id);
      if (!item || item.status !== "error") return;
      patchAttachment(id, (entry) => ({
        ...entry,
        status: "uploading",
        progress: 0,
        error: undefined,
      }));
      void startUpload(item.kind, item.file, item.id);
    },
    [patchAttachment, startUpload]
  );

  const handleSendReply = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (sending || !request) return;

      const payloads = buildDmSendPayloads(messageText, attachmentsRef.current);
      if (payloads.length === 0) return;

      setSending(true);
      setMessageText("");

      const consumedIds = new Set(
        payloads
          .map((payload) => payload.attachmentId)
          .filter((id): id is string => Boolean(id))
      );
      const consumed = attachmentsRef.current.filter((item) =>
        consumedIds.has(item.id)
      );
      updateAttachments((previous) =>
        previous.filter((item) => !consumedIds.has(item.id))
      );

      for (const payload of payloads) {
        try {
          await sendReplyMut.mutateAsync({
            requestId: request.id,
            body: payload.body,
            idempotencyKey: nanoid(),
            ...(payload.media ? { media: payload.media } : {}),
          });
        } catch (error) {
          console.error("Reply failed:", error);
          toast.error("Failed to send reply. Please try again.");
        }
      }
      setSending(false);
    },
    [sending, messageText, request, sendReplyMut, updateAttachments]
  );

  const handleBack = useCallback(() => {
    navigateLoc("/messages/requests");
  }, [navigateLoc]);

  if (!isAuthenticated) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button
            type="button"
            className="back-btn"
            onClick={handleBack}
            aria-label="Back"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="header-info">
            <h1>Message Request</h1>
          </div>
        </header>
        <div className="messages-empty" style={{ flex: 1 }}>
          <MessageSquare size={48} />
          <h2>Sign in to view request</h2>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button
            type="button"
            className="back-btn"
            onClick={handleBack}
            aria-label="Back"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="header-info">
            <h1>Loading...</h1>
          </div>
        </header>
        <div className="messages-loading" style={{ flex: 1 }}>
          <Loader2 size={24} className="spin" />
          <span>Loading request...</span>
        </div>
      </div>
    );
  }

  if (isError || !request) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button
            type="button"
            className="back-btn"
            onClick={handleBack}
            aria-label="Back"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="header-info">
            <h1>Error</h1>
          </div>
        </header>
        <div className="messages-empty" style={{ flex: 1 }}>
          <AlertCircle size={48} />
          <h2>Failed to load request</h2>
          <p>Please try again later.</p>
          <button type="button" className="primary-btn" onClick={handleBack}>
            Back to Requests
          </button>
        </div>
      </div>
    );
  }

  const partnerName = request.requester.name || request.requester.username || "Unknown";
  const partnerPhoto = request.requester.photoUrl;

  return (
    <div className="message-detail-shell">
      <header className="message-detail-header">
        <button
          type="button"
          className="back-btn"
          onClick={handleBack}
          aria-label="Back"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="header-info">
          <div
            className="partner-avatar"
            onClick={() => navigateLoc(`/profile/${request.requester.id}`)}
          >
            {partnerPhoto ? (
              <img src={partnerPhoto} alt="" />
            ) : (
              <div className="avatar-placeholder">
                {partnerName[0]?.toUpperCase() || "?"}
              </div>
            )}
          </div>
          <div className="partner-details">
            <strong>{partnerName}</strong>
            <span className="status">
              {request.conversationId ? "Conversation started" : "Message request"}
            </span>
          </div>
        </div>
      </header>

      <div className="message-detail-messages" role="log" aria-live="polite" aria-label="Message request">
        <article className="request-item">
          <div className="request-avatar">
            {partnerPhoto ? (
              <img src={partnerPhoto} alt="" />
            ) : (
              <div className="avatar-placeholder">
                {partnerName[0]?.toUpperCase() || "?"}
              </div>
            )}
          </div>
          <div className="request-content">
            <div className="request-header">
              <strong>{partnerName}</strong>
              <time dateTime={new Date(request.createdAt).toISOString()}>
                {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
              </time>
            </div>
            {request.body && <div className="request-preview">{request.body}</div>}
            {request.mediaUrl && (
              <div className="request-media" style={{ marginTop: "0.5rem" }}>
                <img
                  src={request.mediaUrl}
                  alt="Shared media"
                  loading="lazy"
                  onClick={() => setLightboxUrl(request.mediaUrl!)}
                  style={{ maxWidth: "100%", borderRadius: "var(--radius-control)" }}
                />
              </div>
            )}
            <p className="request-note">
              {request.conversationId
                ? "Conversation already started. Reply to continue."
                : "This person doesn't follow you. Reply to accept and start chatting."}
            </p>
          </div>
        </article>

        <div ref={messagesEndRef} />
      </div>

      <div className="composer-shell">
        <PendingAttachmentStrip
          items={attachments}
          onRemove={handleRemoveAttachment}
          onRetry={handleRetryAttachment}
        />
        <form className="message-detail-input" onSubmit={handleSendReply}>
          <div className="input-actions">
            <button
              type="button"
              className="input-action-btn attach-btn"
              aria-label="Add attachment"
              aria-haspopup="menu"
              aria-expanded={attachmentMenuOpen}
              onClick={() => setAttachmentMenuOpen((open) => !open)}
              disabled={sending}
            >
              <Plus size={20} />
            </button>
            <AttachmentMenu
              open={attachmentMenuOpen}
              onFileSelected={handleFileSelected}
              onClose={() => setAttachmentMenuOpen(false)}
            />
          </div>
          <div className="input-wrapper">
            <textarea
              ref={textareaRef}
              placeholder="Reply to accept..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={1}
              style={{ minHeight: "44px", maxHeight: "160px" }}
              disabled={sending}
              aria-label="Reply input"
            />
          </div>
          <button
            type="submit"
            className="send-btn"
            disabled={sending || messageText.trim().length === 0}
            aria-label="Send reply"
          >
            {sending ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
          </button>
        </form>
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