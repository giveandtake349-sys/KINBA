import { useEffect, useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { MessageCircle, Bell, Search, UserPlus, ChevronLeft, MoreVertical, AlertCircle, Settings, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { dmConversationPreview } from "@shared/dmMedia";
import "./messages.css";

export default function Messages() {
  const { isAuthenticated, user } = useAuth();
  const [, navigateLoc] = useLocation();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");
  const [showRequests, setShowRequests] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [messagePreferences, setMessagePreferences] = useState({
    notifications: true,
    readReceipts: true,
    onlineStatus: true,
    typingIndicator: true,
  });

  const conversationsQuery = trpc.directMessages.listConversations.useQuery(
    { limit: 50 },
    { enabled: isAuthenticated, refetchInterval: 30000 }
  );
  const unreadCountQuery = trpc.directMessages.getUnreadMessageCount.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchInterval: 30000 }
  );
  const requestsQuery = trpc.directMessages.listMessageRequests.useQuery(
    { limit: 50 },
    { enabled: isAuthenticated && showRequests, refetchInterval: 30000 }
  );

  const conversations = conversationsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];
  const totalUnread = unreadCountQuery.data ?? 0;
  const requestsUnread = requests.length;

  const filteredConversations = conversations.filter((c) =>
    c.partner.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.partner.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRequestClick = useCallback((requestId: number, conversationId?: number) => {
    if (conversationId) {
      navigateLoc(`/messages/${conversationId}`);
    } else {
      navigateLoc(`/messages/requests/${requestId}`);
    }
  }, [navigateLoc]);

  const handleConversationClick = useCallback((conversationId: number) => {
    navigateLoc(`/messages/${conversationId}`);
  }, [navigateLoc]);

  if (!isAuthenticated) {
    return (
      <div className="messages-shell">
        <header className="messages-header">
          <h1>Messages</h1>
        </header>
        <div className="messages-empty">
          <MessageCircle size={48} />
          <h2>Sign in to view messages</h2>
          <p>Direct messages and message requests will appear here.</p>
        </div>
      </div>
    );
  }

  const activeTab = showRequests ? "requests" : "conversations";
  const activeUnread = showRequests ? requestsUnread : totalUnread;

  return (
    <div className="messages-shell">
        <header className="messages-header">
          <div className="messages-title-block">
          <h1>Messages</h1>
        </div>
        <button
          type="button"
          className="header-action"
          onClick={() => {
            if (showRequests) {
              setShowRequests(false);
            } else {
              setShowSettings((visible) => !visible);
            }
          }}
          aria-label={showRequests ? "Back to conversations" : "Message settings"}
        >
          {showRequests ? <ChevronLeft size={24} /> : showSettings ? <X size={22} /> : <Settings size={22} />}
        </button>
      </header>

      {showSettings && !showRequests && (
        <section className="message-settings" aria-label="Message settings">
          <div className="message-settings-heading">
            <div>
              <span className="messages-eyebrow">PREFERENCES</span>
              <h2>Message settings</h2>
            </div>
            <button
              type="button"
              className="message-settings-close"
              onClick={() => setShowSettings(false)}
              aria-label="Close message settings"
            >
              <X size={17} />
            </button>
          </div>
          <div className="message-settings-list">
            {([
              ["notifications", "Message notifications", "Alerts for new direct messages"],
              ["readReceipts", "Read receipts", "Let people know when you have seen a message"],
              ["onlineStatus", "Online status", "Show when you are active on KINBA"],
              ["typingIndicator", "Typing indicator", "Show when you are typing a reply"],
            ] as const).map(([key, label, description]) => (
              <label className="message-setting-row" key={key}>
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={messagePreferences[key]}
                  onChange={(event) =>
                    setMessagePreferences((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="message-settings-link"
            onClick={() => {
              setShowSettings(false);
              setShowRequests(true);
            }}
          >
            <span>
              <strong>Message requests</strong>
              <small>Review messages from people you do not follow</small>
            </span>
            <span className="request-badge">{requestsUnread}</span>
          </button>
          <div className="message-settings-secondary">
            <span>Blocked accounts</span>
            <span>Archived chats</span>
          </div>
        </section>
      )}

      <div className="messages-search">
        <Search size={18} />
        <input
          type="search"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search conversations"
        />
      </div>

      {showRequests ? (
        <div className="messages-list requests-list" role="list" aria-label="Message requests">
          {requestsQuery.isPending ? (
            <div className="messages-skeleton" aria-busy="true" aria-label="Loading requests">
              <span />
              <span />
              <span />
            </div>
          ) : requests.length === 0 ? (
            <div className="messages-empty">
              <UserPlus size={48} />
              <h2>No message requests</h2>
              <p>When someone you don't follow messages you, it'll appear here.</p>
            </div>
          ) : (
            requests.map((request) => (
              <article
                key={request.id}
                className="request-item"
                role="listitem"
                onClick={() => handleRequestClick(request.id, request.conversationId)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRequestClick(request.id, request.conversationId);
                  }
                }}
              >
                <div className="request-avatar">
                  {request.requester.photoUrl ? (
                    <img src={request.requester.photoUrl} alt="" />
                  ) : (
                    <div className="avatar-placeholder">
                      {request.requester.name?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                </div>
                <div className="request-content">
                  <div className="request-header">
                    <strong>{request.requester.name || request.requester.username || "Unknown"}</strong>
                    <time dateTime={new Date(request.createdAt).toISOString()}>
                      {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                    </time>
                  </div>
                  <p className="request-preview">{request.body}</p>
                  {request.mediaUrl && (
                    <span className="request-media-badge">Media attached</span>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="messages-list conversations-list" role="list" aria-label="Conversations">
          {conversationsQuery.isPending ? (
            <div className="messages-skeleton" aria-busy="true" aria-label="Loading conversations">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : conversationsQuery.isError ? (
            <div className="messages-empty">
              <AlertCircle size={48} />
              <h2>Couldn't load conversations</h2>
              <p>The server may be waking up. Check your connection and try again.</p>
              <button
                type="button"
                className="primary-btn"
                onClick={() => void conversationsQuery.refetch()}
              >
                Try again
              </button>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="messages-empty">
              <MessageCircle size={48} />
              <h2>{searchQuery ? "No conversations found" : "No conversations yet"}</h2>
              <p>
                {searchQuery
                  ? "Try a different search term."
                  : "Start a conversation by messaging someone from their profile."}
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <Link
                key={conv.id}
                href={`/messages/${conv.id}`}
                className={`conversation-item${conv.unreadCount > 0 ? " unread" : ""}`}
                role="listitem"
                onClick={() => handleConversationClick(conv.id)}
              >
                <div className="conversation-avatar">
                  {conv.partner.photoUrl ? (
                    <img src={conv.partner.photoUrl} alt="" />
                  ) : (
                    <div className="avatar-placeholder">
                      {conv.partner.name?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                </div>
                <div className="conversation-content">
                  <div className="conversation-header">
                    <strong>{conv.partner.name || conv.partner.username || "Unknown"}</strong>
                    <time dateTime={conv.lastMessageAt ? new Date(conv.lastMessageAt).toISOString() : ""}>
                      {conv.lastMessageAt ? formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true }) : ""}
                    </time>
                  </div>
                  <p className={`conversation-preview${conv.unreadCount > 0 ? " unread" : ""}`}>
                    {dmConversationPreview(conv.lastMessage)}
                  </p>
                </div>
                {conv.unreadCount > 0 && (
                  <span className="unread-badge" aria-label={`${conv.unreadCount} unread messages`}>
                    {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                  </span>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
