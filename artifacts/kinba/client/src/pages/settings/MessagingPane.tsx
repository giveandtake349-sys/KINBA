import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SettingsGroup, SettingsNote, SettingsRow, SettingsState } from "./atoms";

export default function MessagingPane() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const requestsQuery = trpc.directMessages.listMessageRequests.useQuery(
    { limit: 50 },
    {
      enabled: isAuthenticated,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );

  const pending = requestsQuery.data?.length ?? 0;
  const requestsValue = requestsQuery.isPending
    ? "…"
    : pending > 0
      ? `${pending} pending`
      : "None pending";

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Messaging</p>
        <h2 className="settings-pane__title">Direct messages</h2>
        <p className="settings-pane__subtitle">
          How messages reach you, what you have waiting, and which conversation
          controls exist today.
        </p>
      </div>

      <SettingsGroup
        title="Delivery & requests"
        hint="Message requests are decided by follow relationships, not by a switch."
      >
        <SettingsRow
          kind="information"
          label="Delivery rules"
          description="People who follow you can message you directly. Everyone else is held as a message request until you accept it."
          value="Follow-based"
        />
        <SettingsRow
          kind="navigation"
          label="Message requests"
          description="Review and accept requests from people you don't follow"
          value={requestsValue}
          onClick={() => navigate("/messages/requests")}
        />
        <SettingsRow
          kind="unavailable"
          label="Who can message you"
          description="Restrict messaging to followers, close friends, or nobody"
          note="There is no per-user messaging preference column, so any switch here would be a lie."
        />
      </SettingsGroup>

      {requestsQuery.isError ? (
        <SettingsState
          kind="error"
          message="We couldn't load your message requests."
          onRetry={() => void requestsQuery.refetch()}
        />
      ) : null}

      <SettingsGroup title="Conversation features">
        <SettingsRow
          kind="information"
          label="Read receipts"
          description="Opening a conversation marks your messages as read for the other person."
          value="Always on"
        />
        <SettingsRow
          kind="unavailable"
          label="Typing & activity indicators"
          description="Show when you are typing or were last active"
          note="JHILIK has no typing or presence channel yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Automatic media download"
          description="Choose whether photos and videos load on cellular data"
          note="Attachments always load with the conversation — there is no media policy to configure."
        />
        <SettingsRow
          kind="unavailable"
          label="Blocked conversations"
          description="Manage people you blocked from your inbox"
          note="You can block a conversation from its own menu, but there is no API to list or undo blocked threads yet."
        />
      </SettingsGroup>

      <SettingsNote tone="info">
        Read receipts are always visible to the other person — JHILIK stores a
        read timestamp on every message you open.
      </SettingsNote>
    </>
  );
}
