import { useEffect, useState } from "react";
import { SettingsGroup, SettingsNote, SettingsRow } from "./atoms";

type PermissionState = "granted" | "denied" | "default" | "unsupported";

async function readNotificationPermission(): Promise<PermissionState> {
  if (typeof window === "undefined") return "unsupported";
  try {
    if (typeof Notification === "undefined") return "unsupported";
    const permission: NotificationPermission = Notification.permission;
    if (permission === "granted" || permission === "denied") return permission;
    return "default";
  } catch {
    return "unsupported";
  }
}

const PERMISSION_ROWS: ReadonlyArray<{
  label: string;
  description: string;
  value: string;
}> = [
  {
    label: "Camera",
    description: "Used only when your browser opens a capture prompt",
    value: "Device settings",
  },
  {
    label: "Microphone",
    description: "Used for voice comments and Hype Room audio",
    value: "Device settings",
  },
  {
    label: "Photos & media",
    description: "Chosen through the file picker when you post or attach",
    value: "Device settings",
  },
  {
    label: "Location",
    description: "JHILIK never requests your location",
    value: "Not requested",
  },
  {
    label: "Contacts",
    description: "JHILIK never reads your contacts",
    value: "Not requested",
  },
];

export default function DataPane() {
  const [permission, setPermission] = useState<PermissionState>("unsupported");

  useEffect(() => {
    let mounted = true;
    void readNotificationPermission().then(value => {
      if (mounted) setPermission(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const permissionLabel: Record<PermissionState, string> = {
    granted: "Allowed",
    denied: "Blocked",
    default: "Not asked",
    unsupported: "Check your browser",
  };

  return (
    <>
      <div className="settings-pane__header">
        <p className="settings-pane__eyebrow">Data & permissions</p>
        <h2 className="settings-pane__title">What JHILIK can use</h2>
        <p className="settings-pane__subtitle">
          JHILIK is a web app: your browser and operating system own these
          permissions. This screen reports them honestly and never pretends to
          change them.
        </p>
      </div>

      <SettingsGroup
        title="Browser permissions"
        hint="Status is read from the browser. To change it, open your browser's site settings for JHILIK."
      >
        <SettingsRow
          kind="information"
          label="Browser notifications"
          description="Whether this site may show notifications"
          value={permissionLabel[permission]}
        />
        {PERMISSION_ROWS.map(row => (
          <SettingsRow key={row.label} kind="information" {...row} />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Data usage">
        <SettingsRow
          kind="unavailable"
          label="Data saver"
          description="Load fewer videos and smaller images on mobile data"
          note="No data-saver preference exists in the client or the API yet."
        />
        <SettingsRow
          kind="unavailable"
          label="Storage used by this app"
          description="See how much space cached media takes on this device"
          note="JHILIK does not track or report local storage usage."
        />
      </SettingsGroup>

      <SettingsNote tone="warning">
        Nothing in this group changes a device setting. Revoking a permission
        is done in your browser, not here.
      </SettingsNote>
    </>
  );
}
