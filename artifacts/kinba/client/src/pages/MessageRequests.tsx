import { useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ChevronLeft, UserPlus, Check, X, Loader2, AlertCircle, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import "./messages.css";

export default function MessageRequests() {
  const { isAuthenticated } = useAuth();
  const [, navigateLoc] = useLocation();
  const utils = trpc.useUtils();

  const requestsQuery = trpc.directMessages.listMessageRequests.useQuery(
    { limit: 50 },
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

  const requests = requestsQuery.data ?? [];

  const handleAcceptRequest = useCallback(async (requestId: number) => {
    try {
      const result = await acceptRequestMut.mutateAsync({ requestId });
      if (result?.conversation?.id) {
        navigateLoc(`/messages/${result.conversation.id}`);
      }
    } catch (error) {
      console.error("Failed to accept request:", error);
    }
  }, [acceptRequestMut, navigateLoc]);

  const handleDeclineRequest = useCallback(async (requestId: number) => {
    try {
      await declineRequestMut.mutateAsync({ requestId });
    } catch (error) {
      console.error("Failed to decline request:", error);
    }
  }, [declineRequestMut]);

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
    </div>
  );
}