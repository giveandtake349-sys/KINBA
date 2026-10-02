import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Send, ChevronLeft, MoreVertical, Loader2, Check, MessageSquare, AlertCircle, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nanoid } from "nanoid";
import "./messages.css";

export default function MessageDetail() {
  const { isAuthenticated, user } = useAuth();
  const [, navigateLoc] = useLocation();
  const utils = trpc.useUtils();
  const params = useParams();
  const conversationId = Number(params.id);
  
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<Record<number, { text: string; idempotencyKey: string; failed: boolean }>>({});
  const [showMenu, setShowMenu] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

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
      setMessageText("");
      setOptimisticMessages({});
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
    },
    onError: (error) => {
      console.error("Failed to send message:", error);
      setOptimisticMessages({});
    },
  });

  const blockMut = trpc.directMessages.blockConversation.useMutation({
    onSuccess: () => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
      navigateLoc("/messages");
    },
    onError: (error) => {
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

  const handleSendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = messageText.trim();
    if (!trimmed) return;
    
    const idempotencyKey = nanoid();
    const optimisticId = Date.now();
    setOptimisticMessages((prev) => ({ ...prev, [optimisticId]: { text: trimmed, idempotencyKey, failed: false } }));
    setSending(true);
    
    try {
      await sendMessageMut.mutateAsync({
        conversationId,
        body: trimmed,
        idempotencyKey,
      });
      setOptimisticMessages((prev) => {
        const next = { ...prev };
        delete next[optimisticId];
        return next;
      });
    } catch (error) {
      console.error("Send failed:", error);
      setOptimisticMessages((prev) => ({
        ...prev,
        [optimisticId]: { ...prev[optimisticId], failed: true },
      }));
    } finally {
      setSending(false);
    }
  }, [messageText, conversationId, sendMessageMut]);

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
                          {msg.mediaType?.startsWith("video") ? (
                            <video src={msg.mediaUrl} controls />
                          ) : (
                            <img src={msg.mediaUrl} alt="Shared media" />
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
                      <div className="message-body">
                        <p>{msg.text}</p>
                      </div>
                      <div className="message-time sending">
                        {msg.failed ? (
                          <>
                            <span className="send-error">Failed to send</span>
                            <button
                              type="button"
                              className="retry-btn"
                              onClick={() => {
                                const { text, idempotencyKey } = msg;
                                setOptimisticMessages((prev) => {
                                  const next = { ...prev };
                                  next[id] = { ...next[id], failed: false };
                                  return next;
                                });
                                setSending(true);
                                sendMessageMut.mutateAsync({
                                  conversationId,
                                  body: text,
                                  idempotencyKey,
                                }).then(() => {
                                  setOptimisticMessages((prev) => {
                                    const next = { ...prev };
                                    delete next[id];
                                    return next;
                                  });
                                }).catch(() => {
                                  setOptimisticMessages((prev) => ({
                                    ...prev,
                                    [id]: { ...prev[id], failed: true },
                                  }));
                                }).finally(() => {
                                  setSending(false);
                                });
                              }}
                              disabled={sending}
                            >
                              <Loader2 size={12} className="spin" />
                              Retry
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

      <form className="message-detail-input" onSubmit={handleSendMessage}>
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
          disabled={!messageText.trim() || sending}
          aria-label="Send message"
        >
          {sending ? <Loader2 size={20} className="spin" /> : <Send size={20} />}
        </button>
      </form>
    </div>
  );
}