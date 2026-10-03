import { useEffect, useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, ChevronLeft, Search, ArrowLeft, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import MessageDetail from "./MessageDetail";
import "./messages.css";

export function DesktopMessages() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [location, navigate] = useLocation();
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768
  );
  const [searchQuery, setSearchQuery] = useState("");
  const utils = trpc.useUtils();

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const showRequests = location === "/messages/requests";
  const showConversation = location.startsWith("/messages/") && !showRequests;
  const conversationId = showConversation ? Number(location.split("/")[2]) : null;
  const showBackButton = !isDesktop && location === "/messages";

  const handleBack = () => {
    navigate("/");
  };

  // Hooks must run unconditionally: the auth session resolves after mount, so
  // declaring queries behind the unauthenticated early return changes the hook
  // order between renders. Queries stay disabled until the session exists, and
  // until the conversation list is actually visible (mobile conversation view
  // hides the sidebar, so it must not pay for inbox polling).
  const listEnabled = isAuthenticated && (!showConversation || isDesktop);
  const conversationsQuery = trpc.directMessages.listConversations.useQuery(
    { limit: 50 },
    { enabled: listEnabled, refetchInterval: 30000 }
  );
  const requestsQuery = trpc.directMessages.listMessageRequests.useQuery(
    { limit: 50 },
    { enabled: listEnabled, refetchInterval: 30000 }
  );
  const unreadCountQuery = trpc.directMessages.getUnreadMessageCount.useQuery(
    undefined,
    { enabled: isAuthenticated, refetchInterval: 30000 }
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

  if (!isAuthenticated) {
    return (
      <div className="messages-shell desktop-messages-shell">
        {(!showConversation || isDesktop) && (
        <div className="desktop-sidebar">
          <header className="messages-header">
            {showBackButton && (
              <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
                <ArrowLeft size={22} />
              </button>
            )}
            <h1>Messages</h1>
          </header>
          {authLoading ? (
            <div className="messages-list" aria-busy="true" aria-label="Loading messages">
              <div className="messages-skeleton">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="conversation-skeleton">
                    <Skeleton className="conversation-skeleton-avatar" />
                    <div className="conversation-skeleton-content">
                      <Skeleton className="conversation-skeleton-line short" />
                      <Skeleton className="conversation-skeleton-line medium" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-empty">
              <Loader2 size={48} className="spin" />
              <h2>Sign in to view messages</h2>
            </div>
          )}
        </div>
        )}
        {showConversation && (
          <div className="desktop-chat">
            <Route path="/messages/:id" component={MessageDetail} />
          </div>
        )}
      </div>
    );
  }

  const conversations = conversationsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];
  const totalUnread = unreadCountQuery.data ?? 0;
  const requestsUnread = requests.length;

  const handleAcceptRequest = async (requestId: number) => {
    try {
      await acceptRequestMut.mutateAsync({ requestId });
    } catch (error) {
      console.error("Failed to accept request:", error);
    }
  };

  const handleDeclineRequest = async (requestId: number) => {
    try {
      await declineRequestMut.mutateAsync({ requestId });
    } catch (error) {
      console.error("Failed to decline request:", error);
    }
  };

  const handleConversationClick = (convId: number) => {
    navigate(`/messages/${convId}`);
  };

  const handleBackToInbox = () => {
    navigate("/messages");
  };

  const filteredConversations = conversations.filter((c) =>
    c.partner.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.partner.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="messages-shell desktop-messages-shell">
      {(!showConversation || isDesktop) && (
        <aside className={`desktop-sidebar ${showConversation && isDesktop ? "has-chat" : ""}`}>
        <header className="messages-header">
          {showBackButton && (
            <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
              <ArrowLeft size={22} />
            </button>
          )}
          <h1>Messages</h1>
          <button
            type="button"
            className="header-action"
            onClick={() => navigate(showRequests ? "/messages" : "/messages/requests")}
            aria-label={showRequests ? "Back to conversations" : "Message requests"}
          >
            {showRequests ? (
              <ChevronLeft size={22} />
            ) : requestsUnread > 0 ? (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                </svg>
                <span className="request-badge">{requestsUnread}</span>
              </>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
              </svg>
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
              <div className="messages-skeleton" aria-busy="true" aria-label="Loading message requests">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="request-skeleton">
                    <Skeleton className="request-skeleton-avatar" />
                    <div className="request-skeleton-content">
                      <Skeleton className="request-skeleton-line short" />
                      <Skeleton className="request-skeleton-line medium" />
                      <Skeleton className="request-skeleton-line long" />
                    </div>
                  </div>
                ))}
              </div>
            ) : requestsQuery.isError && requestsQuery.data === undefined ? (
              <div className="messages-empty">
                <AlertCircle size={48} />
                <h2>Couldn't load message requests</h2>
                <p>The server may be waking up. Check your connection and try again.</p>
                <button type="button" className="primary-btn" onClick={() => void requestsQuery.refetch()}>
                  Try again
                </button>
              </div>
            ) : requests.length === 0 ? (
              <div className="messages-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                </svg>
                <h2>No message requests</h2>
                <p>When someone you don't follow messages you, it'll appear here.</p>
              </div>
            ) : (
              requests.map((request) => (
                <article key={request.id} className="request-item" role="listitem">
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
                        {new Date(request.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p className="request-preview">{request.body}</p>
                    {request.mediaUrl && (
                      <span className="request-media-badge">Media attached</span>
                    )}
                    <p className="request-note">This person doesn't follow you. Accept to start chatting.</p>
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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
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
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
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
              <div className="messages-skeleton" aria-busy="true" aria-label="Loading conversations">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="conversation-skeleton">
                    <Skeleton className="conversation-skeleton-avatar" />
                    <div className="conversation-skeleton-content">
                      <Skeleton className="conversation-skeleton-line short" />
                      <Skeleton className="conversation-skeleton-line medium" />
                    </div>
                  </div>
                ))}
              </div>
            ) : conversationsQuery.isError && conversationsQuery.data === undefined ? (
              <div className="messages-empty">
                <AlertCircle size={48} />
                <h2>Couldn't load conversations</h2>
                <p>The server may be waking up. Check your connection and try again.</p>
                <button type="button" className="primary-btn" onClick={() => void conversationsQuery.refetch()}>
                  Try again
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="messages-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <h2>No conversations yet</h2>
                <p>Start a conversation by messaging someone from their profile.</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/messages/${conv.id}`}
                  className={`conversation-item${conv.unreadCount > 0 ? " unread" : ""}${showConversation && conversationId === conv.id ? " active" : ""}`}
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
                        {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString() : ""}
                      </time>
                    </div>
                    <p className={`conversation-preview${conv.unreadCount > 0 ? " unread" : ""}`}>
                      {conv.lastMessage?.mediaUrl ? "📷 Media" : conv.lastMessage?.body || "No messages yet"}
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
      </aside>
      )}

      {showConversation && (
        <main className="desktop-chat">
          <Route path="/messages/:id" component={MessageDetail} />
        </main>
      )}
    </div>
  );
}