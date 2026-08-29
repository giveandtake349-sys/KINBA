import { useEffect } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import MediaHub from "@/components/MediaHub";
import "./profile.css";

type Screen = "landing" | "dashboard" | "profile";

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

function AppHeader({
  screen,
  onNavigate,
  onLogout,
}: {
  screen: Exclude<Screen, "landing">;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="brand"
        onClick={() => onNavigate("/")}
        aria-label="Go to Home"
      >
        <OfficialLogo />
        <span className="brand-name">KINBA</span>
      </button>
      <nav className="desktop-nav" aria-label="Primary navigation">
        <button
          type="button"
          className={screen === "dashboard" ? "active" : ""}
          onClick={() => onNavigate("/")}
        >
          Home
        </button>
        <button
          type="button"
          className={screen === "profile" ? "active" : ""}
          onClick={() => onNavigate("/profile")}
        >
          Profile
        </button>
      </nav>
      <div className="topbar-actions">
        <ThemeToggle />
        <button type="button" className="logout-btn" onClick={onLogout}>
          <LogOut size={15} /> Log out
        </button>
      </div>
    </header>
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

function ProfileStats({ enabled }: { enabled: boolean }) {
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled,
    refetchOnWindowFocus: false,
  });
  const stats = profileQuery.data?.stats;
  const statItems = [
    { label: "Reactions received", value: stats?.reactionsReceived ?? 0 },
    { label: "ICONS", value: stats?.iconsCount ?? 0 },
    { label: "Following", value: stats?.followingCount ?? 0 },
    { label: "Followers", value: stats?.followersCount ?? 0 },
  ];
  return (
    <main className="profile-page section-shell">
      <div className="profile-stat-grid" aria-label="Profile statistics">
        {statItems.map(item => (
          <article className="profile-stat" key={item.label}>
            <strong>{profileQuery.isLoading ? "—" : item.value}</strong>
            <span>{item.label}</span>
          </article>
        ))}
      </div>
    </main>
  );
}

export default function Home() {
  const auth = useAuth();
  const [location, navigate] = useLocation();
  const { theme } = useTheme();
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
        <AppHeader screen={screen} onNavigate={navigate} onLogout={logout} />
        <main>
          {screen === "dashboard" ? (
            <section className="section-shell home-page">
              <MediaHub />
            </section>
          ) : (
            <ProfileStats enabled={auth.isAuthenticated} />
          )}
        </main>
      </div>
      {authDialog}
    </>
  );
}
