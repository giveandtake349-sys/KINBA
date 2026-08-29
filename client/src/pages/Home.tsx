import { useEffect, useState } from "react";
import {
  Bell,
  Film,
  Home as HomeIcon,
  LogOut,
  Menu,
  Moon,
  PenLine,
  Search,
  Settings,
  Sun,
  UserRound,
  Users,
  Video,
  X,
  Megaphone,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import MediaHub, { SearchFeed, type FeedSection } from "@/components/MediaHub";
import "./profile.css";

type Screen = "landing" | "dashboard" | "profile";

type ProfileSnapshot = {
  user?: { name: string | null } | null;
  profile?: { username?: string | null; photoUrl?: string | null } | null;
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
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      <span>{theme === "dark" ? "White" : "Dark"}</span>
    </button>
  );
}

function ProfileIdentity({
  profile,
  compact = false,
}: {
  profile?: ProfileSnapshot;
  compact?: boolean;
}) {
  const name = profile?.user?.name ?? "K. Shahin";
  const username = profile?.profile?.username
    ? `@${profile.profile.username}`
    : "@kinba_creator";
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
        <strong>{name}</strong>
        {!compact && <span>{username}</span>}
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
  onNavigate: (section: FeedSection | "profile") => void;
  onLogout: () => void;
}) {
  if (!open) return null;
  const menuItems: {
    section: FeedSection | "profile";
    label: string;
    icon: typeof Video;
  }[] = [
    { section: "videos", label: "My Videos", icon: Video },
    { section: "shorts", label: "Shorts", icon: Film },
    { section: "following", label: "Following", icon: Users },
    { section: "icons", label: "Icons", icon: UserRound },
  ];
  return (
    <>
      <button
        className="drawer-backdrop"
        type="button"
        aria-label="Close menu"
        onClick={onClose}
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
            onClick={() => {
              onNavigate("profile");
              onClose();
            }}
          >
            Edit Profile
          </button>
          <ProfileStatsGrid profile={profile} />
        </div>
        <nav className="drawer-nav">
          {menuItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.label}
                onClick={() => {
                  onNavigate(item.section);
                  onClose();
                }}
              >
                <Icon size={21} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onNavigate("announcements");
              onClose();
            }}
          >
            <Megaphone size={21} />
            <span>Announcements</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate("settings");
              onClose();
            }}
          >
            <Settings size={21} />
            <span>Settings</span>
          </button>
          <button type="button" onClick={onLogout}>
            <LogOut size={21} />
            <span>Log out</span>
          </button>
        </nav>
      </aside>
    </>
  );
}

function AppHeader({
  profile,
  onMenu,
  onNavigate,
  onLogout,
}: {
  profile?: ProfileSnapshot;
  onMenu: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar mobile-first-header">
      <button
        type="button"
        className="brand"
        onClick={() => onNavigate("/")}
        aria-label="Go to Home"
      >
        <OfficialLogo />
        <span className="brand-name">KINBA</span>
      </button>
      <button
        type="button"
        className="header-profile-trigger"
        onClick={onMenu}
        aria-label="Open profile menu"
      >
        <ProfileIdentity profile={profile} compact />
        <Menu size={25} />
      </button>
      <div className="topbar-actions">
        <ThemeToggle />
        <button type="button" className="logout-btn" onClick={onLogout}>
          <LogOut size={15} />
          <span>Log out</span>
        </button>
      </div>
    </header>
  );
}

function BottomNavigation({
  onHome,
  onSearch,
  onPublish,
  onNotifications,
  onMenu,
}: {
  onHome: () => void;
  onSearch: () => void;
  onPublish: () => void;
  onNotifications: () => void;
  onMenu: () => void;
}) {
  return (
    <nav className="bottom-navigation" aria-label="Mobile navigation">
      <button type="button" onClick={onHome}>
        <HomeIcon size={23} />
        <span>Home</span>
      </button>
      <button type="button" onClick={onSearch}>
        <Search size={23} />
        <span>Search</span>
      </button>
      <button type="button" className="publish-nav" onClick={onPublish}>
        <PenLine size={24} />
        <span>Gold Publish</span>
      </button>
      <button type="button" onClick={onNotifications}>
        <Bell size={23} />
        <span>Notifications</span>
      </button>
      <button type="button" onClick={onMenu}>
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
        <button type="button" className="primary-btn" onClick={onLogin}>
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
}: {
  profile?: ProfileSnapshot;
  enabled: boolean;
}) {
  return (
    <main className="profile-page section-shell">
      <ProfileIdentity profile={profile} />
      <div className="profile-stat-grid" aria-label="Profile statistics">
        <ProfileStatsGrid profile={profile} />
      </div>
      {!enabled && (
        <p className="profile-loading-note">
          Sign in to view your live profile statistics.
        </p>
      )}
    </main>
  );
}

function NotificationsPanel({ enabled }: { enabled: boolean }) {
  const query = trpc.home.notifications.useQuery(undefined, {
    enabled,
    refetchOnWindowFocus: false,
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
        <button type="button" className="settings-logout" onClick={onLogout}>
          <LogOut size={17} /> Log out
        </button>
      </div>
    </section>
  );
}

export default function Home() {
  const auth = useAuth();
  const [location, navigate] = useLocation();
  const { theme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<FeedSection>("all");
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const profile = profileQuery.data as ProfileSnapshot | undefined;
  const screen: Screen =
    location === "/profile"
      ? "profile"
      : auth.isAuthenticated
        ? "dashboard"
        : "landing";
  useEffect(() => {
    if (screen !== "landing" && !auth.loading && !auth.isAuthenticated)
      auth.openAuth();
  }, [auth.isAuthenticated, auth.loading, screen]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const logout = async () => {
    await auth.logout();
    navigate("/");
    setMenuOpen(false);
  };
  const selectSection = (next: FeedSection | "profile") => {
    if (next === "profile") navigate("/profile");
    else {
      navigate("/");
      setSection(next);
    }
  };
  const authDialog = (
    <SupabaseAuthDialog
      open={auth.authDialogOpen}
      onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
    />
  );
  if (screen === "landing")
    return (
      <>
        <div className="kinba-app guest-layout">
          <Landing onLogin={auth.openAuth} />
        </div>
        {authDialog}
      </>
    );
  return (
    <>
      <div className="kinba-app">
        <AppHeader
          profile={profile}
          onMenu={() => setMenuOpen(true)}
          onNavigate={navigate}
          onLogout={logout}
        />
        <main>
          {screen === "dashboard" ? (
            <section className="section-shell home-page">
              {section === "search" ? (
                <SearchFeed />
              ) : section === "notifications" ? (
                <NotificationsPanel enabled={auth.isAuthenticated} />
              ) : section === "settings" ? (
                <SettingsPanel onLogout={logout} />
              ) : (
                <MediaHub section={section} onSectionChange={setSection} />
              )}
            </section>
          ) : (
            <ProfileStats profile={profile} enabled={auth.isAuthenticated} />
          )}
        </main>
        <MobileDrawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          profile={profile}
          onNavigate={selectSection}
          onLogout={logout}
        />
        <BottomNavigation
          onHome={() => {
            navigate("/");
            setSection("all");
          }}
          onSearch={() => {
            navigate("/");
            setSection("search");
          }}
          onPublish={() => {
            navigate("/");
            setSection("publish");
          }}
          onNotifications={() => {
            navigate("/");
            setSection("notifications");
          }}
          onMenu={() => setMenuOpen(true)}
        />
      </div>
      {authDialog}
    </>
  );
}
