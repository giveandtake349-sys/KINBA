import {
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent as ReactSyntheticEvent,
} from "react";
import {
  BadgeCheck,
  BarChart3,
  Bell,
  AtSign,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hash,
  Radio,
  Clock3,
  Copy,
  Coins,
  Film,
  Home as HomeIcon,
  ImagePlus,
  Loader2,
  LogOut,
  Menu,
  Moon,
  PenLine,
  Play,
  Search,
  Settings,
  Sun,
  UserRound,
  Users,
  Video,
  WalletCards,
  X,
  Megaphone,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  Target,
  Trash2,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  isPublicProfileRoute,
  parsePublicProfileRoute,
  parseUsernameProfileRoute,
  matchesRouteProfile,
} from "@/lib/profileRoute";
import { useTheme } from "@/contexts/ThemeContext";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { GoogleIcon } from "@/components/GoogleIcon";
import { useGoogleIdentity } from "@/hooks/useGoogleIdentity";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import {
  getImageDimensions,
  getVideoMetadata,
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
  publishPhoto,
  publishVideo,
  validatePhotoFile,
  uploadImage,
} from "@/lib/mediaUpload";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import type { FeedSection, VideoRecord } from "@/components/MediaHub";
import ProfileView, { ProfileSkeleton } from "@/components/ProfileView";
import { ContentAnalytics } from "@/components/ads/ContentAnalytics";
import FollowListModal, { type FollowListMode } from "@/components/FollowListModal";
import "./profile.css";
import "./createPost.css";
import "./analytics.css";

const MediaHub = lazy(() => import("@/components/MediaHub"));
const CommunityAnnouncements = lazy(() =>
  import("@/components/MediaHub").then(module => ({
    default: module.CommunityAnnouncements,
  }))
);
const SearchFeed = lazy(() =>
  import("@/components/MediaHub").then(module => ({ default: module.SearchFeed }))
);
const FeedPhotoLightbox = lazy(() =>
  import("@/components/MediaHub").then(module => ({
    default: module.FeedPhotoLightbox,
  }))
);

type Screen = "landing" | "dashboard" | "profile";
type AppModal =
  | "upload"
  | "search"
  | "notifications"
  | "wallet"
  | "activity"
  | "offline"
  | "qr"
  | "studio"
  | "announcements"
  | null;
type DrawerAction = Exclude<AppModal, null> | "profile" | "settings" | "advertise";

function safeClick(action: () => void) {
  return (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
}

function guardNonSubmitNavigation(event: ReactMouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (!target.closest('button[type="button"], a[href="#"]')) return;
  event.preventDefault();
  event.stopPropagation();
}

type ProfileSnapshot = {
  user?: { id: number; name: string | null } | null;
  profile?: {
    username?: string | null;
    photoUrl?: string | null;
    isVerified?: boolean;
    accountType?: "member" | "creator" | "company";
    about?: string | null;
    displayName?: string | null;
    birthday?: string | null;
  } | null;
  stats?: {
    reactionsReceived: number;
    iconsCount: number;
    followingCount: number;
    followersCount: number;
    streak?: number;
  };
};

function OfficialLogo() {
  return (
    <div className="official-logo">
      <span className="logo-fallback">JHILIK</span>
    </div>
  );
}

function ThemeToggle({ onClose }: { onClose?: () => void }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        toggleTheme();
        onClose?.();
      }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

function profileDisplayName(profile?: ProfileSnapshot): string {
  const displayName = profile?.profile?.displayName?.trim();
  if (displayName) return displayName;
  const name = profile?.user?.name?.trim();
  if (name && !name.includes("@")) return name;
  const username = profile?.profile?.username?.trim();
  return username ? `@${username}` : "JHILIK member";
}

function ProfileIdentity({
  profile,
  compact = false,
}: {
  profile?: ProfileSnapshot;
  compact?: boolean;
}) {
  const name = profileDisplayName(profile);
  const username = profile?.profile?.username
    ? `@${profile.profile.username}`
    : null;
  return (
    <div
      className={
        compact
          ? "profile-identity profile-identity--compact"
          : "profile-identity"
      }
    >
      <div className="profile-avatar">
        {profile?.profile?.photoUrl ? (
          <img src={profile.profile.photoUrl} alt="" />
        ) : (
          <UserRound size={compact ? 18 : 24} />
        )}
      </div>
      <div>
        <strong className="profile-name-row">
          <span>{name}</span>
          {profile?.profile?.isVerified && (
            <BadgeCheck
              className="verified-badge"
              size={compact ? 15 : 17}
              aria-label="Verified profile"
            />
          )}
        </strong>
        {!compact && username && <span>{username}</span>}
      </div>
    </div>
  );
}

function ProfileStatsGrid({ profile }: { profile?: ProfileSnapshot }) {
  const stats = profile?.stats;
  const [followList, setFollowList] = useState<FollowListMode | null>(null);
  const profileUserId = profile?.user?.id ?? 0;
  const badges = trpc.profile.badges.useQuery({ userId: profileUserId }, { enabled: profileUserId > 0, staleTime: 60_000 });
  const items: Array<{ value: number; label: string; mode?: FollowListMode }> = [
    { value: stats?.reactionsReceived ?? 0, label: "reactions received" },
    { value: stats?.streak ?? 0, label: "streak" },
    {
      value: stats?.followingCount ?? 0,
      label: "following",
      mode: "following",
    },
    { value: stats?.followersCount ?? 0, label: "followers", mode: "followers" },
  ];
  return (
    <>
      <div className="drawer-stat-grid">
        {items.map(item =>
          item.mode && profileUserId > 0 ? (
            <button
              type="button"
              className="drawer-stat drawer-stat--link"
              key={item.label}
              aria-label={`Show ${item.label}`}
              onClick={safeClick(() => setFollowList(item.mode ?? null))}
            >
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </button>
          ) : (
            <div className="drawer-stat" key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          )
        )}
      </div>
      {badges.data?.length ? (
        <div className="profile-badges" aria-label="Badges">
          {badges.data.map(badge => <span key={badge.key} className={badge.awardedAt ? "is-earned" : "is-locked"} title={badge.description}>{badge.awardedAt ? "●" : "○"} {badge.title}</span>)}
        </div>
      ) : null}
      <FollowListModal
        open={followList !== null}
        mode={followList ?? "followers"}
        userId={profileUserId}
        onClose={() => setFollowList(null)}
      />
    </>
  );
}

function GetVerifiedPanel() {
  const utils = trpc.useUtils();
  const hasSyncedVerification = useRef(false);
  const status = trpc.payments.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const submit = trpc.payments.submit.useMutation();
  const [amount, setAmount] = useState("100");
  const [paymentMethod, setPaymentMethod] = useState<"bkash" | "nagad">(
    "bkash"
  );
  const [senderNumber, setSenderNumber] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [message, setMessage] = useState("");
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await submit.mutateAsync({
        amount,
        paymentMethod,
        senderNumber,
        transactionId,
      });
      await status.refetch();
      setMessage(
        "Payment submitted for review. Verification activates after approval."
      );
      setTransactionId("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The payment could not be submitted."
      );
    }
  };
  const isPending = status.data?.latestTransaction?.status === "pending";
  const wasRejected = status.data?.latestTransaction?.status === "rejected";
  useEffect(() => {
    if (!status.data?.isVerified) {
      hasSyncedVerification.current = false;
      return;
    }
    if (hasSyncedVerification.current) return;

    hasSyncedVerification.current = true;
    void utils.profile.me.invalidate();
  }, [status.data?.isVerified, utils.profile.me]);
  if (status.data?.isVerified)
    return (
      <div className="verified-state">
        <BadgeCheck className="verified-badge" size={20} />
        <strong>Verified profile</strong>
        <p>You can publish official community announcements.</p>
      </div>
    );
  return (
    <details className="verification-panel">
      <summary>
        <BadgeCheck className="verified-badge" size={18} /> Get Verified
      </summary>
      <div className="verification-content">
        <p>
          Send the verification amount to <strong>+8801779557226</strong> via
          bKash or Nagad, then submit the details below.
        </p>
        {isPending && (
          <p className="form-message">
            Your latest transaction is pending review. You will receive the
            verification badge automatically after approval.
          </p>
        )}
        {wasRejected && (
          <p className="form-message form-message--error">
            Your previous submission was not approved. Check the sender number
            and TrxID, then submit a new payment only if required.
          </p>
        )}
        <form onSubmit={send}>
          <label>
            Amount
            <input
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              disabled={isPending}
              required
            />
          </label>
          <label>
            Payment method
            <select
              value={paymentMethod}
              onChange={event =>
                setPaymentMethod(event.target.value as "bkash" | "nagad")
              }
              disabled={isPending}
            >
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
            </select>
          </label>
          <label>
            Sender phone number
            <input
              inputMode="tel"
              autoComplete="tel"
              maxLength={16}
              value={senderNumber}
              onChange={event => setSenderNumber(event.target.value)}
              placeholder="01XXXXXXXXX or +8801XXXXXXXXX"
              disabled={isPending}
              required
            />
          </label>
          <label>
            Transaction ID (TrxID)
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={128}
              value={transactionId}
              onChange={event => setTransactionId(event.target.value)}
              disabled={isPending}
              required
            />
          </label>
          <button
            type="submit"
            className="primary-btn"
            disabled={submit.isPending || isPending}
          >
            {isPending
              ? "Payment pending review"
              : submit.isPending
                ? "Submitting…"
                : "Submit for review"}
          </button>
          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
        </form>
      </div>
    </details>
  );
}

type VerificationTransaction = {
  transaction: {
    id: number;
    amount: string;
    paymentMethod: "bkash" | "nagad";
    senderNumber: string;
    transactionId: string;
    status: "pending" | "approved" | "rejected";
    createdAt: Date | string;
  };
  user: { name: string | null };
  profile?: { username?: string | null } | null;
};

