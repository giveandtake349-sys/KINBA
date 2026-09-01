import {
  useEffect,
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
  Clock3,
  Copy,
  Coins,
  ExternalLink,
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
import MediaHub, {
  CommunityAnnouncements,
  SearchFeed,
  type FeedSection,
} from "@/components/MediaHub";
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
  user?: { name: string | null } | null;
  profile?: {
    username?: string | null;
    photoUrl?: string | null;
    isVerified?: boolean;
    accountType?: "member" | "creator" | "company";
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

function ProfileEditor({ profile }: { profile?: ProfileSnapshot }) {
  const [username, setUsername] = useState(profile?.profile?.username ?? "");
  const [photoUrl, setPhotoUrl] = useState(profile?.profile?.photoUrl ?? "");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const update = trpc.profile.update.useMutation();
  const utils = trpc.useUtils();
  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      setPhotoUrl(await uploadImage("avatar", file));
      setMessage("Profile picture uploaded. Save your profile to keep it.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The profile picture could not be uploaded."
      );
    } finally {
      setUploading(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUsername = username.trim() || null;
    const currentUsername = profile?.profile?.username?.trim() || null;
    const nextPhotoUrl = photoUrl.trim() || null;
    const currentPhotoUrl = profile?.profile?.photoUrl || null;
    const changes: { username?: string | null; photoUrl?: string | null } = {};
    if (nextUsername !== currentUsername) changes.username = nextUsername;
    if (nextPhotoUrl !== currentPhotoUrl) changes.photoUrl = nextPhotoUrl;
    if (!Object.keys(changes).length) {
      setMessage("No profile changes to save.");
      return;
    }
    try {
      await update.mutateAsync(changes);
      await utils.profile.me.invalidate();
      setMessage("Profile updated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The profile could not be updated."
      );
    }
  };
  return (
    <form className="profile-editor" onSubmit={submit}>
      <div className="profile-editor-heading">
        <div className="profile-avatar profile-avatar--large">
          {photoUrl ? (
            <img src={photoUrl} alt="Profile preview" />
          ) : (
            <UserRound size={28} />
          )}
        </div>
        <div>
          <strong>Edit Profile</strong>
          <span>Update the identity shown across KINBA.</span>
        </div>
      </div>
      <label>
        Username
        <input
          value={username}
          onChange={event => setUsername(event.target.value)}
          minLength={3}
          maxLength={64}
          pattern="[A-Za-z0-9_]+"
          placeholder="kinba_creator"
        />
      </label>
      <label>
        Profile picture
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={chooseAvatar}
          disabled={uploading}
        />
      </label>
      <button
        className="primary-btn"
        type="submit"
        disabled={update.isPending || uploading}
      >
        {update.isPending ? "Saving…" : "Save Profile"}
      </button>
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </form>
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
  const decide = async (
    transactionId: number,
    status: "approved" | "rejected"
  ) => {
    setActiveId(transactionId);
    setMessage("");
    try {
      await review.mutateAsync({ transactionId, status });
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
        <button type="button" onClick={safeClick(() => onSelectFeed("wheels"))}>Wheels</button>
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
    ["wheels", "Wheels"],
    ["all", "All Feed"],
    ["videos", "Videos"],
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
  onSearch,
  onPublish,
  onNotifications,
  onMenu,
}: {
  className?: string;
  activePanel: FeedSection;
  menuOpen: boolean;
  onHome: () => void;
  onSearch: () => void;
  onPublish: () => void;
  onNotifications: () => void;
  onMenu: () => void;
}) {
  const isHome = ["all", "videos", "shorts", "wheels"].includes(activePanel);
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
        className={activePanel === "search" ? "active" : ""}
        onClick={safeClick(onSearch)}
        aria-current={activePanel === "search" ? "page" : undefined}
      >
        <Search size={23} />
        <span>Search</span>
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

function ProfileStats({
  profile,
  enabled,
  isAdmin,
  onSignIn,
}: {
  profile?: ProfileSnapshot;
  enabled: boolean;
  isAdmin: boolean;
  onSignIn: () => void;
}) {
  const [gridTab, setGridTab] = useState<"videos" | "shorts" | "liked">(
    "videos"
  );
  const videosQuery = trpc.profile.videos.useQuery(undefined, {
    enabled,
    refetchOnWindowFocus: false,
  });
  const stats = profile?.stats;
  const displayName = profileDisplayName(profile);
  const handle = profile?.profile?.username
    ? `@${profile.profile.username}`
    : "@kinba_member";
  const videos = (videosQuery.data ?? []).filter(video =>
    gridTab === "shorts"
      ? video.kind === "SHORT"
      : gridTab === "videos"
        ? video.kind === "LONG"
        : false
  );
  return (
    <main className="profile-page section-shell">
      <section className="profile-hero" aria-labelledby="profile-heading">
        <div className="profile-hero-avatar-wrap">
          <div className="profile-avatar profile-avatar--hero">
            {profile?.profile?.photoUrl ? (
              <img
                src={profile.profile.photoUrl}
                alt={`${displayName} avatar`}
              />
            ) : (
              <UserRound size={42} />
            )}
          </div>
          {enabled && (
            <span
              className="profile-avatar-edit"
              aria-label="Edit profile picture"
            >
              <PenLine size={14} />
            </span>
          )}
        </div>
        <h1 id="profile-heading">{displayName}</h1>
        <p className="profile-handle">{handle}</p>
        <div className="profile-stat-line" aria-label="Profile statistics">
          <span>
            <strong>{stats?.followingCount ?? 0}</strong> Following
          </span>
          <span>
            <strong>{stats?.followersCount ?? 0}</strong> Followers
          </span>
          <span>
            <strong>{stats?.reactionsReceived ?? 0}</strong> Pookies
          </span>
        </div>
        {enabled ? (
          <details className="profile-edit-details">
            <summary className="primary-btn">Edit Profile</summary>
            <ProfileEditor profile={profile} />
          </details>
        ) : (
          <button type="button" className="primary-btn" onClick={onSignIn}>
            Sign in to edit profile
          </button>
        )}
      </section>
      <section
        className="profile-content"
        aria-labelledby="profile-content-heading"
      >
        <div className="profile-content-heading">
          <div>
            <p className="eyebrow">Creator library</p>
            <h2 id="profile-content-heading">Your videos</h2>
          </div>
          {videosQuery.isFetching && !videosQuery.isPending && (
            <span className="profile-loading-note">Refreshing…</span>
          )}
        </div>
        <div
          className="profile-grid-tabs"
          role="tablist"
          aria-label="Profile media tabs"
        >
          {(
            [
              ["videos", "Videos"],
              ["shorts", "Shorts"],
              ["liked", "Pookies"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={gridTab === id}
              className={gridTab === id ? "active" : ""}
              onClick={() => setGridTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {gridTab === "liked" ? (
          <div className="profile-grid-empty">
            Pookied videos will appear here.
          </div>
        ) : videos.length ? (
          <div className="profile-video-grid">
            {videos.map(video => (
              <article className="profile-video-tile" key={video.id}>
                {video.mediaType === "IMAGE" ? (
                  <img
                    src={video.videoUrl}
                    className="w-full h-auto object-cover rounded-lg"
                    alt={video.title || "Post"}
                  />
                ) : video.thumbnailUrl ? (
                  <img src={video.thumbnailUrl} alt={video.title} />
                ) : (
                  <div className="profile-video-tile-fallback">
                    <Video size={24} />
                  </div>
                )}
                {video.mediaType === "VIDEO" && (
                  <span className="profile-video-tile-play">
                    <Video size={15} />
                  </span>
                )}
                <div>
                  <strong>{video.title}</strong>
                  <span>{video.viewCount} views</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="profile-grid-empty">
            No {gridTab === "shorts" ? "Shorts" : "videos"} uploaded yet.
          </div>
        )}
      </section>
      {enabled && (
        <section className="profile-secondary-tools">
          <GetVerifiedPanel />
          {isAdmin && <AdminVerificationPanel />}
        </section>
      )}
    </main>
  );
}

function NotificationsPanel({ enabled }: { enabled: boolean }) {
  const query = trpc.home.notifications.useQuery(undefined, {
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
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
      </div>
      {query.isPending ? (
        <div className="utility-loading">Loading notifications…</div>
      ) : query.isError ? (
        <div className="media-empty">
          <h3>Notifications are temporarily unavailable.</h3>
          <p>Try again in a moment.</p>
        </div>
      ) : query.data?.length ? (
        <div className="notification-list">
          {query.data.map(item => (
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
      ) : (
        <div className="media-empty">
          <Bell size={18} />
          <h3>No notifications yet.</h3>
          <p>
            Reactions, comments, shares, and new followers will appear here.
          </p>
        </div>
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
          <small>Used for Wheels entries and sponsorships.</small>
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

function UploadVideoModal({
  open,
  onClose,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  onPublished: () => Promise<void>;
}) {
  const [mediaMode, setMediaMode] = useState<"video" | "photo">("video");
  const [kind, setKind] = useState<"LONG" | "SHORT">("LONG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
          kind === "LONG"
            ? MAX_LONG_VIDEO_DURATION_SECONDS
            : MAX_SHORT_VIDEO_DURATION_SECONDS,
      });
      setImageDimensions(null);
      setFile(nextFile);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "This video cannot be uploaded."
      );
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!file || !title.trim() || (mediaMode === "photo" && !imageDimensions)) {
      toast.error(mediaMode === "photo" ? "Add a title and image first." : "Add a title and an original video first.");
      return;
    }
    setBusy(true);
    try {
      if (mediaMode === "photo" && imageDimensions) {
        await publishPhoto(file, title.trim(), description.trim(), imageDimensions);
      } else {
        await publishVideo(file, kind, title.trim(), description.trim());
      }
      try {
        await onPublished();
      } catch (refreshError) {
        console.error("[MediaPublish] Published successfully but feed refresh failed:", refreshError);
        toast.info("Published successfully. Refresh the feed if it is not visible yet.");
      }
      setFile(null);
      setImageDimensions(null);
      setTitle("");
      setDescription("");
      toast.success(mediaMode === "photo" ? "Photo published to your feed." : "Video published to your feed.");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The video could not be uploaded."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ActionModal title="Create a video" open={open} onClose={onClose} className="upload-video-modal">
      <form className="modal-form" onSubmit={submit}>
        <div className="modal-kind-switch" role="tablist" aria-label="Media type">
          <button
            type="button"
            className={mediaMode === "video" ? "active" : ""}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              setMediaMode("video");
              setFile(null);
              setImageDimensions(null);
            }}
          >
            Video
          </button>
          <button
            type="button"
            className={mediaMode === "photo" ? "active" : ""}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              setMediaMode("photo");
              setFile(null);
              setImageDimensions(null);
            }}
          >
            Photo
          </button>
        </div>
        {mediaMode === "video" && (
          <div className="modal-kind-switch" role="tablist" aria-label="Video type">
            <button
              type="button"
              className={kind === "LONG" ? "active" : ""}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                setKind("LONG");
              }}
            >
              Video · up to 30 min
            </button>
            <button
              type="button"
              className={kind === "SHORT" ? "active" : ""}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                setKind("SHORT");
              }}
            >
              Short · up to 1 min
            </button>
          </div>
        )}
        <label>
          Title
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Give your video a title"
            maxLength={180}
            required
          />
        </label>
        <label>
          Caption
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Tell viewers what this is about"
            maxLength={2400}
            rows={4}
          />
        </label>
        <input
          ref={inputRef}
          type="file"
          accept={mediaMode === "photo" ? "image/jpeg,image/png,image/webp" : "video/*"}
          className="sr-only"
          onChange={selectFile}
        />
        <button
          type="button"
          className="modal-file-button"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          {mediaMode === "photo" ? <ImagePlus size={18} /> : <Video size={18} />} {file ? file.name : mediaMode === "photo" ? "Choose JPG, PNG, or WEBP image" : "Choose original video"}
        </button>
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? "Uploading…" : mediaMode === "photo" ? "Upload photo" : "Upload video"}
        </button>
      </form>
    </ActionModal>
  );
}

function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ActionModal title="Search KINBA" open={open} onClose={onClose} className="search-action-modal">
      <SearchFeed />
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

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, "0")
    )
    .join(":");
}

function SponsorWidget({ sessionId }: { sessionId: number }) {
  const sponsors = trpc.sponsorBids.liveSponsors.useQuery(
    { sessionId },
    {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const sponsor = trpc.sponsorBids.sponsor.useMutation();
  const wallet = trpc.sponsorBids.walletBalance.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [amount, setAmount] = useState("100");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSponsors = (sponsors.data ?? []).filter(
    item => new Date(item.expiresAt).getTime() > now
  );
  const chooseLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      setLogoUrl(await uploadImage("post", file));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The logo could not be uploaded."
      );
    } finally {
      setUploading(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      await sponsor.mutateAsync({
        sessionId,
        logoUrl,
        externalLink,
        sponsoredAmount: amount,
      });
      await Promise.all([
        sponsors.refetch(),
        wallet.refetch(),
        utils.sponsorBids.liveSponsors.invalidate({ sessionId }),
      ]);
      setLogoUrl("");
      setExternalLink("");
      setAmount("100");
      setOpen(false);
      setMessage("Sponsorship live for 10 minutes.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The sponsorship could not be completed."
      );
    }
  };

  return (
    <aside className="sponsor-widget" aria-labelledby="sponsor-widget-heading">
      <div className="sponsor-widget__heading">
        <div>
          <p className="eyebrow">Live sponsors</p>
          <h2 id="sponsor-widget-heading">Back this wheel</h2>
        </div>
        <button
          type="button"
          className="muted-btn sponsor-widget__toggle"
          onClick={() => setOpen(value => !value)}
        >
          <ImagePlus size={16} /> {open ? "Close" : "Sponsor This Wheel"}
        </button>
      </div>
      {activeSponsors.length ? (
        <div className="sponsor-widget__list">
          {activeSponsors.map(item => (
            <a
              className="sponsor-card"
              href={item.externalLink}
              target="_blank"
              rel="noreferrer"
              key={item.id}
            >
              <img src={item.logoUrl} alt="Sponsor logo" />
              <span>
                <strong>৳{Number(item.sponsoredAmount).toFixed(2)}</strong>
                <small>
                  Visit sponsor <ExternalLink size={12} />
                </small>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="sponsor-widget__empty">
          No live sponsors yet. Be the first to appear beside the wheel.
        </p>
      )}
      {open && (
        <form className="sponsor-widget__form" onSubmit={submit}>
          <label>
            Logo or image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={chooseLogo}
              disabled={uploading || sponsor.isPending}
              required={!logoUrl}
            />
            {logoUrl && <small>Logo uploaded and ready.</small>}
          </label>
          <label>
            External link
            <input
              type="url"
              value={externalLink}
              onChange={event => setExternalLink(event.target.value)}
              placeholder="https://facebook.com/your-brand"
              required
              disabled={sponsor.isPending}
            />
          </label>
          <label>
            Sponsorship amount (Taka)
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              required
              disabled={sponsor.isPending}
            />
          </label>
          <p className="sponsor-widget__wallet">
            Wallet available: ৳{Number(wallet.data ?? 0).toFixed(2)} · Your logo
            displays for 10 minutes.
          </p>
          <button
            type="submit"
            className="primary-btn"
            disabled={uploading || sponsor.isPending || !logoUrl}
          >
            {sponsor.isPending
              ? "Processing payment…"
              : uploading
                ? "Uploading…"
                : `Pay ৳${amount || "0"} & Go Live`}
          </button>
        </form>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </aside>
  );
}

type SponsorBidsWinner = {
  winner: { rank: number; prizeAmount: string };
  user: { name: string | null };
  profile?: { photoUrl?: string | null } | null;
};
type SponsorBidsSponsor = {
  id: number;
  logoUrl: string;
  externalLink: string;
  sponsoredAmount: string;
  expiresAt: Date | string;
};
type SponsorBidsDraw = {
  rank: number;
  nomineeParticipantIds: number[];
  selectedParticipantId: number | null;
};

function WinnersShowcase({
  winners,
  sponsors,
}: {
  winners: SponsorBidsWinner[];
  sponsors: SponsorBidsSponsor[];
}) {
  const ordered = [...winners].sort((a, b) => a.winner.rank - b.winner.rank);
  return (
    <div
      className="sponsor-showcase w-full max-w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4 overflow-hidden box-border px-4"
      aria-labelledby="sponsor-showcase-heading"
    >
      <div className="sponsor-showcase__heading">
        <div>
          <p className="eyebrow eyebrow--bright">24-hour showcase</p>
          <h2 id="sponsor-showcase-heading">Winners Showcase Board</h2>
        </div>
        <span className="sponsor-bids-panel__badge">Wheel complete</span>
      </div>
      {ordered.length ? (
        <div className="winner-board w-full max-w-full overflow-hidden box-border">
          {ordered.map(({ winner, user, profile }) => (
            <article
              className={`winner-card winner-card--${winner.rank}`}
              key={winner.rank}
            >
              <div className="winner-card__rank">
                {winner.rank}
                <sup>
                  {winner.rank === 1 ? "st" : winner.rank === 2 ? "nd" : "rd"}
                </sup>
              </div>
              <div className="winner-card__avatar">
                {profile?.photoUrl ? (
                  <img src={profile.photoUrl} alt="" />
                ) : (
                  <UserRound size={22} />
                )}
              </div>
              <div>
                <strong>{user.name || "KINBA winner"}</strong>
                <span>৳{Number(winner.prizeAmount).toFixed(2)} prize</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="sponsor-widget__empty">
          Winner records are being finalized.
        </p>
      )}
      {sponsors.length > 0 && (
        <div className="showcase-sponsors">
          <p className="eyebrow">Live sponsors</p>
          <div className="showcase-sponsors__list">
            {sponsors.map(sponsor => (
              <a
                href={sponsor.externalLink}
                target="_blank"
                rel="noreferrer"
                key={sponsor.id}
              >
                <img src={sponsor.logoUrl} alt="Sponsor logo" />
                <span>৳{Number(sponsor.sponsoredAmount).toFixed(2)}</span>
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SponsorWheel({
  phase = "entry",
  label = "WheelsBids wheel",
}: {
  phase?: string;
  label?: string;
}) {
  return (
    <div
      className={`sponsor-wheel sponsor-wheel--${phase}`}
      aria-label={label}
      role="img"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

function SponsorBidsPanel() {
  const sessions = trpc.sponsorBids.sessions.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const wallet = trpc.sponsorBids.walletBalance.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const join = trpc.sponsorBids.join.useMutation();
  const utils = trpc.useUtils();
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const session = sessions.data
    ?.filter(
      item =>
        item.status === "scheduled" ||
        item.status === "live" ||
        (item.status === "completed" &&
          item.endsAt &&
          new Date(item.endsAt).getTime() > Date.now())
    )
    .sort((left, right) => {
      const leftTime = left.startsAt
        ? new Date(left.startsAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const rightTime = right.startsAt
        ? new Date(right.startsAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0];
  const stateQuery = trpc.sponsorBids.state.useQuery(
    { sessionId: session?.id ?? 0 },
    {
      enabled: Boolean(session),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const synchronizedNow =
    now + (stateQuery.data?.serverNow ?? Date.now()) - Date.now();
  const spinAt = session?.startsAt
    ? new Date(session.startsAt).getTime()
    : null;
  const entryOpensAt = spinAt === null ? null : spinAt - 60 * 60 * 1000;
  const isOpen =
    session?.status === "scheduled" &&
    entryOpensAt !== null &&
    spinAt !== null &&
    synchronizedNow >= entryOpensAt &&
    synchronizedNow < spinAt;
  const hasEnoughBalance = Number(wallet.data ?? 0) >= 100;
  const countdown =
    spinAt === null ? "—" : formatCountdown(spinAt - synchronizedNow);
  const phase =
    stateQuery.data?.phase ??
    (spinAt !== null && synchronizedNow >= spinAt ? "spin-3rd" : "entry");
  const isShowcase = phase === "showcase";
  const phaseLabel =
    phase === "spin-3rd"
      ? "3 nominee 3rd-place spin"
      : phase === "pause-after-3rd"
        ? "Pause after 3rd-place draw"
        : phase === "spin-2nd"
          ? "3 nominee 2nd-place spin"
          : phase === "pause-after-2nd"
            ? "Pause after 2nd-place draw"
            : phase === "spin-1st"
              ? "3 nominee 1st-place spin"
              : phase === "showcase"
                ? "Winners showcase"
                : "Entry window";
  const activeRank =
    phase === "spin-3rd"
      ? 3
      : phase === "spin-2nd"
        ? 2
        : phase === "spin-1st"
          ? 1
          : null;
  const announcedWinner = activeRank
    ? (stateQuery.data?.winners ?? []).find(
        item => item.winner.rank === activeRank
      )
    : undefined;
  const activeDraw = activeRank
    ? (stateQuery.data?.draws ?? []).find(
        (draw: SponsorBidsDraw) => draw.rank === activeRank
      )
    : undefined;
  const handleJoin = async () => {
    if (!session || !isOpen) return;
    setMessage("");
    try {
      await join.mutateAsync({ sessionId: session.id });
      await Promise.all([wallet.refetch(), sessions.refetch()]);
      await utils.sponsorBids.session.invalidate({ sessionId: session.id });
      setMessage("You’re in. 100 Taka has been deducted from your wallet.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The wheel entry could not be completed."
      );
    }
  };

  return (
    <section
      className="sponsor-bids-panel w-full max-w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4 overflow-hidden box-border px-4"
      aria-labelledby="sponsor-bids-heading"
    >
      <div className="sponsor-bids-panel__header">
        <div>
          <p className="eyebrow">Live on KINBA</p>
          <h1 id="sponsor-bids-heading">WheelsBids</h1>
          <p className="sponsor-bids-panel__subcopy">
            Join the next one-hour entry window for your chance to win.
          </p>
        </div>
        <span className="sponsor-bids-panel__badge">100 Taka</span>
      </div>
      {sessions.isPending ? (
        <p className="profile-loading-note">Loading the next wheel…</p>
      ) : sessions.error ? (
        <p className="form-message form-message--error">
          The wheel service is temporarily unavailable. Please try again
          shortly.
        </p>
      ) : !session ? (
        <div className="sponsor-bids-panel__body sponsor-bids-empty-state">
          <div className="sponsor-bids-countdown">
            <SponsorWheel label="WheelsBids wheel awaiting the next session" />
            <Clock3 size={20} aria-hidden="true" />
            <div>
              <span>Next wheel</span>
              <strong>Awaiting schedule</strong>
            </div>
          </div>
          <p className="form-message">
            The next WheelsBids session has not been scheduled yet. The wheel is
            ready for the next entry window.
          </p>
        </div>
      ) : (
        <div className="sponsor-bids-panel__body">
          {isShowcase ? (
            <WinnersShowcase
              winners={(stateQuery.data?.winners ?? []) as SponsorBidsWinner[]}
              sponsors={
                (stateQuery.data?.sponsors ?? []) as SponsorBidsSponsor[]
              }
            />
          ) : (
            <div className="sponsor-bids-panel__top-row w-full max-w-full overflow-hidden box-border">
              <div className="sponsor-bids-countdown">
                <SponsorWheel
                  phase={phase}
                  label={`${phaseLabel} in progress`}
                />
                <Clock3 size={20} aria-hidden="true" />
                <div>
                  <span>Wheel starts in</span>
                  <strong aria-live="polite">{countdown}</strong>
                </div>
              </div>
              <SponsorWidget sessionId={session.id} />
            </div>
          )}
          {!isShowcase && activeDraw && activeRank && (
            <p className="sponsor-bids-announcement" role="status">
              {activeDraw.nomineeParticipantIds.length} nominees entered the{" "}
              {activeRank === 1 ? "1st" : activeRank === 2 ? "2nd" : "3rd"}
              -place secondary spin.
            </p>
          )}
          {!isShowcase && announcedWinner && (
            <p className="sponsor-bids-announcement" role="status">
              Winner announced:{" "}
              <strong>{announcedWinner.user.name || "KINBA winner"}</strong>{" "}
              takes the{" "}
              {activeRank === 1 ? "1st" : activeRank === 2 ? "2nd" : "3rd"}{" "}
              prize of ৳{Number(announcedWinner.winner.prizeAmount).toFixed(2)}.
            </p>
          )}
          {!isShowcase && (
            <div className="sponsor-bids-panel__meta">
              <span>
                <WalletCards size={16} /> Wallet: ৳
                {Number(wallet.data ?? 0).toFixed(2)}
              </span>
              <span>
                {isOpen
                  ? "Entry window open"
                  : synchronizedNow < (entryOpensAt ?? synchronizedNow)
                    ? "Entry opens soon"
                    : "Entry window closed"}
              </span>
              <span className="sponsor-bids-phase">Phase: {phaseLabel}</span>
            </div>
          )}
          {!isShowcase && (
            <button
              type="button"
              className="primary-btn sponsor-bids-join"
              onClick={handleJoin}
              disabled={!isOpen || !hasEnoughBalance || join.isPending}
            >
              {join.isPending ? "Joining…" : "Join TimeWheels — ৳100"}
            </button>
          )}
          {!isShowcase && !hasEnoughBalance && (
            <p className="form-message form-message--error">
              You need at least 100 Taka in your wallet to join.
            </p>
          )}
          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const auth = useAuth();
  const { isScrollingDown } = useScrollDirection();
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  const { theme } = useTheme();
  const [activeView, setActiveView] = useState<FeedSection>("all");
  const [activeModal, setActiveModal] = useState<AppModal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(() => location === "/profile");
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const notificationQuery = trpc.home.notifications.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const notificationCount = Math.min(notificationQuery.data?.length ?? 0, 99);
  const profile = profileQuery.data as ProfileSnapshot | undefined;
  const screen: Screen =
    location === "/login" || !auth.isAuthenticated
      ? "landing"
      : profileOpen
        ? "profile"
        : "dashboard";

  useEffect(() => {
    if (location === "/profile") setProfileOpen(true);
  }, [location]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const showFeed = (next: FeedSection = "all") => {
    setProfileOpen(false);
    setActiveView(next);
    setActiveModal(null);
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
      setActiveView("all");
      navigate("/login");
      auth.openAuth();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to log out.");
    }
  };
  const authDialog = (
    <SupabaseAuthDialog
      open={auth.authDialogOpen}
      onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
    />
  );
  if (auth.loading)
    return (
      <div
        className="kinba-app guest-layout max-w-vw overflow-x-hidden box-border"
        onClick={guardNonSubmitNavigation}
      >
        <main className="section-shell">
          <p className="profile-loading-note">Loading KINBA…</p>
        </main>
        {authDialog}
      </div>
    );
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
          className={`top-navigation-wrapper fixed top-0 left-0 right-0 z-50 bg-[#0B0F17]/95 backdrop-blur-md transition-transform duration-300 ease-in-out ${
            screen === "dashboard" && isScrollingDown
              ? "-translate-y-full"
              : "translate-y-0"
          }`}
        >
          <AppHeader
            profile={profile}
            notificationCount={notificationCount}
            onHome={() => showFeed("all")}
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
                  wheels={<SponsorBidsPanel />}
                />
              )}
            </section>
          ) : (
            <ProfileStats
              profile={profile}
              enabled={auth.isAuthenticated}
              isAdmin={auth.user?.role === "admin"}
              onSignIn={auth.openAuth}
            />
          )}
        </main>
        <MobileDrawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          profile={profile}
          onNavigate={selectDrawerAction}
          onLogout={logout}
        />
        <WalletModal
          open={activeModal === "wallet"}
          onClose={() => setActiveModal(null)}
        />
        <UploadVideoModal
          open={activeModal === "upload"}
          onClose={() => setActiveModal(null)}
          onPublished={async () => {
            await Promise.all([
              utils.home.feed.invalidate(),
              utils.videos.list.invalidate(),
            ]);
          }}
        />
        <SearchModal
          open={activeModal === "search"}
          onClose={() => setActiveModal(null)}
        />
        <NotificationDrawer
          open={activeModal === "notifications"}
          onClose={() => setActiveModal(null)}
          enabled={auth.isAuthenticated}
        />
        <ActivityModal
          open={activeModal === "activity"}
          onClose={() => setActiveModal(null)}
          enabled={auth.isAuthenticated}
        />
        <OfflineVideosModal
          open={activeModal === "offline"}
          onClose={() => setActiveModal(null)}
          onBrowse={() => showFeed("all")}
        />
        <QRCodeModal
          open={activeModal === "qr"}
          onClose={() => setActiveModal(null)}
          profile={profile}
        />
        <CreatorStudioModal
          open={activeModal === "studio"}
          onClose={() => setActiveModal(null)}
          profile={profile}
          onCreate={() => openModal("upload")}
        />
        <AnnouncementsModal
          open={activeModal === "announcements"}
          onClose={() => setActiveModal(null)}
        />
        <BottomNavigation
          className={
            screen === "dashboard" && isScrollingDown
              ? "translate-y-full"
              : "translate-y-0"
          }
          activePanel={activeView}
          menuOpen={menuOpen}
          onHome={() => showFeed("all")}
          onSearch={() => openModal("search")}
          onPublish={() => openModal("upload")}
          onNotifications={showNotifications}
          onMenu={() => setMenuOpen(value => !value)}
        />
      </div>
      {authDialog}
    </>
  );
}
