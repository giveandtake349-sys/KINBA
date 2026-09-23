import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  BadgeCheck,
  Bell,
  Check,
  FileText,
  Radio,
  Clock3,
  Copy,
  Coins,
  Film,
  Home as HomeIcon,
  ImagePlus,
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
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import {
  getImageDimensions,
  getVideoMetadata,
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
  publishPhoto,
  publishVideo,
  uploadImage,
} from "@/lib/mediaUpload";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import MediaHub, {
  CommunityAnnouncements,
  SearchFeed,
  type FeedSection,
  type VideoRecord,
  FeedPhotoLightbox,
} from "@/components/MediaHub";
import ProfileView, { ProfileSkeleton } from "@/components/ProfileView";
import "./profile.css";

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
type DrawerAction = Exclude<AppModal, null> | "profile";

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
  } | null;
  stats?: {
    reactionsReceived: number;
    iconsCount: number;
    followingCount: number;
    followersCount: number;
  };
};

function OfficialLogo() {
  return (
    <div className="official-logo">
      <span className="logo-fallback">KINBA</span>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        toggleTheme();
      }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      <span>{theme === "dark" ? "White" : "Dark"}</span>
    </button>
  );
}

function profileDisplayName(profile?: ProfileSnapshot) {
  const name = profile?.user?.name?.trim();
  if (name && !name.includes("@")) return name;
  const username = profile?.profile?.username?.trim();
  return username ? `@${username}` : "KINBA member";
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
  const items = [
    [stats?.reactionsReceived ?? 0, "reactions received"],
    [stats?.iconsCount ?? 0, "icons"],
    [stats?.followingCount ?? 0, "following"],
    [stats?.followersCount ?? 0, "followers"],
  ];
  return (
    <div className="drawer-stat-grid">
      {items.map(([value, label]) => (
        <div className="drawer-stat" key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
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
        <BadgeCheck className="verified-badge" size={17} /> Get Verified
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
                            : "KINBA member"}
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
          section: "activity",
          label: "Activity center",
          description: "Reactions, comments, and follows",
          icon: Bell,
        },
        {
          section: "offline",
          label: "Offline videos",
          description: "Your saved viewing list",
          icon: Film,
        },
        {
          section: "qr",
          label: "QR code",
          description: "Share your KINBA identity",
          icon: QrCode,
        },
      ],
    },
    {
      title: "Creation & business tools",
      items: [
        {
          section: "studio",
          label: "KINBA Studio",
          description: "Publish and manage your work",
          icon: Video,
        },
        {
          section: "announcements",
          label: "Business announcements",
          description: "Reach verified communities",
          icon: Megaphone,
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
            <X size={21} />
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
                      <Icon size={19} />
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
          <button type="button" className="drawer-logout" onClick={safeClick(onLogout)}>
            <LogOut size={19} />
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
        <span className="brand-name">KINBA</span>
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
          onClick={safeClick(() => onOpenModal("upload"))}
          aria-label="Create a video"
          title="Create a video"
        >
          <Plus size={19} />
        </button>
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
          <Menu size={22} />
        </button>
        <ThemeToggle />
        <button type="button" className="logout-btn" onClick={safeClick(onLogout)}>
          <LogOut size={15} />
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
    ["spotlight", "Spotlight"],
    ["shorts", "Shorts"],
  ] as const;

  return (
    <nav className="home-feed-tabs" aria-label="Home feed tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          type="button"
          key={id}
          className={activeSection === id ? "active" : ""}
          onClick={safeClick(() => onSectionChange(id))}
          aria-selected={activeSection === id}
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
  onNotifications,
  onMenu,
}: {
  className?: string;
  activePanel: FeedSection;
  menuOpen: boolean;
  onHome: () => void;
  onOpenHypeRooms: () => void;
  onPublish: () => void;
  onNotifications: () => void;
  onMenu: () => void;
}) {
  const isHome = ["videos", "shorts", "spotlight"].includes(activePanel);
  return (
    <nav
      className={`bottom-navigation fixed left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${className ?? ""}`}
      aria-label="Mobile navigation"
    >
      <button
        type="button"
        className={isHome ? "active" : ""}
        onClick={safeClick(onHome)}
        aria-current={isHome ? "page" : undefined}
      >
        <HomeIcon size={23} />
        <span>Home</span>
      </button>
      <button
        type="button"
        className="bottom-nav-hype-rooms"
        onClick={safeClick(onOpenHypeRooms)}
        aria-label="Hype Rooms"
        title="Hype Rooms"
      >
        <Radio size={23} />
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
        className={activePanel === "notifications" ? "active" : ""}
        onClick={safeClick(onNotifications)}
        aria-current={activePanel === "notifications" ? "page" : undefined}
      >
        <Bell size={23} />
        <span>Notifications</span>
      </button>
      <button
        type="button"
        className={menuOpen ? "active" : ""}
        onClick={safeClick(onMenu)}
        aria-expanded={menuOpen}
      >
        <Menu size={23} />
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
          Publish, explore, and follow the people and organizations shaping what
          comes next.
        </p>
        <button type="button" className="primary-btn" onClick={safeClick(onLogin)}>
          Sign in to Kinba
        </button>
      </div>
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
    }
  );
  const activityQuery = trpc.home.notifications.useQuery(undefined, {
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
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
                Drops and Hype Room alerts will appear here when they happen.
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
                          : item.kind === "comment"
                            ? " commented on your video"
                            : " started following you"}
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
                Reactions, comments, shares, and new followers will appear
                here.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function SettingsPanel({ onLogout }: { onLogout: () => void }) {
  return (
    <section
      className="media-section utility-section"
      aria-labelledby="settings-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2 id="settings-heading">Make KINBA yours.</h2>
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
        <button type="button" className="settings-logout" onClick={safeClick(onLogout)}>
          <LogOut size={17} /> Log out
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
          <h2 id="wallet-heading">Your KINBA wallet.</h2>
        </div>
        <Coins size={22} aria-hidden="true" />
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
        <Clock3 size={17} aria-hidden="true" />
      </div>
      {items.length ? (
        <div className="uploader-history-grid">
          {items.map(item => (
            <article className="uploader-history-card" key={item.key}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" />
              ) : (
                <div className="uploader-history-placeholder" aria-hidden="true">
                  {item.kind === "VIDEO" ? <Video size={22} /> : <FileText size={22} />}
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
  const [file, setFile] = useState<File | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [textBody, setTextBody] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const auth = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!open) setMode("menu");
  }, [open]);

  const close = () => {
    setMode("menu");
    setFile(null);
    setImageDimensions(null);
    setCaption("");
    setTextBody("");
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
    setFile(null);
    setImageDimensions(null);
    chooseMode("media");
  };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile) return;
    try {
      if (mediaMode === "photo") {
        setImageDimensions(await getImageDimensions(nextFile));
        setFile(nextFile);
        return;
      }
      await getVideoMetadata(nextFile, {
        maxDurationSeconds:
          kind === "LONG" ? MAX_LONG_VIDEO_DURATION_SECONDS : MAX_SHORT_VIDEO_DURATION_SECONDS,
      });
      setImageDimensions(null);
      setFile(nextFile);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "This media cannot be uploaded.");
    }
  };
  const submitText = async () => {
    const text = textBody.trim();
    if (!text) {
      toast.error("Write something to post.");
      return;
    }
    setTextBusy(true);
    try {
      await createTextMutation.mutateAsync({ text });
      await onPublished();
      setTextBody("");
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
    if (!file || !captionText || (mediaMode === "photo" && !imageDimensions)) {
      toast.error(mediaMode === "photo" ? "Add a caption and image first." : "Add a caption and an original video first.");
      return;
    }
    setBusy(true);
    try {
      if (mediaMode === "photo" && imageDimensions) {
        await publishPhoto(file, "", captionText, imageDimensions);
      } else {
        await publishVideo(file, kind, "", captionText);
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
  return (
    <ActionModal title={modalTitle} open={open} onClose={close} className="upload-video-modal create-uploader-modal">
      <button type="button" className="create-uploader-close" onClick={safeClick(close)} aria-label="Close Create uploader">
        <X size={25} />
      </button>
      {mode === "menu" ? (
        <>
          <div className="create-uploader-intro">
            <p className="eyebrow">Share something new</p>
            <h2>Create on KINBA</h2>
            <p>Choose a format and continue directly into its publishing workflow.</p>
          </div>
          <div className="create-uploader-wheel" aria-label="Create options">
            <div className="create-uploader-wheel-core"><Plus size={25} /><span>Create</span></div>
            <button type="button" className="create-uploader-option create-uploader-option--image" onClick={safeClick(() => chooseMedia("photo"))}><ImagePlus size={20} /><span>Post Image</span></button>
            <button type="button" className="create-uploader-option create-uploader-option--video" onClick={safeClick(() => chooseMedia("video", "LONG"))}><Video size={20} /><span>Post Video</span></button>
            <button type="button" className="create-uploader-option create-uploader-option--shorts" onClick={safeClick(() => chooseMedia("video", "SHORT"))}><Film size={20} /><span>Upload Shorts</span></button>
            <button type="button" className="create-uploader-option create-uploader-option--text" onClick={safeClick(() => chooseMode("text"))}><FileText size={20} /><span>Post Text</span></button>
            <button type="button" className="create-uploader-option create-uploader-option--thread" onClick={safeClick(() => chooseMode("thread"))}><MessageCircle size={20} /><span>Start a Thread</span></button>
            <button type="button" className="create-uploader-option create-uploader-option--live" onClick={safeClick(() => chooseMedia("video", "LONG"))}><Radio size={20} /><span>Go Live</span></button>
          </div>
          <UploaderHistory media={mediaHistory.data ?? []} textPosts={textHistory.data ?? []} />
        </>
      ) : mode === "text" ? (
        <div className="create-uploader-composer">
          <p className="modal-intro">Share a text post with your followers.</p>
          <textarea
            value={textBody}
            onChange={event => setTextBody(event.target.value)}
            placeholder="What's on your mind?"
            maxLength={5000}
            rows={5}
            autoFocus
          />
          <span className="field-hint">{textBody.length}/5000</span>
          <div className="create-uploader-form-actions">
            <button type="button" className="muted-btn" onClick={safeClick(() => setMode("menu"))}>Back</button>
            <button
              type="button"
              className="primary-btn"
              disabled={textBusy || !textBody.trim()}
              onClick={safeClick(submitText)}
            >
              {textBusy ? "Publishing…" : "Publish text post"}
            </button>
          </div>
        </div>
      ) : mode === "thread" ? (
        <div className="create-uploader-composer">
          <p className="modal-intro">Start a conversation with your community.</p>
          <CommunityAnnouncements />
        </div>
      ) : (
        <form className="modal-form" onSubmit={submit}>
          <div className="modal-kind-switch" role="tablist" aria-label="Media type">
            <button type="button" className={mediaMode === "video" ? "active" : ""} onClick={safeClick(() => chooseMedia("video", kind))}>Video</button>
            <button type="button" className={mediaMode === "photo" ? "active" : ""} onClick={safeClick(() => chooseMedia("photo"))}>Photo</button>
          </div>
          {mediaMode === "video" && (
            <div className="modal-kind-switch" role="tablist" aria-label="Video type">
              <button type="button" className={kind === "LONG" ? "active" : ""} onClick={safeClick(() => setKind("LONG"))}>Video · up to 30 min</button>
              <button type="button" className={kind === "SHORT" ? "active" : ""} onClick={safeClick(() => setKind("SHORT"))}>Short · up to 1 min</button>
            </div>
          )}
          <label>Caption<textarea value={caption} onChange={event => setCaption(event.target.value)} placeholder={kind === "SHORT" ? "Describe your Short" : "What's on your mind?"} maxLength={2400} rows={4} required /></label>
          <input ref={inputRef} type="file" accept={mediaMode === "photo" ? "image/jpeg,image/png,image/webp" : "video/*"} className="sr-only" onChange={selectFile} />
          <button type="button" className="modal-file-button" onClick={safeClick(() => inputRef.current?.click())}>{mediaMode === "photo" ? <ImagePlus size={18} /> : <Video size={18} />} {file ? file.name : mediaMode === "photo" ? "Choose JPG, PNG, or WEBP image" : "Choose original video"}</button>
          <div className="create-uploader-form-actions"><button type="button" className="muted-btn" onClick={safeClick(() => setMode("menu"))}>Back</button><button className="primary-btn" type="submit" disabled={busy}>{busy ? "Uploading…" : mediaMode === "photo" ? "Publish image" : kind === "SHORT" ? "Upload Short" : "Publish video"}</button></div>
        </form>
      )}
    </ActionModal>
  );
}

function SearchModal({ open, onClose, onOpenVideo }: { open: boolean; onClose: () => void; onOpenVideo?: (video: VideoRecord) => void }) {
  return (
    <ActionModal title="Search KINBA" open={open} onClose={onClose} className="search-action-modal">
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
      <p className="modal-intro">Track the reactions, comments, shares, and follows that matter to your KINBA account.</p>
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
    <ActionModal title="Offline Videos" open={open} onClose={onClose}>
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
  return (
    <ActionModal title="KINBA Studio" open={open} onClose={onClose}>
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
        <Plus size={17} /> Upload new video
      </button>
    </ActionModal>
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
          <h2 id="qr-heading">Share your KINBA profile.</h2>
        </div>
        <QrCode size={22} aria-hidden="true" />
      </div>
      <div className="qr-share-card">
        <div className="qr-mark">
          <img
            src={
              "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=" +
              encodeURIComponent(shareUrl)
            }
            alt="QR code for your KINBA profile"
          />
        </div>
        <div>
          <strong>{profileDisplayName(profile)}</strong>
          <span>{username ? `@${username}` : "Your public profile"}</span>
        </div>
        <button type="button" className="primary-btn" onClick={copyLink}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
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
          <h2 id="offline-heading">Offline videos.</h2>
        </div>
        <Film size={22} aria-hidden="true" />
      </div>
      {saved.isPending ? (
        <div className="utility-loading" aria-busy="true">
          Loading your saved videos…
        </div>
      ) : saved.isError ? (
        <div className="media-empty" role="alert">
          <Film size={22} />
          <h3>Your saved videos are unavailable.</h3>
          <p>We could not reach the saved-video library. Try again.</p>
          <button
            type="button"
            className="muted-btn"
            onClick={() => saved.refetch()}
          >
            Retry
          </button>
        </div>
      ) : saved.data?.length ? (
        <div className="offline-video-list" aria-label="Saved videos">
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
                  {video.owner.name ?? video.owner.username ?? "KINBA creator"}{" "}
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
          <Film size={22} />
          <h3>No saved videos yet.</h3>
          <p>Use Save on any video to keep it in this personal library.</p>
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
  const publicProfileMatch = location.match(/^\/profile\/(\d+)$/);
  const publicProfileId = publicProfileMatch ? Number(publicProfileMatch[1]) : undefined;
  const { theme } = useTheme();
  const [activeView, setActiveView] = useState<FeedSection>("videos");
  const [activeModal, setActiveModal] = useState<AppModal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(() => location === "/profile");
  const [initialShortId, setInitialShortId] = useState<number | null>(null);
  const [initialShortVideo, setInitialShortVideo] = useState<VideoRecord | null>(null);
  const [photoViewer, setPhotoViewer] = useState<VideoRecord | null>(null);
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated && !publicProfileId,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const publicProfileQuery = trpc.profile.byId.useQuery(
    { userId: publicProfileId as number },
    { enabled: Boolean(publicProfileId), refetchOnWindowFocus: false, staleTime: 30_000 }
  );
  const unreadCountQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
  const notificationCount = Math.min(unreadCountQuery.data ?? 0, 99);
  const publicProfileData = publicProfileQuery.data;
  const ownProfileData = profileQuery.data;
  const profile = (publicProfileId ? publicProfileData : ownProfileData) as ProfileSnapshot | undefined;
  const profileForHeader = publicProfileId ? (publicProfileData ?? ownProfileData) : ownProfileData;
  const isOwner = Boolean(
    auth.user?.id && profileForHeader?.user?.id && auth.user.id === profileForHeader.user.id
  );
  const screen: Screen =
    location === "/login"
      ? "landing"
      : publicProfileId || profileOpen
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
    if (location === "/profile") navigate("/");
  };
  const selectDrawerAction = (next: DrawerAction) => {
    if (next === "profile") {
      openProfile();
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
          } ${screen === "dashboard" && isScrollingDown ? "chrome-collapsed" : ""}`}
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
          ) : (
            <ProfileView
              profile={profileForHeader}
              isOwner={isOwner}
              isAuthenticated={auth.isAuthenticated}
              isAdmin={auth.user?.role === "admin"}
              userId={publicProfileId}
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
            alt={photoViewer.title || "Post"}
            owner={photoViewer.owner}
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
          onNotifications={showNotifications}
          onMenu={() => setMenuOpen(value => !value)}
        />
      </div>
      {authDialog}
    </>
  );
}
