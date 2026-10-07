import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Copy,
  Reply,
  Pencil,
  Trash2,
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
  replyToId?: number | null;
  preview?: {
    kind: DMAttachmentKind;
    name: string;
    size: number;
    previewUrl?: string;
  };
  failed: boolean;
};

/** Structural view of the quoted parent returned by listMessages. */
type MessageQuote = {
  id: number;
  sender?: { name?: string | null; username?: string | null } | null;
  body?: string | null;
  mediaType?: string | null;
  deletedAt?: Date | string | null;
};

/** Structural view of a persisted message row (server returns Dates via superjson). */
type ActionableMessage = {
  id: number;
  senderId: number;
  body?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  createdAt: Date | string;
  editedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  replyTo?: MessageQuote | null;
  sender?: { name?: string | null; username?: string | null } | null;
};

type MessageActionId = "copy" | "reply" | "edit" | "delete";

type MessageAction = {
  id: MessageActionId;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
};

type ContextMenuState = {
  messageId: number;
  x: number;
  y: number;
};

type ReplyTarget = {
  id: number;
  label: string;
  preview: string;
};

// Mirrors the server's DM_EDIT_WINDOW_MS — the server re-checks and rejects.
const EDIT_WINDOW_MS = 30 * 60 * 1000;

function mediaLabel(mediaType?: string | null): string {
  if (!mediaType) return "Attachment";
  if (mediaType.startsWith("video")) return "Video";
  if (mediaType.startsWith("image")) return "Photo";
  if (mediaType === DM_DOCUMENT_MEDIA_TYPE) return "Document";
  return "Attachment";
}

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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<{ timer: number | null; x: number; y: number }>({
    timer: null,
    x: 0,
    y: 0,
  });

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

  const editMut = trpc.directMessages.editMessage.useMutation({
    onSuccess: () => {
      utils.directMessages.listMessages.invalidate();
      utils.directMessages.listConversations.invalidate();
    },
    onError: error => {
      console.error("Failed to edit message:", error);
    },
  });

  const deleteMut = trpc.directMessages.deleteMessage.useMutation({
    onSuccess: () => {
      utils.directMessages.listMessages.invalidate();
      utils.directMessages.listConversations.invalidate();
    },
    onError: error => {
      console.error("Failed to delete message:", error);
    },
  });

  const messages = conversationQuery.data ?? [];
  const isLoading = conversationQuery.isPending;
  const isError = conversationQuery.isError;
  const messageById = useMemo(
    () => new Map(messages.map(message => [message.id, message])),
    [messages]
  );

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
   * Called when a file is selected via the native picker in AttachmentMenu.
   * The menu item itself IS the file input, so this receives the files directly.
   * We do NOT close the menu here — AttachmentMenu.handleChange defers closing
   * to allow the native picker to complete on mobile/WebView. The menu closes
   * via onClose callback after files are processed.
   */
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
          ...(entry.replyToId ? { replyToId: entry.replyToId } : {}),
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

      // Captured before the strip clears so every payload of this send keeps
      // quoting the same target message.
      const activeReplyToId = replyTarget?.id ?? null;

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
              replyToId: activeReplyToId,
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
      if (activeReplyToId != null) setReplyTarget(null);

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
      replyTarget,
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

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current.timer != null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  }, []);

  const openMessageMenu = useCallback(
    (messageId: number, x: number, y: number) => {
      cancelLongPress();
      setContextMenu({ messageId, x, y });
    },
    [cancelLongPress]
  );

  const closeMessageMenu = useCallback(() => setContextMenu(null), []);

  // Escape dismisses the contextual menu.
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMessageMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu, closeMessageMenu]);

  // Mobile: a 450 ms long-press opens the contextual menu. Any scroll/drag
  // (or lift) cancels it, so the gesture never hijacks reading or scrolling.
  const handleBubbleTouchStart = useCallback(
    (messageId: number, event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      cancelLongPress();
      longPressRef.current.x = touch.clientX;
      longPressRef.current.y = touch.clientY;
      longPressRef.current.timer = window.setTimeout(() => {
        longPressRef.current.timer = null;
        openMessageMenu(messageId, touch.clientX, touch.clientY);
      }, 450);
    },
    [cancelLongPress, openMessageMenu]
  );

  const handleBubbleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        cancelLongPress();
        return;
      }
      const moved =
        Math.abs(touch.clientX - longPressRef.current.x) > 10 ||
        Math.abs(touch.clientY - longPressRef.current.y) > 10;
      if (moved) cancelLongPress();
    },
    [cancelLongPress]
  );

  const handleBubbleTouchEnd = useCallback(() => cancelLongPress(), [cancelLongPress]);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  // The message menu dismisses on any interaction outside it.
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [contextMenu]);

  /**
   * Actions differ by ownership. The client only greys/hides options — the
   * server independently enforces ownership, the 30-minute window and the
   * soft-delete guard.
   */
  const getActions = useCallback(
    (msg: ActionableMessage): MessageAction[] => {
      if (msg.deletedAt != null) return [];
      const isOwn = msg.senderId === user?.id;
      const hasBody = Boolean(msg.body?.trim());
      const actions: MessageAction[] = [];
      if (hasBody) {
        actions.push({ id: "copy", label: "Copy", icon: <Copy size={16} /> });
      }
      actions.push({ id: "reply", label: "Reply", icon: <Reply size={16} /> });
      if (isOwn) {
        const withinWindow =
          Date.now() - new Date(msg.createdAt).getTime() <= EDIT_WINDOW_MS;
        if (hasBody && withinWindow) {
          actions.push({ id: "edit", label: "Edit", icon: <Pencil size={16} /> });
        }
        actions.push({
          id: "delete",
          label: "Delete",
          icon: <Trash2 size={16} />,
          danger: true,
        });
      }
      return actions;
    },
    [user?.id]
  );

  const runMessageAction = useCallback(
    async (actionId: MessageActionId, msg: ActionableMessage) => {
      setContextMenu(null);
      if (actionId === "copy") {
        const text = msg.body?.trim();
        if (!text) return;
        try {
          await navigator.clipboard?.writeText(text);
          toast.success("Copied");
        } catch {
          toast.error("Couldn't copy to the clipboard.");
        }
        return;
      }
      if (actionId === "reply") {
        const label = msg.sender?.name || msg.sender?.username || "Message";
        setReplyTarget({
          id: msg.id,
          label,
          preview: msg.body?.trim() || mediaLabel(msg.mediaType),
        });
        textareaRef.current?.focus();
        return;
      }
      if (actionId === "edit") {
        setEditingId(msg.id);
        setEditingText(msg.body ?? "");
        return;
      }
      if (actionId === "delete") {
        if (!window.confirm("Delete this message? This removes it for everyone.")) {
          return;
        }
        try {
          await deleteMut.mutateAsync({ messageId: msg.id });
          toast.success("Message deleted");
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Couldn't delete the message."
          );
        }
      }
    },
    [deleteMut]
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingText("");
  }, []);

  const submitEdit = useCallback(async () => {
    if (editingId == null) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      toast.error("Message cannot be empty.");
      return;
    }
    try {
      await editMut.mutateAsync({ messageId: editingId, body: trimmed });
      setEditingId(null);
      setEditingText("");
      toast.success("Message updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't edit the message."
      );
    }
  }, [editingId, editingText, editMut]);

  /** Tapping a quoted reply jumps to the original message in this thread. */
  const jumpToMessage = useCallback((messageId: number) => {
    const target = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!(target instanceof HTMLElement)) {
      toast.info("That message is no longer loaded.");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("message-bubble--flash");
    window.setTimeout(() => target.classList.remove("message-bubble--flash"), 1200);
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="message-detail-shell">
        <header className="message-detail-header">
          <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
            <ChevronLeft size={24} />
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
            <ChevronLeft size={24} />
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
            <ChevronLeft size={24} />
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

  const menuTarget = contextMenu
    ? messageById.get(contextMenu.messageId)
    : undefined;

  return (
    <div className="message-detail-shell">
      <header className="message-detail-header">
        <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
          <ChevronLeft size={24} />
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
            <MoreVertical size={24} />
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
              const isDeleted = msg.deletedAt != null;
              const isEditing = editingId === msg.id;
              const quote = msg.replyTo;
              return (
                <div
                  key={msg.id}
                  className={`message-bubble${isOwn ? " own" : ""}${isDeleted ? " deleted" : ""}`}
                  data-message-id={msg.id}
                  onContextMenu={(event) => {
                    if (isDeleted) return;
                    event.preventDefault();
                    openMessageMenu(msg.id, event.clientX, event.clientY);
                  }}
                  onTouchStart={(event) => {
                    if (isDeleted) return;
                    handleBubbleTouchStart(msg.id, event);
                  }}
                  onTouchMove={handleBubbleTouchMove}
                  onTouchEnd={handleBubbleTouchEnd}
                  onTouchCancel={handleBubbleTouchEnd}
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
                    {isDeleted ? (
                      <div className="message-body message-body--deleted">
                        <p className="message-deleted-label">Message deleted</p>
                      </div>
                    ) : isEditing ? (
                      <div className="message-edit">
                        <textarea
                          value={editingText}
                          onChange={(event) => setEditingText(event.target.value)}
                          rows={2}
                          aria-label="Edit message"
                          autoFocus
                        />
                        <div className="message-edit-actions">
                          <button
                            type="button"
                            className="message-edit-cancel"
                            onClick={cancelEdit}
                            disabled={editMut.isPending}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="message-edit-save"
                            onClick={() => void submitEdit()}
                            disabled={editMut.isPending || editingText.trim().length === 0}
                          >
                            {editMut.isPending ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {quote && (
                          <button
                            type="button"
                            className="message-reply-quote"
                            onClick={() => jumpToMessage(quote.id)}
                            aria-label="Jump to the message being replied to"
                          >
                            <span className="reply-quote-name">
                              {quote.sender?.name || quote.sender?.username || "Message"}
                            </span>
                            <span className="reply-quote-body">
                              {quote.deletedAt
                                ? "Message deleted"
                                : quote.body?.trim() || mediaLabel(quote.mediaType)}
                            </span>
                          </button>
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
                      </>
                    )}
                    <div className="message-meta">
                      <time className="message-time" dateTime={new Date(msg.createdAt).toISOString()}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                      {msg.editedAt != null && !isDeleted && (
                        <span className="message-edited">edited</span>
                      )}
                      {isOwn && msg.readAt && <Check size={14} className="read-receipt" aria-label="Read" />}
                      {!isDeleted && !isEditing && (
                        <button
                          type="button"
                          className="message-more-btn"
                          aria-label="Message actions"
                          aria-haspopup="menu"
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            openMessageMenu(msg.id, rect.left, rect.bottom + 4);
                          }}
                        >
                          <MoreVertical size={16} />
                        </button>
                      )}
                    </div>
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
                              <Loader2 size={14} className="spin" />
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
                        <Loader2 size={14} className="spin" />
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

      {contextMenu && menuTarget && (
        <div
          ref={contextMenuRef}
          role="menu"
          className="message-context-menu"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 196)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 220)),
          }}
          onClick={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          {getActions(menuTarget).map(action => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={`message-context-item${action.danger ? " message-context-item--danger" : ""}`}
              onClick={() => void runMessageAction(action.id, menuTarget)}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}

      <div className="composer-shell">
        {replyTarget && (
          <div className="reply-strip" role="status">
            <div className="reply-strip-text">
              <span className="reply-strip-label">Replying to</span>
              <span className="reply-strip-preview">
                {replyTarget.label}: {replyTarget.preview}
              </span>
            </div>
            <button
              type="button"
              className="reply-strip-cancel"
              aria-label="Cancel reply"
              onClick={() => setReplyTarget(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
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
              onFileSelected={handleFileSelected}
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
