import { useState } from "react";
import { ArrowLeft, BarChart3, Film, Plus, WalletCards } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ContentAnalytics } from "@/components/ads/ContentAnalytics";
import "./analytics.css";

 type StudioTab = "create" | "content" | "analytics" | "earnings";

export default function JHILIKStudio() {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const [tab, setTab] = useState<StudioTab>("create");
  const profile = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const stats = profile.data?.stats;

  if (!auth.isAuthenticated) {
    return (
      <main className="adv-page">
        <StudioHeader onBack={() => navigate("/")} />
        <section className="adv-card" style={{ textAlign: "center" }}>
          <h2>Sign in to use JHILIK Studio</h2>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Sign in to manage your content, analytics, and campaign earnings.
          </p>
        </section>
      </main>
    );
  }

  const tabs: Array<{ id: StudioTab; label: string; icon: typeof Plus }> = [
    { id: "create", label: "Create", icon: Plus },
    { id: "content", label: "Content", icon: Film },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "earnings", label: "Earnings", icon: WalletCards },
  ];

  return (
    <main className="adv-page studio-page">
      <StudioHeader onBack={() => navigate("/")} />
      <section className="adv-card studio-shell" aria-label="JHILIK Studio">
        <div className="studio-tabs" role="tablist" aria-label="Studio sections">
          {tabs.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "on" : ""}
                onClick={() => setTab(item.id)}
              >
                <Icon size={15} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "create" ? (
          <>
            <p className="modal-intro">
              Manage your publishing momentum from one creator workspace.
            </p>
            <div className="studio-stat-grid">
              <div><strong>{stats?.followersCount ?? 0}</strong><span>Followers</span></div>
              <div><strong>{stats?.reactionsReceived ?? 0}</strong><span>Pookies</span></div>
              <div><strong>{stats?.iconsCount ?? 0}</strong><span>ICONS</span></div>
            </div>
            <button
              type="button"
              className="primary-btn"
              onClick={() => navigate("/")}
            >
              <Plus size={18} /> Upload new video
            </button>
          </>
        ) : null}
        {tab === "content" ? <StudioContentTab /> : null}
        {tab === "analytics" ? <ContentAnalytics /> : null}
        {tab === "earnings" ? <StudioEarningsTab /> : null}
      </section>
    </main>
  );
}

function StudioHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="adv-topbar">
      <button type="button" className="adv-back" onClick={onBack} aria-label="Back">
        <ArrowLeft size={20} />
      </button>
      <span className="adv-topbar-title">JHILIK Studio</span>
      <span style={{ width: 40 }} aria-hidden="true" />
    </div>
  );
}

function StudioContentTab() {
  const videos = trpc.profile.videos.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows = videos.data ?? [];
  if (videos.isLoading) return <p className="profile-loading-note">Loading your content…</p>;
  if (rows.length === 0) {
    return (
      <div className="an-empty" role="status">
        <Film size={28} aria-hidden="true" />
        <p><strong>No content yet.</strong><br />Publish your first video, photo, or post to see it here.</p>
      </div>
    );
  }
  return (
    <div className="an-card">
      <b>Your content</b>
      <div className="an-table" role="table" aria-label="Your published content">
        <div className="an-thead" role="row"><span>Post</span><span>Type</span><span>Views</span></div>
        {rows.map(video => (
          <div className="an-trow" role="row" key={video.id}>
            <span className="an-post"><span>{video.title || `Post #${video.id}`}</span></span>
            <span>{video.mediaType ?? "—"}</span>
            <span>{(video.viewCount ?? 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StudioEarningsTab() {
  const earnings = trpc.submissions.myEarnings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows = earnings.data ?? [];
  if (earnings.isLoading) return <p className="profile-loading-note">Loading your earnings…</p>;
  if (rows.length === 0) {
    return (
      <div className="an-empty" role="status">
        <WalletCards size={28} aria-hidden="true" />
        <p><strong>No earnings yet.</strong><br />Approved campaign submissions show up here.</p>
      </div>
    );
  }
  const symbolFor = (currency: string | null) =>
    (currency ?? "").toUpperCase() === "BDT" ? "৳" : "$";
  return (
    <div className="an-card">
      <b>Your earnings</b>
      <div className="an-table" role="table" aria-label="Your campaign earnings">
        <div className="an-thead" role="row"><span>Campaign</span><span>Amount</span><span>Status</span></div>
        {rows.map(row => (
          <div className="an-trow" role="row" key={row.id}>
            <span className="an-post"><span>{row.campaignTitle}</span></span>
            <span>{symbolFor(row.currency)}{row.amount}</span>
            <span>{row.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