function AdminVerificationPanel() {
  const transactions = trpc.payments.all.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const review = trpc.payments.approve.useMutation();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [accountTypes, setAccountTypes] = useState<Record<number, "creator" | "company">>({});
  const decide = async (
    transactionId: number,
    status: "approved" | "rejected"
  ) => {
    setActiveId(transactionId);
    setMessage("");
    try {
      await review.mutateAsync({
        transactionId,
        status,
        accountType: accountTypes[transactionId] ?? "creator",
      });
      await transactions.refetch();
      setMessage(
        status === "approved"
          ? "Payment approved. The member will receive their verification badge automatically."
          : "Payment submission rejected. The member may submit corrected details."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The payment review could not be completed."
      );
    } finally {
      setActiveId(null);
    }
  };
  const rows = (transactions.data ?? []) as VerificationTransaction[];
  const pendingCount = rows.filter(
    row => row.transaction.status === "pending"
  ).length;
  return (
    <section
      className="admin-verification-panel"
      aria-labelledby="payment-review-heading"
    >
      <div className="admin-verification-heading">
        <div>
          <p className="eyebrow">Administrator</p>
          <h2 id="payment-review-heading">Verification payments</h2>
        </div>
        <span>{pendingCount} pending</span>
      </div>
      <p>
        Confirm bKash or Nagad transfers before approving. Approval immediately
        marks the member’s profile as verified.
      </p>
      {transactions.isPending ? (
        <p className="profile-loading-note">Loading payment submissions…</p>
      ) : transactions.isError ? (
        <p className="form-message form-message--error">
          Payment submissions are temporarily unavailable.
        </p>
      ) : rows.length ? (
        <div className="verification-review-table-wrap">
          <table className="verification-review-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Payment</th>
                <th>Sender</th>
                <th>TrxID</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ transaction, user, profile }) => {
                const isPending = transaction.status === "pending";
                const isBusy = activeId === transaction.id;
                return (
                  <tr key={transaction.id}>
                    <td>
                      <strong>
                        {profile?.username?.trim()
                          ? `@${profile.username.trim()}`
                          : user.name && !user.name.includes("@")
                            ? user.name
                            : "JHILIK member"}
                      </strong>
                    </td>
                    <td>
                      {transaction.amount} BDT
                      <span>
                        {transaction.paymentMethod === "bkash"
                          ? "bKash"
                          : "Nagad"}
                      </span>
                    </td>
                    <td>{transaction.senderNumber}</td>
                    <td className="verification-trxid">
                      {transaction.transactionId}
                    </td>
                    <td>{new Date(transaction.createdAt).toLocaleString()}</td>
                    <td>
                      <span
                        className={`verification-status verification-status--${transaction.status}`}
                      >
                        {transaction.status}
                      </span>
                    </td>
                    <td>
                      {isPending ? (
                        <div className="verification-review-actions">
                          <select
                            className="verification-type-select"
                            value={accountTypes[transaction.id] ?? "creator"}
                            onChange={event =>
                              setAccountTypes(prev => ({
                                ...prev,
                                [transaction.id]: event.target.value as "creator" | "company",
                              }))
                            }
                            disabled={isBusy}
                          >
                            <option value="creator">Creator</option>
                            <option value="company">Company</option>
                          </select>
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={isBusy}
                            onClick={() => decide(transaction.id, "approved")}
                          >
                            {isBusy ? "Saving…" : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="verification-reject-btn"
                            disabled={isBusy}
                            onClick={() => decide(transaction.id, "rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="reviewed-label">Reviewed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="profile-loading-note">No verification submissions yet.</p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function MobileDrawer({
  open,
  onClose,
  profile,
  onNavigate,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  profile?: ProfileSnapshot;
  onNavigate: (section: DrawerAction) => void;
  onLogout: () => void;
}) {
  if (!open) return null;
  const menuGroups: {
    title: string;
    items: {
      section: DrawerAction;
      label: string;
      description: string;
      icon: typeof Video;
    }[];
  }[] = [
    {
      title: "Assets",
      items: [
        {
          section: "wallet",
          label: "Balance",
          description: "Wallet and account funds",
          icon: WalletCards,
        },
      ],
    },
    {
      title: "Personal tools",
      items: [
        {
          section: "settings",
          label: "Settings",
          description: "Account, privacy and security",
          icon: Settings,
        },
        {
          section: "activity",
          label: "Activity center",
          description: "Reactions, comments, and follows",
          icon: Bell,
        },
        {
          section: "offline",
          label: "Saved",
          description: "Your saved posts and videos",
          icon: Film,
        },
        {
          section: "qr",
          label: "QR code",
          description: "Share your JHILIK identity",
          icon: QrCode,
        },
      ],
    },
    {
      title: "Creation & business tools",
      items: [
        {
          section: "studio",
          label: "JHILIK Studio",
          description: "Publish and manage your work",
          icon: Video,
        },
        {
          section: "announcements",
          label: "Business announcements",
          description: "Reach verified communities",
          icon: Megaphone,
        },
        {
          section: "advertise",
          label: "Advertise",
          description: "Grow your brand with JHILIK",
          icon: Target,
        },
      ],
    },
  ];
  return (
    <>
      <button
        className="drawer-backdrop"
        type="button"
        aria-label="Close menu"
        onClick={safeClick(onClose)}
      />
      <aside className="mobile-drawer" aria-label="Main menu">
        <div className="drawer-head">
          <span>Menu</span>
          <button type="button" onClick={onClose} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <div className="drawer-profile-card">
          <ProfileIdentity profile={profile} />
          <button
            type="button"
            className="drawer-edit"
            onClick={safeClick(() => {
              onNavigate("profile");
              onClose();
            })}
          >
            Edit Profile
          </button>
          <ProfileStatsGrid profile={profile} />
        </div>
        <nav className="drawer-nav">
          {menuGroups.map(group => (
            <section
              className="drawer-group"
              key={group.title}
              aria-labelledby={`drawer-group-${group.title}`}
            >
              <h2 id={`drawer-group-${group.title}`}>{group.title}</h2>
              {group.items.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.label}
                    onClick={safeClick(() => {
                      onNavigate(item.section);
                      onClose();
                    })}
                  >
                    <span className="drawer-item-icon">
                      <Icon size={18} />
                    </span>
                    <span className="drawer-item-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          <section className="drawer-group" aria-labelledby="drawer-group-appearance">
            <h2 id="drawer-group-appearance">Appearance</h2>
            <ThemeToggle onClose={onClose} />
          </section>
          <button type="button" className="drawer-logout" onClick={safeClick(onLogout)}>
            <LogOut size={18} />
            <span>Log out</span>
          </button>
        </nav>
      </aside>
    </>
  );
}

function AppHeader({
  profile,
  notificationCount,
  onHome,
  onSelectFeed,
  onOpenModal,
  onMenu,
  onProfile,
  onLogout,
}: {
  profile?: ProfileSnapshot;
  notificationCount: number;
  onHome: () => void;
  onSelectFeed: (section: FeedSection) => void;
  onOpenModal: (modal: Exclude<AppModal, null>) => void;
  onMenu: () => void;
  onProfile: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar mobile-first-header">
      <button
        type="button"
        className="brand"
        onClick={safeClick(onHome)}
        aria-label="Go to Home Feed"
      >
        <OfficialLogo />
        <span className="brand-name">JHILIK</span>
      </button>
      <nav className="desktop-nav" aria-label="Primary navigation">
        <button type="button" onClick={safeClick(onHome)}>Feed</button>
        <button type="button" onClick={safeClick(() => onSelectFeed("shorts"))}>Shorts</button>
        <button type="button" onClick={safeClick(onProfile)}>Profile</button>
      </nav>
      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-icon-button"
          onClick={safeClick(() => onOpenModal("search"))}
          aria-label="Search"
          title="Search"
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          className="topbar-icon-button topbar-notification-button"
          onClick={safeClick(() => onOpenModal("notifications"))}
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="notification-badge">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className="header-profile-trigger"
          onClick={safeClick(onMenu)}
          aria-label="Open profile menu"
        >
          <ProfileIdentity profile={profile} compact />
          <Menu size={24} />
        </button>
        <ThemeToggle />
        <button type="button" className="logout-btn" onClick={safeClick(onLogout)}>
          <LogOut size={16} />
          <span>Log out</span>
        </button>
      </div>
    </header>
  );
}

function FeedTabs({
  activeSection,
  onSectionChange,
}: {
  activeSection: FeedSection;
  onSectionChange: (section: FeedSection) => void;
}) {
  const tabs = [
    ["videos", "For You"],
    ["following", "Following"],
    ["spotlight", "Spotlight"],
    ["shorts", "Shorts"],
  ] as const;

  return (
    <nav
      className="home-feed-tabs"
      aria-label="Home feed tabs"
      role="tablist"
      onKeyDown={event => {
        const tabButtons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        );
        const currentIndex = tabButtons.indexOf(event.target as HTMLButtonElement);
        if (currentIndex < 0 || tabButtons.length === 0) return;

        let nextIndex: number;
        if (event.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % tabButtons.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = tabButtons.length - 1;
        } else {
          return;
        }

        event.preventDefault();
        tabButtons[nextIndex].focus();
        tabButtons[nextIndex].click();
      }}
    >
      {tabs.map(([id, label]) => (
        <button
          type="button"
          key={id}
          className={activeSection === id ? "active" : ""}
          onClick={safeClick(() => onSectionChange(id))}
          aria-selected={activeSection === id}
          tabIndex={activeSection === id ? 0 : -1}
          role="tab"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function BottomNavigation({
  className,
  activePanel,
  menuOpen,
  onHome,
  onOpenHypeRooms,
  onPublish,
  onMessages,
  onMenu,
  dmUnreadCount,
}: {
  className?: string;
  activePanel: FeedSection;
  menuOpen: boolean;
  onHome: () => void;
  onOpenHypeRooms: () => void;
  onPublish: () => void;
  onMessages: () => void;
  onMenu: () => void;
  dmUnreadCount: number;
}) {
  const isHome = ["videos", "shorts", "spotlight"].includes(activePanel);
  return (
    <nav
      className={`bottom-navigation fixed left-0 right-0 z-[var(--z-nav)] transition-transform duration-300 ease-in-out ${className ?? ""}`}
      aria-label="Mobile navigation"
    >
      <button
        type="button"
        className={isHome ? "active" : ""}
        onClick={safeClick(onHome)}
        aria-current={isHome ? "page" : undefined}
      >
        <HomeIcon size={24} />
        <span>Home</span>
      </button>
      <button
        type="button"
        className="bottom-nav-hype-rooms"
        onClick={safeClick(onOpenHypeRooms)}
        aria-label="Hype Rooms"
        title="Hype Rooms"
      >
        <Radio size={24} />
        <span>Rooms</span>
      </button>
      <button
        type="button"
        className="publish-nav"
        onClick={safeClick(onPublish)}
        aria-label="Create a video"
      >
        <PenLine size={24} />
        <span>Create</span>
      </button>
      <button
        type="button"
        className={activePanel === "messages" ? "active" : ""}
        onClick={safeClick(onMessages)}
        aria-current={activePanel === "messages" ? "page" : undefined}
      >
        <MessageCircle size={24} />
        <span>Messages</span>
        {dmUnreadCount > 0 && (
          <span className="bottom-nav-badge">{dmUnreadCount > 99 ? "99+" : dmUnreadCount}</span>
        )}
      </button>
      <button
        type="button"
        className={menuOpen ? "active" : ""}
        onClick={safeClick(onMenu)}
        aria-expanded={menuOpen}
      >
        <Menu size={24} />
        <span>Menu</span>
      </button>
    </nav>
  );
}

function Landing({ onLogin }: { onLogin: () => void }) {
  return (
    <main className="landing-shell">
      <div className="landing-orb landing-orb--one" />
      <div className="landing-orb landing-orb--two" />
      <div className="landing-copy">
        <p className="eyebrow eyebrow--bright">A human-first video network</p>
        <h1>
          Ideas with a <em>signal.</em>
        </h1>
        <p>
          Discover videos, follow creators, and join conversations with the
          people and organizations shaping what comes next.
        </p>
        <button type="button" className="primary-btn" onClick={safeClick(onLogin)}>
          Sign in or create an account
        </button>
      </div>
      <section className="landing-guide" aria-label="How to get started">
        <article>
          <span>01</span>
          <h2>Explore</h2>
          <p>Start with For You, Spotlight, or Shorts. Search for people and topics that interest you.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Connect</h2>
          <p>Follow creators to build a Following feed, or join a Hype Room to take part in a community.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Share safely</h2>
          <p>Post when you are ready. Report a profile, Hype Room, room message, or Drop if something needs review.</p>
        </article>
      </section>
      <div className="landing-proof">
        <span>Videos</span>
        <span>Shorts</span>
        <span>ICONS</span>
        <span>Community</span>
      </div>
    </main>
  );
}

type DurableNotification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: number | null;
  link: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

function durableNotificationTarget(
  item: DurableNotification
): string | null {
  if (item.link && item.link.startsWith("/")) return item.link;
  if (item.entityType === "drop" && item.entityId != null) {
    return `/drops/${item.entityId}`;
  }
  if (item.entityType === "hype_room" && item.entityId != null) {
    return `/rooms/${item.entityId}`;
  }
  return null;
}

function NotificationsPanel({ enabled }: { enabled: boolean }) {
  const [, navigate] = useLocation();
  const durableQuery = trpc.notifications.list.useQuery(
    { limit: 50 },
    {
      enabled,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
      refetchInterval: enabled ? 15_000 : false,
    }
  );
  const activityQuery = trpc.home.notifications.useQuery(undefined, {
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
  });
  const utils = trpc.useUtils();
  const markReadMut = trpc.notifications.markRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.notifications.unreadCount.invalidate(),
        utils.notifications.list.invalidate(),
      ]);
    },
  });

  const durableItems = (durableQuery.data ?? []) as DurableNotification[];
  const unreadDurable = durableItems.filter(item => item.readAt == null);
  const activityItems = activityQuery.data ?? [];
  const hasDurable = durableItems.length > 0;
  const hasActivity = activityItems.length > 0;
  const durableLoading = enabled && durableQuery.isPending;
  const activityLoading = enabled && activityQuery.isPending;
  const anyLoading = durableLoading && activityLoading;

  const markOne = async (id: number) => {
    if (markReadMut.isPending) return;
    try {
      await markReadMut.mutateAsync({ ids: [id] });
    } catch {
      // Badge/list stay consistent; user can retry by clicking again.
    }
  };

  const markAll = async () => {
    if (markReadMut.isPending || unreadDurable.length === 0) return;
    try {
      await markReadMut.mutateAsync({});
    } catch {
      // Ignore — next open retries.
    }
  };

  const autoReadRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      autoReadRef.current = false;
      return;
    }
    if (durableQuery.isPending || durableQuery.isError) return;
    if (unreadDurable.length === 0) {
      autoReadRef.current = false;
      return;
    }
    if (autoReadRef.current || markReadMut.isPending) return;
    autoReadRef.current = true;
    void markAll();
  }, [
    enabled,
    durableQuery.isPending,
    durableQuery.isError,
    unreadDurable.length,
    markReadMut.isPending,
  ]);

  const openDurable = async (item: DurableNotification) => {
    const target = durableNotificationTarget(item);
    if (item.readAt == null) {
      await markOne(item.id);
    }
    if (target) navigate(target);
  };

  return (
    <section
      className="media-section utility-section"
      aria-labelledby="notifications-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Notifications</p>
          <h2 id="notifications-heading">Your latest activity.</h2>
        </div>
        {enabled && unreadDurable.length > 0 ? (
          <button
            type="button"
            className="muted-btn"
            disabled={markReadMut.isPending}
            onClick={() => void markAll()}
          >
            {markReadMut.isPending ? "Marking…" : "Mark all read"}
          </button>
        ) : null}
      </div>

      {!enabled ? (
        <div className="media-empty">
          <Bell size={18} />
          <h3>Sign in to see notifications.</h3>
          <p>Sign in for durable alerts and your activity feed.</p>
        </div>
      ) : anyLoading ? (
        <div className="utility-loading">Loading notifications…</div>
      ) : (
        <>
          {durableQuery.isError ? (
            <div className="media-empty">
              <h3>Notifications are temporarily unavailable.</h3>
              <p>Try again in a moment.</p>
            </div>
          ) : hasDurable ? (
            <div className="notification-list" aria-label="System notifications">
              {durableItems.map(item => {
                const unread = item.readAt == null;
                const target = durableNotificationTarget(item);
                return (
                  <article
                    className={`notification-item${unread ? " notification-item--unread" : ""}`}
                    key={`durable-${item.id}`}
                  >
                    <Bell size={16} />
                    <p>
                      <strong>{item.title}</strong>
                      {item.body ? <> — {item.body}</> : null}
                    </p>
                    <div className="notification-item-side">
                      <time dateTime={new Date(item.createdAt).toISOString()}>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </time>
                      {unread ? (
                        <button
                          type="button"
                          className="notification-read-btn"
                          aria-label={`Mark "${item.title}" as read`}
                          disabled={markReadMut.isPending}
                          onClick={() => {
                            void openDurable(item);
                          }}
                        >
                          {target ? "Open" : "Mark read"}
                        </button>
                      ) : target ? (
                        <button
                          type="button"
                          className="notification-read-btn"
                          aria-label={`Open "${item.title}"`}
                          onClick={() => navigate(target)}
                        >
                          Open
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : !durableQuery.isError ? (
            <div className="media-empty">
              <Bell size={18} />
              <h3>No notifications yet.</h3>
              <p>
                New followers, drops, and Hype Room alerts will appear here
                when they happen.
              </p>
            </div>
          ) : null}

          {activityQuery.isError ? (
            <div className="media-empty">
              <h3>Activity is temporarily unavailable.</h3>
              <p>Try again in a moment.</p>
            </div>
          ) : activityLoading && !hasActivity ? (
            <div className="utility-loading">Loading activity…</div>
          ) : hasActivity ? (
            <>
              <p className="eyebrow" style={{ marginTop: "0.75rem" }}>
                Recent activity
              </p>
              <div className="notification-list" aria-label="Activity feed">
                {activityItems.map(item => (
                  <article
                    className="notification-item"
                    key={`${item.kind}-${item.id}`}
                  >
                    <Bell size={16} />
                    <p>
                      <strong>{item.actorName ?? "Someone"}</strong>
                      {item.kind === "reaction"
                        ? " reacted to your video"
                        : item.kind === "share"
                          ? " shared your video"
                          : " commented on your video"}
                      {item.videoTitle ? (
                        <>
                          : <span>{item.videoTitle}</span>
                        </>
                      ) : null}
                    </p>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleDateString()}
                    </time>
                  </article>
                ))}
              </div>
            </>
          ) : hasDurable ? null : !durableQuery.isError ? (
            <div className="media-empty">
              <p>
                Reactions, comments, and shares will appear here.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function SettingsPanel({ onLogout }: { onLogout: () => void }) {
  const google = useGoogleIdentity();
  return (
    <section
      className="media-section utility-section"
      aria-labelledby="settings-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2 id="settings-heading">Make JHILIK yours.</h2>
        </div>
      </div>
      <div className="settings-list">
        <div>
          <div>
            <strong>Theme</strong>
            <span>Switch the app appearance instantly.</span>
          </div>
          <ThemeToggle />
        </div>
        <div>
          <div>
            <strong>Google account</strong>
            <span>
              {google.linked
                ? "Connected. You can sign in with Google."
                : "Link Google to sign in without a password."}
            </span>
          </div>
          {google.linked ? (
            <span className="settings-connected">
              <Check size={16} /> Connected
            </span>
          ) : (
            <button
              type="button"
              className="settings-connect"
              onClick={safeClick(google.connect)}
              disabled={google.pending}
            >
              {google.pending ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <GoogleIcon size={16} />
              )}
              Connect
            </button>
          )}
        </div>
        <button type="button" className="settings-logout" onClick={safeClick(onLogout)}>
          <LogOut size={18} /> Log out
        </button>
      </div>
    </section>
  );
}

function WalletPanel() {
  const wallet = trpc.sponsorBids.walletBalance.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const verification = trpc.payments.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  return (
    <section
      className="media-section utility-section wallet-panel"
      aria-labelledby="wallet-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Assets</p>
          <h2 id="wallet-heading">Your JHILIK wallet.</h2>
        </div>
        <Coins size={24} aria-hidden="true" />
      </div>
      {wallet.isPending ? (
        <div className="wallet-balance-skeleton" aria-busy="true" />
      ) : wallet.isError ? (
        <div className="media-empty" role="alert">
          <h3>Wallet balance is unavailable.</h3>
          <p>Try again in a moment.</p>
          <button
            type="button"
            className="muted-btn"
            onClick={() => wallet.refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="wallet-balance-card">
          <span>Available balance</span>
          <strong>৳{Number(wallet.data ?? 0).toFixed(2)}</strong>
          <small>Used for sponsorships.</small>
        </div>
      )}
      <div className="wallet-status-row">
        <div>
          <span>Account status</span>
          <strong>
            {verification.data?.isVerified ? "Verified" : "Standard member"}
          </strong>
        </div>
        <span
          className={
            verification.data?.isVerified
              ? "wallet-status is-ready"
              : "wallet-status"
          }
        >
          {verification.data?.isVerified
            ? "Ready to publish"
            : "Verification available"}
        </span>
      </div>
    </section>
  );
}

function WalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="wallet-modal-layer" role="presentation">
      <button
        type="button"
        className="wallet-modal-backdrop"
        aria-label="Close wallet"
        onClick={safeClick(onClose)}
      />
      <section
        className="wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-heading"
      >
        <button
          type="button"
          className="wallet-modal-close"
          aria-label="Close wallet"
          onClick={safeClick(onClose)}
        >
          <X size={20} />
        </button>
        <WalletPanel />
        <div className="wallet-modal-actions" aria-label="Wallet actions">
          <button
            type="button"
            className="primary-btn"
            onClick={safeClick(() =>
              toast.info("Deposit requests are being prepared for your account.")
            )}
          >
            <Plus size={16} /> Deposit funds
          </button>
          <button
            type="button"
            className="secondary-media-btn"
            onClick={safeClick(() =>
              toast.info("Withdrawals are reviewed before funds are released.")
            )}
          >
            Withdraw funds
          </button>
        </div>
      </section>
    </div>
  );
}

function ActionModal({
  title,
  open,
  onClose,
  children,
  className = "",
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="action-modal-layer" role="presentation">
      <button
        type="button"
        className="action-modal-backdrop"
        aria-label={`Close ${title}`}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      />
      <section
        className={`action-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="action-modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

type CreateUploaderMode = "menu" | "media" | "text" | "thread";
type UploaderHistoryItem = {
  key: string;
  title: string;
  createdAt: Date | string;
  imageUrl: string | null;
  kind: "IMAGE" | "VIDEO" | "TEXT";
};

function UploaderHistory({
  media,
  textPosts,
}: {
  media: Array<{
    id: number;
    title: string;
    createdAt: Date | string;
    mediaType: "IMAGE" | "VIDEO";
    videoUrl: string;
    thumbnailUrl: string | null;
  }>;
  textPosts: Array<{
    id: number;
    body: string;
    createdAt: Date | string;
    attachments: Array<{ mediaType: "IMAGE" | "VIDEO"; mediaUrl: string }>;
  }>;
}) {
  const items = useMemo<UploaderHistoryItem[]>(() => {
    const mediaItems = media.map(item => ({
      key: `media-${item.id}`,
      title: item.title || "Untitled post",
      createdAt: item.createdAt,
      imageUrl:
        item.mediaType === "IMAGE"
          ? resolveMediaUrl(item.videoUrl) ?? null
          : resolveMediaUrl(item.thumbnailUrl) ?? null,
      kind: item.mediaType,
    }));
    const textItems = textPosts.map(item => ({
      key: `text-${item.id}`,
      title: item.body.trim() || "Text post",
      createdAt: item.createdAt,
      imageUrl: resolveMediaUrl(item.attachments[0]?.mediaUrl) ?? null,
      kind: item.attachments[0]?.mediaType ?? "TEXT",
    }));
    return [...mediaItems, ...textItems]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 3);
  }, [media, textPosts]);

  return (
    <section className="uploader-history" aria-labelledby="uploader-history-heading">
      <div className="uploader-history-heading">
        <div>
          <p className="eyebrow">Your activity</p>
          <h3 id="uploader-history-heading">Recent upload History</h3>
        </div>
        <Clock3 size={18} aria-hidden="true" />
      </div>
      {items.length ? (
        <div className="uploader-history-grid">
          {items.map(item => (
            <article className="uploader-history-card" key={item.key}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" />
              ) : (
                <div className="uploader-history-placeholder" aria-hidden="true">
                  {item.kind === "VIDEO" ? <Video size={24} /> : <FileText size={24} />}
                </div>
              )}
              <div>
                <strong>{item.title}</strong>
                <span>{item.kind === "TEXT" ? "Text post" : item.kind === "IMAGE" ? "Image post" : "Video upload"}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="uploader-history-empty">Your completed uploads and posts will appear here.</p>
      )}
    </section>
  );
}

const TEXT_DRAFT_KEY = "kinba.create.textDraft";
const CREATE_TEXT_MAX = 5000;
const CREATE_CAPTION_MAX = 2400;

function readTextDraft(): string {
  try {
    return typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem(TEXT_DRAFT_KEY) ?? "");
  } catch {
    return "";
  }
}

function writeTextDraft(value: string) {
  try {
    if (value.trim()) window.localStorage.setItem(TEXT_DRAFT_KEY, value);
    else window.localStorage.removeItem(TEXT_DRAFT_KEY);
  } catch {
    // Private mode / blocked storage: drafts are a convenience only.
  }
}

function formatClipDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Same text as the textarea, with #hashtags and @mentions coloured. */
function HighlightedDraft({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_-]+|@[A-Za-z0-9_.]+)/gu);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("#") || part.startsWith("@") ? (
          <span className="cp-token" key={index}>
            {part}
          </span>
        ) : (
          part
        )
      )}
      {"​"}
    </>
  );
}

function CharacterRing({ used, max }: { used: number; max: number }) {
  const ratio = Math.min(1, used / max);
  const circumference = 2 * Math.PI * 12;
  const tone = used >= max ? "is-max" : ratio >= 0.9 ? "is-near" : "";
  return (
    <svg
      className={`cp-ring ${tone}`}
      width="30"
      height="30"
      viewBox="0 0 30 30"
      role="img"
      aria-label={`${used} of ${max} characters used`}
    >
      <circle className="cp-ring-track" cx="15" cy="15" r="12" />
      <circle
        className="cp-ring-value"
        cx="15"
        cy="15"
        r="12"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        transform="rotate(-90 15 15)"
      />
    </svg>
  );
}

type UploadImageSelection = {
  file: File;
  previewUrl: string;
  dimensions: { width: number; height: number };
  /** CSS filter chosen in the edit sheet; baked into the file at publish. */
  filter?: string;
};

/** Filters offered in the media edit sheet (mirrors the approved preview). */
const MEDIA_FILTERS: ReadonlyArray<{ id: string; label: string; css: string }> = [
  { id: "none", label: "Original", css: "none" },
  { id: "mono", label: "Mono", css: "grayscale(1)" },
  { id: "sepia", label: "Sepia", css: "sepia(.7)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.7) contrast(1.1)" },
  { id: "cool", label: "Cool", css: "hue-rotate(-20deg) saturate(1.2)" },
  { id: "warm", label: "Warm", css: "sepia(.35) saturate(1.5)" },
];

/** Applies a CSS filter to an image via canvas; falls back to the original. */
async function applyFilterToImage(file: File, cssFilter: string): Promise<File> {
  if (!cssFilter || cssFilter === "none") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.filter = cssFilter;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, file.type)
    );
    if (!blob) return file;
    return new File([blob], file.name, { type: file.type });
  } catch {
    return file;
  }
}

function UploadVideoModal({
  open,
  onClose,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [mode, setMode] = useState<CreateUploaderMode>("menu");
  const [mediaMode, setMediaMode] = useState<"video" | "photo">("video");
  const [kind, setKind] = useState<"LONG" | "SHORT">("LONG");
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<"everyone" | "close_friends">("everyone");
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [selectedImages, setSelectedImages] = useState<UploadImageSelection[]>([]);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [textBody, setTextBody] = useState(() => readTextDraft());
  const [draftSaved, setDraftSaved] = useState(true);
  const [textBusy, setTextBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Media edit sheet (Facebook-style): trim for video, filters for both.
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState(true);
  const [editingPhotoIndex, setEditingPhotoIndex] = useState(0);
  const [videoFilter, setVideoFilter] = useState("none");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | null>(null);
  const auth = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const createTextMutation = trpc.videos.createText.useMutation();
  const mediaHistory = trpc.profile.videos.useQuery(undefined, {
    enabled: open && auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
  const textHistory = trpc.community.mine.useQuery(undefined, {
    enabled: open && auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
  const closeFriendsQuery = trpc.profile.closeFriends.useQuery(undefined, {
    enabled: open && auth.isAuthenticated && audience === "close_friends",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) setMode("menu");
  }, [open]);

  // Text drafts survive closing the sheet and reloading the app.
  useEffect(() => {
    setDraftSaved(false);
    const timer = window.setTimeout(() => {
      writeTextDraft(textBody);
      setDraftSaved(true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [textBody]);

  // Local preview of the chosen file (revoked when it changes or the sheet unmounts).
  useEffect(() => {
    if (!file || mediaMode !== "video") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, mediaMode]);

  const clearMedia = () => {
    setFile(null);
    setSelectedImages(current => {
      current.forEach(image => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setImageDimensions(null);
    setClipSeconds(null);
    setVideoFilter("none");
    setTrimStart(0);
    setTrimEnd(null);
    setEditSheetOpen(false);
  };
  /** Removes a single photo from the selection (revokes its preview URL). */
  const removeSelectedImage = (index: number) => {
    setSelectedImages(current => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  };
  /** Opens the Facebook-style edit sheet for the video. */
  const openVideoEditor = () => {
    setTrimStart(0);
    setTrimEnd(clipSeconds);
    setEditingVideo(true);
    setEditSheetOpen(true);
  };
  /** Opens the Facebook-style edit sheet for one photo. */
  const openPhotoEditor = (index: number) => {
    setEditingPhotoIndex(index);
    setEditingVideo(false);
    setEditSheetOpen(true);
  };
  /** Clamps preview playback inside the chosen trim range. */
  const clampTrimPlayback = (event: ReactSyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget;
    const end = trimEnd ?? clipSeconds ?? el.duration;
    if (trimStart > 0 && el.currentTime < trimStart) el.currentTime = trimStart;
    else if (Number.isFinite(end) && end > 0 && el.currentTime > end) el.currentTime = trimStart;
  };
  const close = () => {
    setMode("menu");
    clearMedia();
    setCaption("");
    setAudience("everyone");
    setRecipientIds([]);
    onClose();
  };
  const chooseMode = (next: CreateUploaderMode) => {
    if (!auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    setMode(next);
  };
  const chooseMedia = (nextMode: "photo" | "video", nextKind: "LONG" | "SHORT" = "LONG") => {
    setMediaMode(nextMode);
    setKind(nextKind);
    clearMedia();
    chooseMode("media");
  };
  const switchVideoKind = (nextKind: "LONG" | "SHORT") => {
    if (nextKind === kind) return;
    setKind(nextKind);
    // The duration limit differs per kind, so the chosen clip must be re-checked.
    clearMedia();
  };
  const ingestFiles = async (nextFiles: File[]) => {
    if (!nextFiles.length) return;
    try {
      if (mediaMode === "photo") {
        if (nextFiles.length > 20) throw new Error("Choose up to 20 images per post.");
        nextFiles.forEach(validatePhotoFile);
        const images = await Promise.all(nextFiles.map(async selected => ({
          file: selected,
          previewUrl: URL.createObjectURL(selected),
          dimensions: await getImageDimensions(selected),
        })));
        setSelectedImages(images);
        setImageDimensions(images[0]?.dimensions ?? null);
        setClipSeconds(null);
        setFile(null);
        return;
      }
      const nextFile = nextFiles[0];
      const metadata = await getVideoMetadata(nextFile, {
        maxDurationSeconds:
          kind === "LONG" ? MAX_LONG_VIDEO_DURATION_SECONDS : MAX_SHORT_VIDEO_DURATION_SECONDS,
      });
      setImageDimensions(null);
      setClipSeconds(metadata.durationSeconds);
      setFile(nextFile);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This media cannot be uploaded.");
    }
  };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    await ingestFiles(nextFiles);
  };
  const handleDropFiles = async (event: ReactDragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    await ingestFiles(Array.from(event.dataTransfer?.files ?? []));
  };
  const insertIntoText = (symbol: "#" | "@") => {
    const area = textRef.current;
    const start = area?.selectionStart ?? textBody.length;
    const end = area?.selectionEnd ?? start;
    const before = textBody.slice(0, start);
    const glue = before.length === 0 || /\s$/.test(before) ? "" : " ";
    const next = `${before}${glue}${symbol}${textBody.slice(end)}`.slice(0, CREATE_TEXT_MAX);
    const caret = Math.min(before.length + glue.length + 1, CREATE_TEXT_MAX);
    setTextBody(next);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(caret, caret);
    });
  };
  const submitText = async () => {
    const text = textBody.trim();
    if (audience === "close_friends" && recipientIds.length === 0) {
      toast.error("Select at least one close friend.");
      return;
    }
    if (!text) {
      toast.error("Write something to post.");
      return;
    }
    setTextBusy(true);
    try {
      await createTextMutation.mutateAsync({ text, audience, recipientIds });
      await onPublished();
      setTextBody("");
      writeTextDraft("");
      toast.success("Text post published to your feed.");
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish text post.");
    } finally {
      setTextBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const captionText = caption.trim();
    if (audience === "close_friends" && recipientIds.length === 0) {
      toast.error("Select at least one close friend.");
      return;
    }
    if ((!file && !selectedImages.length) || !captionText || (mediaMode === "photo" && !selectedImages.length)) {
      toast.error(mediaMode === "photo" ? "Add a caption and image first." : "Add a caption and an original video first.");
      return;
    }
    setBusy(true);
    try {
      if (mediaMode === "photo" && selectedImages.length) {
        // Bake any chosen edit-sheet filters into the files via canvas.
        const processed = await Promise.all(
          selectedImages.map(async image =>
            image.filter && image.filter !== "none"
              ? { ...image, file: await applyFilterToImage(image.file, image.filter) }
              : image
          )
        );
        await publishPhoto(processed.map(image => image.file), "", captionText, processed.map(image => image.dimensions), audience, recipientIds);
      } else {
        if (!file) throw new Error("Please choose a video first.");
        await publishVideo(file, kind, "", captionText, undefined, audience, recipientIds);
      }
      await onPublished();
      await Promise.all([mediaHistory.refetch(), textHistory.refetch()]);
      toast.success(mediaMode === "photo" ? "Photo published to your feed." : kind === "SHORT" ? "Short uploaded to your feed." : "Video published to your feed.");
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const modalTitle = mode === "menu" ? "Create" : mode === "text" ? "Post Text" : mode === "thread" ? "Start a Thread" : mediaMode === "photo" ? "Post Image" : kind === "SHORT" ? "Upload Shorts" : "Post Video";
  const authorName = (() => {
    const name = auth.user?.name?.trim();
    return name && !name.includes("@") ? name : "You";
  })();
  const draftExcerpt = textBody.trim().replace(/\s+/g, " ");
  const closeFriendPicker = audience === "close_friends" ? (
    <fieldset className="cp-recipient-picker">
      <legend>Choose who can see this post</legend>
      {closeFriendsQuery.isLoading ? <span className="cp-recipient-state">Loading close friends…</span> : closeFriendsQuery.isError ? <span className="cp-recipient-state is-error">Could not load close friends.</span> : closeFriendsQuery.data?.length ? (
        <div className="cp-recipient-list">
          {closeFriendsQuery.data.map(friend => {
            const selected = recipientIds.includes(friend.id);
            return (
              <label key={friend.id} className={`cp-recipient${selected ? " is-selected" : ""}`}>
                <input type="checkbox" checked={selected} onChange={() => setRecipientIds(current => selected ? current.filter(id => id !== friend.id) : [...current, friend.id])} />
                <span className="cp-recipient-avatar">{(friend.name || friend.username || "?").charAt(0).toUpperCase()}</span>
                <span><strong>{friend.name || friend.username || `User ${friend.id}`}</strong>{friend.username ? <small>@{friend.username}</small> : null}</span>
              </label>
            );
          })}
        </div>
      ) : <span className="cp-recipient-state">Add close friends first, then choose recipients.</span>}
      <small className="cp-recipient-help">{recipientIds.length} selected</small>
    </fieldset>
  ) : null;
  const maxClip = kind === "SHORT" ? MAX_SHORT_VIDEO_DURATION_SECONDS : MAX_LONG_VIDEO_DURATION_SECONDS;
  const limitLabel = kind === "SHORT" ? "1 min" : "30 min";
  const mediaReady = (mediaMode === "photo" ? selectedImages.length > 0 : Boolean(file)) && caption.trim().length > 0;
  const checkedSteps = (mediaMode === "photo" ? selectedImages.length : file ? 1 : 0) ? 1 : 0;

  // Facebook-style media edit sheet (trim for video, filters for both).
  const trimDuration = clipSeconds ?? 0;
  const effectiveTrimEnd = trimEnd ?? trimDuration;
  const activeFilter = editingVideo
    ? videoFilter
    : (selectedImages[editingPhotoIndex]?.filter ?? "none");
  const editSheet = !editSheetOpen ? null : (
    <div className="cp-edit-sheet-backdrop" onClick={() => setEditSheetOpen(false)}>
      <div
        className="cp-edit-sheet"
        role="dialog"
        aria-label={editingVideo ? "Edit video" : "Edit photo"}
        onClick={event => event.stopPropagation()}
      >
        <div className="cp-edit-sheet-head">
          <strong>{editingVideo ? "Edit video" : "Edit photo"}</strong>
          <button type="button" className="cp-edit-sheet-close" onClick={() => setEditSheetOpen(false)} aria-label="Close editor">
            <X size={18} />
          </button>
        </div>
        {editingVideo && trimDuration > 0 ? (
          <div className="cp-trim">
            <div className="cp-trim-row">
              <span>Start</span>
              <input
                type="range" min={0} max={Math.round(trimDuration)} step={1}
                value={Math.min(trimStart, Math.round(trimDuration))}
                onChange={event => setTrimStart(Math.min(Number(event.target.value), effectiveTrimEnd))}
                aria-label="Trim start"
              />
              <b>{formatClipDuration(trimStart)}</b>
            </div>
            <div className="cp-trim-row">
              <span>End</span>
              <input
                type="range" min={0} max={Math.round(trimDuration)} step={1}
                value={Math.round(effectiveTrimEnd)}
                onChange={event => setTrimEnd(Math.max(Number(event.target.value), trimStart))}
                aria-label="Trim end"
              />
              <b>{formatClipDuration(effectiveTrimEnd)}</b>
            </div>
            <div className="cp-trim-bar" aria-hidden="true">
              <div
                className="cp-trim-seg"
                style={{
                  left: `${(trimStart / trimDuration) * 100}%`,
                  width: `${(Math.max(0, effectiveTrimEnd - trimStart) / trimDuration) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        <div className="cp-filter-label">Filters</div>
        <div className="cp-filters" role="radiogroup" aria-label="Filters">
          {MEDIA_FILTERS.map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={activeFilter === option.css}
              className={`cp-fchip${activeFilter === option.css ? " is-on" : ""}`}
              onClick={() => {
                if (editingVideo) {
                  setVideoFilter(option.css);
                } else {
                  const target = editingPhotoIndex;
                  setSelectedImages(current =>
                    current.map((image, i) => (i === target ? { ...image, filter: option.css } : image))
                  );
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="cp-submit" onClick={() => setEditSheetOpen(false)}>
          Done
        </button>
      </div>
    </div>
  );

  const cards: Array<{
    id: string;
    title: string;
    description: string;
    tone: string;
    icon: ReactNode;
    run?: () => void;
  }> = [
    { id: "photo", title: "Photo", description: "JPG, PNG or WEBP up to 5 MB", tone: "amber", icon: <ImagePlus size={22} />, run: () => chooseMedia("photo") },
    { id: "video", title: "Video", description: "Original video, up to 30 min", tone: "cyan", icon: <Video size={22} />, run: () => chooseMedia("video", "LONG") },
    { id: "short", title: "Short", description: "Vertical clip, up to 1 min", tone: "violet", icon: <Film size={22} />, run: () => chooseMedia("video", "SHORT") },
    { id: "text", title: "Text", description: "Share a thought, up to 5,000 characters", tone: "green", icon: <FileText size={22} />, run: () => chooseMode("text") },
    { id: "thread", title: "Thread", description: "Start a conversation with your community", tone: "green", icon: <MessageCircle size={22} />, run: () => chooseMode("thread") },
    { id: "live", title: "Go Live", description: "Live streaming is on the way", tone: "coral", icon: <Radio size={22} /> },
  ];

  return (
    <ActionModal title={modalTitle} open={open} onClose={close} className="upload-video-modal create-uploader-modal create-post-modal">
      <button type="button" className="create-uploader-close" onClick={safeClick(close)} aria-label="Close Create uploader">
        <X size={24} />
      </button>
      {mode === "menu" ? (
        <>
          <div className="create-uploader-intro">
            <p className="eyebrow">Share something new</p>
            <h2>Create on JHILIK</h2>
            <p>Choose a format and continue directly into its publishing workflow.</p>
          </div>
          {draftExcerpt ? (
            <button type="button" className="cp-draft-card" onClick={safeClick(() => chooseMode("text"))}>
              <span className="cp-draft-icon"><PenLine size={20} /></span>
              <span className="cp-draft-copy">
                <strong>Continue your draft</strong>
                <span>{draftExcerpt}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ) : null}
          <div className="cp-grid" aria-label="Create options">
            {cards.map(card => (
              <button
                key={card.id}
                type="button"
                className={`cp-card cp-card--${card.tone}${card.run ? "" : " is-soon"}`}
                disabled={!card.run}
                onClick={card.run ? safeClick(card.run) : undefined}
              >
                <span className="cp-card-icon">{card.icon}</span>
                <span className="cp-card-copy">
                  <strong>{card.title}</strong>
                  <span>{card.description}</span>
                </span>
                {card.run ? null : <span className="cp-soon-badge">Soon</span>}
              </button>
            ))}
          </div>
          <UploaderHistory media={mediaHistory.data ?? []} textPosts={textHistory.data ?? []} />
        </>
      ) : mode === "text" ? (
        <div className="cp-composer">
          <div className="cp-bar">
            <button type="button" className="cp-back" onClick={safeClick(() => setMode("menu"))} aria-label="Back to create menu">
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="cp-publish"
              disabled={textBusy || !textBody.trim()}
              onClick={safeClick(submitText)}
            >
              {textBusy ? "Publishing…" : "Publish"}
            </button>
          </div>
          <div className="cp-author">
            <span className="cp-avatar" aria-hidden="true">{authorName.charAt(0).toUpperCase()}</span>
            <span className="cp-author-copy">
              <strong>{authorName}</strong>
              <span>{audience === "close_friends" ? "Visible to close friends" : "Visible to everyone"}</span>
            </span>
          </div>
          <div className="cp-editor">
            <div className="cp-editor-text cp-editor-mirror" aria-hidden="true">
              <HighlightedDraft text={textBody} />
            </div>
            <textarea
              ref={textRef}
              className="cp-editor-text cp-editor-input"
              value={textBody}
              onChange={event => setTextBody(event.target.value)}
              placeholder="What's on your mind?"
              aria-label="Write your post"
              maxLength={CREATE_TEXT_MAX}
              rows={1}
              autoFocus
            />
          </div>
          <p className="cp-draft-status" role="status">
            {textBody.trim() ? (draftSaved ? "Draft saved" : "Saving draft…") : "Your draft is saved automatically."}
          </p>
          <div className="cp-toolbar">
            <button type="button" aria-label="Add hashtag" onClick={safeClick(() => insertIntoText("#"))}><Hash size={20} /></button>
            <button type="button" aria-label="Mention someone" onClick={safeClick(() => insertIntoText("@"))}><AtSign size={20} /></button>
            <span className="cp-toolbar-spacer" />
            <span className="cp-count">{textBody.length} / {CREATE_TEXT_MAX}</span>
            <CharacterRing used={textBody.length} max={CREATE_TEXT_MAX} />
          </div>
          <label className="cp-audience-picker">Audience
            <select value={audience} onChange={event => setAudience(event.target.value as "everyone" | "close_friends")}>
              <option value="everyone">Everyone</option>
              <option value="close_friends">Close Friends</option>
            </select>
          </label>
          {closeFriendPicker}
        </div>
      ) : mode === "thread" ? (
        <div className="create-uploader-composer">
          <p className="modal-intro">Start a conversation with your community.</p>
          <CommunityAnnouncements />
        </div>
      ) : (
        <>
          <form className="cp-media" onSubmit={submit}>
          <div className="cp-bar">
            <button type="button" className="cp-back" onClick={safeClick(() => setMode("menu"))} aria-label="Back to create menu">
              <ChevronLeft size={22} />
            </button>
          </div>
          <div className="cp-segment" role="tablist" aria-label="Media type">
            <button type="button" role="tab" aria-selected={mediaMode === "video"} className={mediaMode === "video" ? "active" : ""} onClick={safeClick(() => chooseMedia("video", kind))}>Video</button>
            <button type="button" role="tab" aria-selected={mediaMode === "photo"} className={mediaMode === "photo" ? "active" : ""} onClick={safeClick(() => chooseMedia("photo"))}>Photo</button>
          </div>
          {mediaMode === "video" && (
            <div className="cp-kind" role="tablist" aria-label="Video type">
              <button type="button" role="tab" aria-selected={kind === "LONG"} className={kind === "LONG" ? "active" : ""} onClick={safeClick(() => switchVideoKind("LONG"))}>Video · up to 30 min</button>
              <button type="button" role="tab" aria-selected={kind === "SHORT"} className={kind === "SHORT" ? "active" : ""} onClick={safeClick(() => switchVideoKind("SHORT"))}>Short · up to 1 min</button>
            </div>
          )}
          <input ref={inputRef} type="file" multiple={mediaMode === "photo"} accept={mediaMode === "photo" ? "image/jpeg,image/png,image/webp" : "video/*"} className="sr-only" onChange={selectFile} />
          {(mediaMode === "photo" && selectedImages.length > 0) || (mediaMode === "video" && file && previewUrl) ? (
            <div className="cp-picked">
              <div className={`cp-preview${mediaMode === "video" && kind === "SHORT" ? " is-vertical" : ""}`}>
                {mediaMode === "photo" ? (
                  <img
                    src={selectedImages[0].previewUrl}
                    alt={`Selected image 1 of ${selectedImages.length}`}
                    style={selectedImages[0].filter && selectedImages[0].filter !== "none" ? { filter: selectedImages[0].filter } : undefined}
                  />
                ) : (
                  <video
                    src={previewUrl ?? undefined}
                    muted
                    playsInline
                    preload="metadata"
                    style={videoFilter !== "none" ? { filter: videoFilter } : undefined}
                    onTimeUpdate={clampTrimPlayback}
                  />
                )}
                {mediaMode === "photo" && selectedImages.length > 1 ? <span className="cp-gallery-count">{selectedImages.length} photos · swipe after publishing</span> : null}
                {clipSeconds != null ? <span className="cp-duration">{formatClipDuration(clipSeconds)}</span> : null}
                {mediaMode === "video" && file ? <span className="cp-size-badge">{formatFileSize(file.size)}</span> : null}
                <button type="button" className="cp-thumb-remove" onClick={safeClick(clearMedia)} disabled={busy} aria-label={mediaMode === "photo" ? "Remove all images" : "Remove video"}>
                  <X size={14} />
                </button>
                <button
                  type="button"
                  className="cp-editbtn"
                  onClick={safeClick(() => (mediaMode === "video" ? openVideoEditor() : openPhotoEditor(0)))}
                  disabled={busy}
                  aria-label={mediaMode === "photo" ? "Edit first photo" : "Edit video"}
                >
                  <PenLine size={14} /> Edit
                </button>
              </div>
              {mediaMode === "photo" ? (
                <div className="cp-image-strip" aria-label="Selected images">
                  {selectedImages.map((image, index) => (
                    <span className="cp-image-thumb-wrap" key={`${image.file.name}-${index}`}>
                      <button type="button" className={`cp-image-thumb${index === 0 ? " is-selected" : ""}`} onClick={safeClick(() => setSelectedImages(current => [image, ...current.filter(item => item !== image)]))} aria-label={`Move image ${index + 1} to first`}>
                        <img src={image.previewUrl} alt="" style={image.filter && image.filter !== "none" ? { filter: image.filter } : undefined} />
                      </button>
                      <button type="button" className="cp-thumb-remove cp-thumb-remove--sm" onClick={safeClick(() => removeSelectedImage(index))} disabled={busy} aria-label={`Remove image ${index + 1}`}>
                        <X size={12} />
                      </button>
                      <button type="button" className="cp-editbtn cp-editbtn--sm" onClick={safeClick(() => openPhotoEditor(index))} disabled={busy} aria-label={`Edit image ${index + 1}`}>
                        <PenLine size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="cp-picked-info">
                <strong title={mediaMode === "photo" ? selectedImages[0].file.name : file?.name}>{mediaMode === "photo" ? `${selectedImages.length} image${selectedImages.length === 1 ? "" : "s"} selected` : file?.name}</strong>
                <span>{formatFileSize(mediaMode === "photo" ? selectedImages.reduce((sum, image) => sum + image.file.size, 0) : file?.size ?? 0)}</span>
                {mediaMode === "video" && clipSeconds != null && clipSeconds <= maxClip ? (
                  <span className="cp-ok"><Check size={14} /> Within the {limitLabel} limit</span>
                ) : null}
                <div className="cp-picked-actions">
                  <button type="button" onClick={safeClick(() => inputRef.current?.click())} disabled={busy}><RefreshCw size={15} /> {mediaMode === "photo" ? "Add / replace" : "Replace"}</button>
                  <button type="button" className="is-danger" onClick={safeClick(clearMedia)} disabled={busy}><Trash2 size={15} /> Remove</button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`cp-drop${isDragging ? " is-dragging" : ""}`}
              onClick={safeClick(() => inputRef.current?.click())}
              onDragOver={event => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={event => void handleDropFiles(event)}
              aria-label={mediaMode === "photo" ? "Drop photos here or browse" : "Drop a video here or browse"}
            >
              <span className="cp-drop-icon" aria-hidden="true">
                {mediaMode === "photo" ? <ImagePlus size={20} /> : <Video size={20} />}
              </span>
              <span className="cp-drop-text">
                <strong>{mediaMode === "photo" ? (<>Drop photos here or <b>browse</b></>) : (<>Drop video here or <b>browse</b></>)}</strong>
                <span>{mediaMode === "photo" ? "JPG, PNG, WEBP · up to 20" : `Video · up to ${limitLabel}`}</span>
              </span>
              <span className="cp-drop-arrow" aria-hidden="true">→</span>
            </button>
          )}
          <div className="cp-field">
            <label htmlFor="cp-caption">Caption</label>
            <textarea
              id="cp-caption"
              value={caption}
              onChange={event => setCaption(event.target.value)}
              placeholder={kind === "SHORT" && mediaMode === "video" ? "Describe your Short" : "What's on your mind?"}
              maxLength={CREATE_CAPTION_MAX}
              rows={4}
              required
            />
            <div className="cp-field-foot">
              <span>Required. Tag people with @ and topics with #.</span>
              <span className="cp-count">{caption.length} / {CREATE_CAPTION_MAX}</span>
            </div>
          </div>
          <label className="cp-audience-picker">Audience
            <select value={audience} onChange={event => setAudience(event.target.value as "everyone" | "close_friends")}>
              <option value="everyone">Everyone</option>
              <option value="close_friends">Close Friends</option>
            </select>
          </label>
          {closeFriendPicker}
          <div className="cp-footer">
            <ol className="cp-steps" aria-label="Upload progress">
              {["Checked", "Uploading", "Published"].map((label, index) => (
                <li key={label} className={index < checkedSteps ? "is-done" : busy && index === 1 ? "is-current" : ""}>
                  <span className="cp-step-dot">{index < checkedSteps ? <Check size={11} /> : null}</span>
                  {label}
                </li>
              ))}
            </ol>
            <button className="cp-submit" type="submit" disabled={busy || !mediaReady}>
              {busy ? "Uploading…" : mediaMode === "photo" ? "Publish image" : kind === "SHORT" ? "Upload Short" : "Publish video"}
            </button>
          </div>
        </form>
          {editSheet}
        </>
      )}
    </ActionModal>
  );
}

function SearchModal({ open, onClose, onOpenVideo }: { open: boolean; onClose: () => void; onOpenVideo?: (video: VideoRecord) => void }) {
  return (
    <ActionModal title="Search JHILIK" open={open} onClose={onClose} className="search-action-modal">
      <SearchFeed onOpenVideo={onOpenVideo} />
    </ActionModal>
  );
}

function NotificationDrawer({
  open,
  onClose,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
}) {
  return (
    <ActionModal title="Notifications" open={open} onClose={onClose} className="notification-action-drawer">
      <NotificationsPanel enabled={enabled} />
    </ActionModal>
  );
}

function ActivityModal({
  open,
  onClose,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
}) {
  return (
    <ActionModal title="Activity Center" open={open} onClose={onClose}>
      <p className="modal-intro">Track the reactions, comments, shares, and follows that matter to your JHILIK account.</p>
      <NotificationsPanel enabled={enabled} />
    </ActionModal>
  );
}

function OfflineVideosModal({
  open,
  onClose,
  onBrowse,
}: {
  open: boolean;
  onClose: () => void;
  onBrowse: () => void;
}) {
  return (
    <ActionModal title="Saved" open={open} onClose={onClose}>
      <OfflineVideosPanel onBrowse={onBrowse} />
    </ActionModal>
  );
}

function QRCodeModal({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile?: ProfileSnapshot;
}) {
  return (
    <ActionModal title="Your QR Code" open={open} onClose={onClose}>
      <QrPanel profile={profile} />
    </ActionModal>
  );
}

function CreatorStudioModal({
  open,
  onClose,
  profile,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  profile?: ProfileSnapshot;
  onCreate: () => void;
}) {
  const stats = profile?.stats;
  const [tab, setTab] = useState<StudioTab>("create");
  // Reset to the first tab whenever the studio is opened.
  useEffect(() => {
    if (open) setTab("create");
  }, [open]);
  const tabs: Array<{ id: StudioTab; label: string; icon: typeof Plus }> = [
    { id: "create", label: "Create", icon: Plus },
    { id: "content", label: "Content", icon: Film },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "earnings", label: "Earnings", icon: WalletCards },
  ];
  return (
    <ActionModal
      title="JHILIK Studio"
      open={open}
      onClose={onClose}
      className="studio-action-modal"
    >
      <div className="studio-tabs" role="tablist" aria-label="Studio sections">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "on" : ""}
              onClick={() => setTab(t.id)}
            >
              <Icon size={15} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "create" ? (
        <>
          <p className="modal-intro">Manage your publishing momentum from one creator workspace.</p>
          <div className="studio-stat-grid">
            <div><strong>{stats?.followersCount ?? 0}</strong><span>Followers</span></div>
            <div><strong>{stats?.reactionsReceived ?? 0}</strong><span>Pookies</span></div>
            <div><strong>{stats?.iconsCount ?? 0}</strong><span>ICONS</span></div>
          </div>
          <button
            type="button"
            className="primary-btn"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
              onCreate();
            }}
          >
            <Plus size={18} /> Upload new video
          </button>
        </>
      ) : null}

      {tab === "content" ? <StudioContentTab /> : null}
      {tab === "analytics" ? <ContentAnalytics /> : null}
      {tab === "earnings" ? <StudioEarningsTab /> : null}
    </ActionModal>
  );
}

type StudioTab = "create" | "content" | "analytics" | "earnings";

/** Own published content — every account type. Honest empty state. */
function StudioContentTab() {
  const videos = trpc.profile.videos.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows = videos.data ?? [];
  if (videos.isLoading) {
    return <p className="profile-loading-note">Loading your content…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="an-empty" role="status">
        <Film size={28} aria-hidden="true" />
        <p>
          <strong>No content yet.</strong>
          <br />
          Publish your first video, photo, or post to see it here.
        </p>
      </div>
    );
  }
  return (
    <div className="an-card">
      <b>Your content</b>
      <div className="an-table" role="table" aria-label="Your published content">
        <div className="an-thead" role="row">
          <span>Post</span>
          <span>Type</span>
          <span>Views</span>
        </div>
        {rows.map(v => (
          <div className="an-trow" role="row" key={v.id}>
            <span className="an-post">
              <span>{v.title || `Post #${v.id}`}</span>
            </span>
            <span>{v.mediaType ?? "—"}</span>
            <span>{(v.viewCount ?? 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Own campaign earnings — fiat ledger, honest empty state. */
function StudioEarningsTab() {
  const earnings = trpc.submissions.myEarnings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows = earnings.data ?? [];
  if (earnings.isLoading) {
    return <p className="profile-loading-note">Loading your earnings…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="an-empty" role="status">
        <WalletCards size={28} aria-hidden="true" />
        <p>
          <strong>No earnings yet.</strong>
          <br />
          Approved campaign submissions show up here.
        </p>
      </div>
    );
  }
  const symbolFor = (currency: string | null) =>
    (currency ?? "").toUpperCase() === "BDT" ? "৳" : "$";
  return (
    <div className="an-card">
      <b>Your earnings</b>
      <div className="an-table" role="table" aria-label="Your campaign earnings">
        <div className="an-thead" role="row">
          <span>Campaign</span>
          <span>Amount</span>
          <span>Status</span>
        </div>
        {rows.map(row => (
          <div className="an-trow" role="row" key={row.id}>
            <span className="an-post">
              <span>{row.campaignTitle}</span>
            </span>
            <b>
              {symbolFor(row.currency)}
              {Number(row.amount).toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </b>
            <span className={`an-status ${row.status}`}>{row.status}</span>
          </div>
        ))}
      </div>
      <p className="an-fine">Fiat ledger — recorded when a submission is approved.</p>
    </div>
  );
}

function AnnouncementsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ActionModal title="Business Announcements" open={open} onClose={onClose} className="announcements-action-modal">
      <CommunityAnnouncements />
    </ActionModal>
  );
}

function QrPanel({ profile }: { profile?: ProfileSnapshot }) {
  const [copied, setCopied] = useState(false);
  const username = profile?.profile?.username?.trim();
  const shareUrl =
    typeof window === "undefined"
      ? "/profile"
      : `${window.location.origin}/profile${username ? `?user=${encodeURIComponent(username)}` : ""}`;
  const copyLink = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section
      className="media-section utility-section qr-panel"
      aria-labelledby="qr-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Identity card</p>
          <h2 id="qr-heading">Share your JHILIK profile.</h2>
        </div>
        <QrCode size={24} aria-hidden="true" />
      </div>
      <div className="qr-share-card">
        <div className="qr-mark">
          <img
            src={
              "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=" +
              encodeURIComponent(shareUrl)
            }
            alt="QR code for your JHILIK profile"
          />
        </div>
        <div>
          <strong>{profileDisplayName(profile)}</strong>
          <span>{username ? `@${username}` : "Your public profile"}</span>
        </div>
        <button type="button" className="primary-btn" onClick={copyLink}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Link copied" : "Copy profile link"}
        </button>
      </div>
      <p className="utility-note">
        Share the link anywhere people gather. Your profile stays public and
        easy to find.
      </p>
    </section>
  );
}

function OfflineVideosPanel({ onBrowse }: { onBrowse: () => void }) {
  const saved = trpc.videos.bookmarked.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  return (
    <section
      className="media-section utility-section offline-panel"
      aria-labelledby="offline-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Personal library</p>
          <h2 id="offline-heading">Saved.</h2>
        </div>
        <Film size={24} aria-hidden="true" />
      </div>
      {saved.isPending ? (
        <div className="utility-loading" aria-busy="true">
          Loading your saved library…
        </div>
      ) : saved.isError ? (
        <div className="media-empty" role="alert">
          <Film size={24} />
          <h3>Your saved items are unavailable.</h3>
          <p>We could not reach your saved library. Try again.</p>
          <button
            type="button"
            className="muted-btn"
            onClick={() => saved.refetch()}
          >
            Retry
          </button>
        </div>
      ) : saved.data?.length ? (
        <div className="offline-video-list" aria-label="Saved items">
          {saved.data.map(video => (
            <a
              className="offline-video-item"
              href="/?panel=videos"
              key={video.id}
            >
              <div className="offline-video-thumb">
                {video.thumbnailUrl ? (
                  <img src={video.thumbnailUrl} alt="" />
                ) : (
                  <Film size={20} />
                )}
              </div>
              <span>
                <strong>{video.title}</strong>
                <small>
                  {video.owner.name ?? video.owner.username ?? "JHILIK creator"}{" "}
                  · {new Date(video.createdAt).toLocaleDateString()}
                </small>
              </span>
              <Play size={16} aria-hidden="true" />
            </a>
          ))}
          <button type="button" className="primary-btn" onClick={onBrowse}>
            Browse feed
          </button>
        </div>
      ) : (
        <div className="media-empty">
          <Film size={24} />
          <h3>Nothing saved yet.</h3>
          <p>Use Save on any post, photo, or video to keep it in this library.</p>
          <button type="button" className="primary-btn" onClick={onBrowse}>
            Browse feed
          </button>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const auth = useAuth();
  const { isScrollingDown } = useScrollDirection();
  const utils = trpc.useUtils();
  const topNavRef = useRef<HTMLDivElement>(null);
  const [location, navigate] = useLocation();
  const publicProfileId = parsePublicProfileRoute(location);
  const publicProfileUsername = parseUsernameProfileRoute(location);
  const onPublicProfileRoute = isPublicProfileRoute(location);
  const { theme } = useTheme();
  const [activeView, setActiveView] = useState<FeedSection>("videos");
  const [activeModal, setActiveModal] = useState<AppModal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(() => location === "/profile");
  const [initialShortId, setInitialShortId] = useState<number | null>(null);
  const [initialShortVideo, setInitialShortVideo] = useState<VideoRecord | null>(null);
  const [photoViewer, setPhotoViewer] = useState<VideoRecord | null>(null);
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated && !onPublicProfileRoute,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const publicProfileQuery = trpc.profile.byId.useQuery(
    { userId: publicProfileId as number },
    { enabled: Boolean(publicProfileId), refetchOnWindowFocus: false, staleTime: 30_000 }
  );
  const publicProfileUsernameQuery = trpc.profile.byUsername.useQuery(
    { username: publicProfileUsername as string },
    { enabled: Boolean(publicProfileUsername), refetchOnWindowFocus: false, staleTime: 30_000 }
  );
  const unreadCountQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    refetchInterval: auth.isAuthenticated ? 15_000 : false,
  });
  const dmUnreadCountQuery = trpc.directMessages.getUnreadMessageCount.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
    refetchInterval: auth.isAuthenticated ? 15_000 : false,
  });
  const notificationCount = Math.min(unreadCountQuery.data ?? 0, 99);
  const dmUnreadCount = Math.min(dmUnreadCountQuery.data ?? 0, 99);
  // Public route: only a snapshot whose own user.id equals the id in the URL
  // may be rendered — a cached or stale snapshot never substitutes for it.
  const cachedPublicProfile = publicProfileQuery.data;
  const publicProfileData = matchesRouteProfile(cachedPublicProfile, publicProfileId)
    ? cachedPublicProfile
    : undefined;
  const cachedUsernameProfile = publicProfileUsernameQuery.data;
  const usernameProfileData = onPublicProfileRoute && publicProfileUsername
    ? cachedUsernameProfile
    : undefined;
  const ownProfileData = profileQuery.data;
  const profile = (onPublicProfileRoute
    ? (publicProfileData ?? usernameProfileData)
    : ownProfileData) as ProfileSnapshot | undefined;
  const profileForHeader = profile;
  // Ownership follows the route id, not whatever snapshot is in cache.
  const isOwner = Boolean(
    auth.user?.id &&
      (onPublicProfileRoute
        ? (publicProfileId === auth.user.id || (usernameProfileData?.user.id === auth.user.id))
        : profileForHeader?.user?.id === auth.user.id)
  );
  const publicProfileLoading =
    onPublicProfileRoute &&
    (publicProfileId !== undefined || publicProfileUsername !== undefined) &&
    !publicProfileData &&
    !usernameProfileData &&
    !publicProfileQuery.isError &&
    !publicProfileUsernameQuery.isError &&
    (publicProfileQuery.isPending || publicProfileUsernameQuery.isPending);
  const screen: Screen =
    location === "/login"
      ? "landing"
      : onPublicProfileRoute || profileOpen
        ? "profile"
        : "dashboard";

  useEffect(() => {
    if (location === "/profile") setProfileOpen(true);
  }, [location]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Clear initialShortId when navigating away from shorts tab
  useEffect(() => {
    if (activeView !== "shorts") setInitialShortId(null);
  }, [activeView]);

  // The app chrome is a real fixed element; its actual height is the source of
  // truth for every viewport offset (feed clearance, Shorts stage) instead of
  // hardcoded 104/112/114px compensation. Publish the measured height once and
  // keep it in sync while the chrome's content (header + tab strip) changes.
  useEffect(() => {
    const el = topNavRef.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => {
      const height = Math.round(el.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty("--kinba-chrome-h", `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [screen]);

  const showFeed = (next: FeedSection = "videos") => {
    setProfileOpen(false);
    setActiveView(next);
    setActiveModal(null);
  };
  const goHome = () => {
    showFeed("videos");
    setMenuOpen(false);
    if (location !== "/") navigate("/");
  };
  const openModal = (modal: Exclude<AppModal, null>) => {
    setMenuOpen(false);
    setActiveModal(modal);
  };
  const showNotifications = () => {
    setProfileOpen(false);
    setActiveView("notifications");
    setActiveModal(null);
  };
  const openProfile = () => {
    setActiveModal(null);
    setMenuOpen(false);
    setProfileOpen(true);
    if (location !== "/profile") navigate("/profile");
  };
  const closeProfile = () => {
    setProfileOpen(false);
    if (onPublicProfileRoute || location === "/profile") navigate("/");
  };
  const selectDrawerAction = (next: DrawerAction) => {
    if (next === "profile") {
      openProfile();
      return;
    }
    if (next === "settings") {
      setMenuOpen(false);
      navigate("/settings");
      return;
    }
    if (next === "advertise") {
      setMenuOpen(false);
      navigate("/advertise");
      return;
    }
    if (next === "studio") {
      setMenuOpen(false);
      setActiveModal(null);
      navigate("/studio");
      return;
    }
    openModal(next);
  };
  const logout = async () => {
    try {
      await auth.logout();
      Object.keys(window.localStorage)
        .filter(key => key.startsWith("sb-") || key.startsWith("kinba-auth"))
        .forEach(key => window.localStorage.removeItem(key));
      setMenuOpen(false);
      setActiveModal(null);
      setProfileOpen(false);
      setActiveView("videos");
      navigate("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to log out.");
    }
  };
  const authDialog = auth.authDialogOpen && !auth.isAuthenticated ? (
    <SupabaseAuthDialog
      open
      onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
    />
  ) : null;
  if (screen === "landing")
    return (
      <>
        <div
        className="kinba-app guest-layout max-w-vw overflow-x-hidden box-border"
        onClick={guardNonSubmitNavigation}
      >
          <Landing onLogin={auth.openAuth} />
        </div>
        {authDialog}
      </>
    );
  return (
    <>
      <div
        className="kinba-app max-w-vw overflow-x-hidden box-border"
        onClick={guardNonSubmitNavigation}
      >
        <div
          ref={topNavRef}
          className={`top-navigation-wrapper fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${
            screen === "dashboard" && isScrollingDown
              ? "-translate-y-full"
              : "translate-y-0"
          } ${screen === "profile" ? "top-nav--profile" : "bg-[#0B0F17]/95 backdrop-blur-md"} `}
        >
          <AppHeader
            profile={profileForHeader}
            notificationCount={notificationCount}
            onHome={() => showFeed("videos")}
            onSelectFeed={showFeed}
            onOpenModal={openModal}
            onMenu={() => setMenuOpen(value => !value)}
            onProfile={openProfile}
            onLogout={logout}
          />
          {screen === "dashboard" && (
            <FeedTabs activeSection={activeView} onSectionChange={showFeed} />
          )}
        </div>
        <main
          className={`app-main-content max-w-vw overflow-x-hidden box-border ${
            screen === "dashboard" ? "has-feed-tabs" : ""
          } ${screen === "profile" ? "screen-profile" : ""} ${
            screen === "dashboard" && isScrollingDown ? "chrome-collapsed" : ""
          }`}
        >
          {screen === "dashboard" ? (
            <section className="section-shell home-page">
              {activeView === "notifications" ? (
                <NotificationsPanel enabled={auth.isAuthenticated} />
              ) : activeView === "settings" ? (
                <SettingsPanel onLogout={logout} />
              ) : (
                <MediaHub
                  section={activeView}
                  onSectionChange={showFeed}
                  showTabs={false}
                  initialShortId={initialShortId ?? undefined}
                  initialShortVideo={initialShortVideo ?? undefined}
                  onBack={() => setActiveView("videos")}
                  onOpenShort={(v) => {
                    setInitialShortId(v.id);
                    setInitialShortVideo(v);
                    setActiveView("shorts");
                  }}
                />
              )}
            </section>
          ) : publicProfileLoading ? (
            // Public route with no matching snapshot yet: neutral skeleton,
            // never the viewer's own profile.
            <ProfileSkeleton />
          ) : (
            <ProfileView
              profile={profileForHeader}
              isOwner={isOwner}
              isAuthenticated={auth.isAuthenticated}
              isAdmin={auth.user?.role === "admin"}
              userId={publicProfileId ?? usernameProfileData?.user.id}
              onBack={closeProfile}
              onOpenShort={(id) => { setInitialShortId(id); setActiveView("shorts"); }}
              onOpenPhoto={setPhotoViewer}
              onOpenVideo={(v) => {
                setInitialShortId(v.id);
                setInitialShortVideo(v);
                setActiveView("shorts");
              }}
              ownerTools={
                <>
                  <GetVerifiedPanel />
                  {auth.user?.role === "admin" && <AdminVerificationPanel />}
                </>
              }
            />
          )}
        </main>
        {menuOpen && (
          <MobileDrawer
            open
            onClose={() => setMenuOpen(false)}
            profile={profile}
            onNavigate={selectDrawerAction}
            onLogout={logout}
          />
        )}
        {activeModal === "wallet" && <WalletModal open onClose={() => setActiveModal(null)} />}
        {activeModal === "upload" && (
          <UploadVideoModal
            open
            onClose={() => setActiveModal(null)}
            onPublished={async () => {
              await Promise.all([
                utils.home.feed.invalidate(),
                utils.videos.list.invalidate(),
              ]);
            }}
          />
        )}
        {activeModal === "search" && <SearchModal open onClose={() => setActiveModal(null)} onOpenVideo={(v) => {
          setInitialShortId(v.id);
          setInitialShortVideo(v);
          setActiveView("shorts");
          setActiveModal(null);
        }} />}
        {activeModal === "notifications" && (
          <NotificationDrawer open onClose={() => setActiveModal(null)} enabled={auth.isAuthenticated} />
        )}
        {activeModal === "activity" && (
          <ActivityModal open onClose={() => setActiveModal(null)} enabled={auth.isAuthenticated} />
        )}
        {activeModal === "offline" && (
          <OfflineVideosModal open onClose={() => setActiveModal(null)} onBrowse={() => showFeed("videos")} />
        )}
        {activeModal === "qr" && (
          <QRCodeModal open onClose={() => setActiveModal(null)} profile={profile} />
        )}
        {activeModal === "studio" && (
          <CreatorStudioModal
            open
            onClose={() => setActiveModal(null)}
            profile={profile}
            onCreate={() => openModal("upload")}
          />
        )}
        {activeModal === "announcements" && (
          <AnnouncementsModal open onClose={() => setActiveModal(null)} />
        )}
        {photoViewer && (
          <FeedPhotoLightbox
            imageUrl={photoViewer.videoUrl}
            attachments={(photoViewer.gallery ?? []).map((image, imageIndex) => ({
              id: imageIndex,
              mediaType: "IMAGE" as const,
              mediaUrl: image.url,
              sortOrder: imageIndex,
              width: image.width,
              height: image.height,
            }))}
            alt={photoViewer.title || "Post"}
            owner={photoViewer.owner}
            engagementVideo={photoViewer}
            onClose={() => setPhotoViewer(null)}
          />
        )}
        <BottomNavigation
          className={
            screen === "dashboard" && isScrollingDown
              ? "translate-y-full"
              : "translate-y-0"
          }
          activePanel={activeView}
          menuOpen={menuOpen}
          onHome={goHome}
          onOpenHypeRooms={() => navigate("/rooms")}
          onPublish={() => openModal("upload")}
          onMessages={() => navigate("/messages")}
          onMenu={() => setMenuOpen(value => !value)}
          dmUnreadCount={dmUnreadCount}
        />
      </div>
      {authDialog}
    </>
  );
}
