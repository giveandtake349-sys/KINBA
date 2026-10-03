import {
  Bell,
  Database,
  LayoutList,
  LifeBuoy,
  Lock,
  MessageCircle,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Static vocabulary for the JHILIK Account Center.
 *
 * Rows are described by `kind` so the UI can never render a control that
 * pretends to persist something the backend does not support:
 *
 * - `action`       — performs a real mutation (API call or persisted local pref)
 * - `navigation`   — jumps to an existing screen
 * - `information`  — read-only fact with no control attached
 * - `unavailable`  — declared unsupported; rendered disabled with an explicit badge
 */
export type SettingsRowKind =
  | "action"
  | "navigation"
  | "information"
  | "unavailable";

export type SettingsSectionId =
  | "account"
  | "privacy"
  | "security"
  | "notifications"
  | "messaging"
  | "content"
  | "appearance"
  | "data"
  | "help";

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "account",
  "privacy",
  "security",
  "notifications",
  "messaging",
  "content",
  "appearance",
  "data",
  "help",
] as const;

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "account",
    label: "Account",
    description: "Profile, email, sign-in and account type",
    icon: UserRound,
  },
  {
    id: "privacy",
    label: "Privacy",
    description: "Who can find and interact with you",
    icon: Lock,
  },
  {
    id: "security",
    label: "Security",
    description: "Password, sessions and blocked accounts",
    icon: ShieldCheck,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Inbox alerts for activity and messages",
    icon: Bell,
  },
  {
    id: "messaging",
    label: "Messaging",
    description: "Direct message requests and read receipts",
    icon: MessageCircle,
  },
  {
    id: "content",
    label: "Content & feed",
    description: "Sensitive content, autoplay and watch history",
    icon: LayoutList,
  },
  {
    id: "appearance",
    label: "Appearance & accessibility",
    description: "Theme, motion and text size",
    icon: Palette,
  },
  {
    id: "data",
    label: "Data & permissions",
    description: "Browser permissions and data usage",
    icon: Database,
  },
  {
    id: "help",
    label: "Help & account status",
    description: "Status, reporting and app information",
    icon: LifeBuoy,
  },
] as const;

/** Standard badge copy for rows the backend cannot honour yet. */
export const UNAVAILABLE_LABEL = "Not available yet";

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTION_IDS as readonly string[]).includes(value)
  );
}

export function findSection(id: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find(section => section.id === id) ?? SETTINGS_SECTIONS[0];
}

export const DEFAULT_SECTION: SettingsSectionId = "account";

export function sectionPath(id: SettingsSectionId): string {
  return `/settings/${id}`;
}

/** Account types stored in `profiles.accountType`. */
export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  member: "Member",
  creator: "Creator",
  company: "Company",
};

export function accountTypeLabel(value: string | null | undefined): string {
  if (!value) return "Member";
  return ACCOUNT_TYPE_LABELS[value] ?? value;
}

/** `profiles.verificationStatus` values plus the legacy badge flag. */
export function verificationLabel(
  status: string | null | undefined,
  isVerified: boolean | undefined
): string {
  switch (status) {
    case "verified":
    case "business_verified":
    case "official":
      return "Verified";
    case "pending":
      return "Review in progress";
    case "eligible":
      return "Free verification available";
    default:
      return isVerified ? "Verified" : "Not verified";
  }
}

export function roleLabel(role: string | null | undefined): string {
  return role === "admin" ? "Administrator" : "Member";
}

export function formatMemberSince(value: string | number | Date | null | undefined): string {
  if (value == null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
