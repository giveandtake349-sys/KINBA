import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SettingsGroup, SettingsNote, SettingsRow, SettingsState } from "./atoms";

function relativeTime(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationsPane() {
  const { isAuthenticated } = useAuth();

  const listQuery = trpc.notifications.list.useQuery(
    { limit: 6 },
    {
      enabled: isAuthenticated,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );
  const unreadQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });

  const items = listQuery.data ?? [];
  const unread = unreadQuery.data ?? 0;

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Notifications</p>
        <h2 className="settings-pane__title">What reaches your inbox</h2>
        <p className="settings-pane__subtitle">
          JHILIK delivers every notification to your in-app inbox. Per-type
          controls are on the product roadmap but are not stored yet, so this
          screen shows real state instead of switches.
        </p>
      </div>

      <SettingsGroup title="Status">
        <SettingsRow
          kind="information"
          label="Unread notifications"
          description="Everything JHILIK has sent you and not opened yet"
          value={unreadQuery.isPending ? "…" : String(unread)}
        />
        <SettingsRow
          kind="information"
          label="Delivery channel"
          description="Push and email delivery are not connected yet"
          value="In-app inbox"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Recent"
        hint="Your latest notifications, loaded live from the server."
      >
        {listQuery.isPending ? (
          <li className="settings-row">
            <SettingsState kind="loading" message="Loading notifications…" />
          </li>
        ) : listQuery.isError ? (
          <li className="settings-row">
            <SettingsState
              kind="error"
              message="We couldn't load your notifications."
              onRetry={() => void listQuery.refetch()}
            />
          </li>
        ) : items.length === 0 ? (
          <li className="settings-row">
            <SettingsState
              kind="empty"
              message="No notifications yet. Reactions, comments and room updates will show up here."
            />
          </li>
        ) : (
          <li className="settings-row settings-row--list">
            <ul className="settings-mini-list">
              {items.slice(0, 5).map(item => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  {item.body ? <span>{item.body}</span> : null}
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {relativeTime(item.createdAt)}
                    {item.readAt ? "" : " · Unread"}
                  </time>
                </li>
              ))}
            </ul>
          </li>
        )}
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsRow
          kind="unavailable"
          label="Choose which notifications you get"
          description="Turn likes, comments, follows, messages, rooms or mentions on and off"
          note="Spec §22 keeps notification preferences out of v1 and the schema has no preference column — a toggle would invent backend behaviour."
        />
        <SettingsRow
          kind="unavailable"
          label="Email & push delivery"
          description="Send notifications outside the app"
          note="Push and email fan-out are listed as future work (spec §33) and are not implemented."
        />
      </SettingsGroup>

      <SettingsNote tone="info">
        Open the bell in the top bar for the full notification centre — this
        screen only mirrors it.
      </SettingsNote>
    </>
  );
}
