import { useEffect, useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { MessageCircle, Bell, Search, UserPlus, ChevronLeft, MoreVertical, X, Check, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { dmConversationPreview } from "@shared/dmMedia";
import "./messages.css";

export default function Messages() {
  const { isAuthenticated, user } = useAuth();
  const [, navigateLoc] = useLocation();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");
  const [showRequests, setShowRequests] = useState(false);

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

  const acceptRequestMut = trpc.directMessages.acceptMessageRequest.useMutation({
    onSuccess: () => {
      utils.directMessages.listConversations.invalidate();
      utils.directMessages.listMessageRequests.invalidate();
      utils.directMessages.getUnreadMessageCount.invalidate();
    },
  });
  const declineRequestMut = trpc.directMessages.declineMessageRequest.useMutation({
    onSuccess: () => {
      utils.directMessages.listMessageRequests.invalidate();
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];
  const totalUnread = unreadCountQuery.data ?? 0;
  const requestsUnread = requests.length;

  const filteredConversations = conversations.filter((c) =>
    c.partner.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.partner.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAcceptRequest = useCallback(async (requestId: number) => {
    try {
      await acceptRequestMut.mutateAsync({ requestId });
    } catch (error) {
      console.error("Failed to accept request:", error);
    }
  }, [acceptRequestMut]);

  const handleDeclineRequest = useCallback(async (requestId: number) => {
    try {
      await declineRequestMut.mutateAsync({ requestId });
    } catch (error) {
      console.error("Failed to decline request:", error);
    }
  }, [declineRequestMut]);

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
        <h1>Messages</h1>
        <button
          type="button"
          className="header-action"
          onClick={() => setShowRequests(!showRequests)}
          aria-label={showRequests ? "Back to conversations" : "Message requests"}
        >
          {showRequests ? (
            <ChevronLeft size={24} />
          ) : requestsUnread > 0 ? (
            <>
              <UserPlus size={24} />
              <span className="request-badge">{requestsUnread}</span>
            </>
          ) : (
            <UserPlus size={24} />
          )}
        </button>
      </header>

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
            <div className="messages-loading">
              <Loader2 size={24} className="spin" />
              <span>Loading requests...</span>
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
                <div className="request-actions">
                  <button
                    type="button"
                    className="btn-accept"
                    onClick={() => handleAcceptRequest(request.id)}
                    disabled={acceptRequestMut.isPending}
                    aria-label={`Accept request from ${request.requester.name}`}
                  >
                    {acceptRequestMut.isPending ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    <span>Accept</span>
                  </button>
                  <button
                    type="button"
                    className="btn-decline"
                    onClick={() => handleDeclineRequest(request.id)}
                    disabled={declineRequestMut.isPending}
                    aria-label={`Decline request from ${request.requester.name}`}
                  >
                    <X size={16} />
                    <span>Decline</span>
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="messages-list conversations-list" role="list" aria-label="Conversations">
          {conversationsQuery.isPending ? (
            <div className="messages-loading">
              <Loader2 size={24} className="spin" />
              <span>Loading conversations...</span>
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