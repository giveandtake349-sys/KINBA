import { useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ChevronLeft, UserPlus, Loader2, AlertCircle, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import "./messages.css";

export default function MessageRequests() {
  const { isAuthenticated } = useAuth();
  const [, navigateLoc] = useLocation();

  const requestsQuery = trpc.directMessages.listMessageRequests.useQuery(
    { limit: 50 },
    { enabled: isAuthenticated, refetchInterval: 30000 }
  );

  const requests = requestsQuery.data ?? [];

  const handleRequestClick = useCallback((requestId: number, conversationId?: number) => {
    if (conversationId) {
      navigateLoc(`/messages/${conversationId}`);
    } else {
      navigateLoc(`/messages/requests/${requestId}`);
    }
  }, [navigateLoc]);

  const handleBack = useCallback(() => {
    navigateLoc("/messages");
  }, [navigateLoc]);

  if (!isAuthenticated) {
    return (
      <div className="messages-shell">
        <header className="messages-header">
          <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
            <ChevronLeft size={24} />
          </button>
          <h1>Message Requests</h1>
        </header>
        <div className="messages-empty">
          <MessageSquare size={48} />
          <h2>Sign in to view requests</h2>
          <p>Message requests from people you don't follow will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-shell">
      <header className="messages-header">
        <button type="button" className="back-btn" onClick={handleBack} aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <h1>Message Requests</h1>
      </header>

      <div className="messages-list requests-list" role="list" aria-label="Message requests">
        {requestsQuery.isPending ? (
          <div className="messages-loading">
            <Loader2 size={24} className="spin" />
            <span>Loading requests...</span>
          </div>
        ) : requestsQuery.isError ? (
          <div className="messages-empty">
            <AlertCircle size={48} />
            <h2>Failed to load requests</h2>
            <p>Please try again later.</p>
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
                <p className="request-note">
                  {request.conversationId
                    ? "Tap to open conversation"
                    : "This person doesn't follow you. Reply to accept."}
                </p>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}