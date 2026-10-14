import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Image as ImageIcon,
  Lock,
  Megaphone,
  Type as TypeIcon,
  Video as VideoIcon,
} from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { AdvertiseNav } from "@/components/ads/AdvertiseNav";
import { VideoAdsSection } from "./VideoAds";
import "./advertise.css";
import "./analytics.css";

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${Math.round(n)}`;
}

function formatPct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

/** Format an agreed creator reward honestly from the DB value (numeric). */
function formatReward(amount: string | null, currency: string | null): string {
  if (amount == null) return "—";
  const n = Number(amount);
  const val = Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : amount;
  const c = (currency ?? "").trim().toUpperCase();
  if (c === "USD") return `$${val}`;
  if (c === "BDT") return `৳${val}`;
  return c ? `${val} ${c}` : `${val}`;
}

const TYPE_META = {
  VIDEO: { label: "Videos", icon: VideoIcon },
  IMAGE: { label: "Photos", icon: ImageIcon },
  TEXT: { label: "Text posts", icon: TypeIcon },
} as const;

/**
 * My Ads — the user's OWN campaigns with real analytics.
 * Confirmed IA: lives inside /advertise at the top (Advertise | My Ads |
 * Apply), never called "dashboard". Only the owner's own campaigns — the
 * API never selects other brands' data, pool, or fee splits.
 * Honest empty states: "No running ads" when there are no campaigns —
 * never blank, never fake numbers.
 */
export default function MyAds() {
  const [, navigate] = useLocation();
  const auth = useAuth();

  return (
    <main className="adv-page">
      <div className="adv-topbar">
        <button
          type="button"
          className="adv-back"
          onClick={() => navigate("/advertise")}
          aria-label="Back to advertise"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="adv-topbar-title">My Ads</span>
        <span style={{ width: 40 }} aria-hidden="true" />
      </div>

      <AdvertiseNav active="my-ads" />

      <div className="adv-form">
        {auth.isAuthenticated ? (
          <>
            <MyAdsContent />
            <VideoAdsSection />
          </>
        ) : (
          <section className="adv-card" aria-label="Sign in required">
            <h2>My Ads</h2>
            <p className="adv-hint">
              Sign in to see your campaigns and their performance.
            </p>
            <button
              type="button"
              className="adv-cta full"
              onClick={() => navigate("/advertise")}
            >
              Back to Advertise
              <ArrowRight size={18} />
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function MyAdsContent() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const dashboard = trpc.analytics.brandDashboard.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const myApps = trpc.brands.myApplications.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const updateStatus = trpc.campaigns.updateMyStatus.useMutation();
  const data = dashboard.data;

  if (dashboard.isLoading) {
    return (
      <section className="adv-card" aria-label="My ads">
        <p className="profile-loading-note">Loading your ads…</p>
      </section>
    );
  }

  const campaigns = data?.campaigns ?? [];

  // No campaigns at all → honest empty state, never blank, never fake.
  if (campaigns.length === 0) {
    const apps = myApps.data ?? [];
    const pendingApp = apps.find(a =>
      ["submitted", "pending", "info_requested", "approved"].includes(a.status)
    );
    return (
      <section className="adv-card" aria-label="No running ads">
        <div className="an-empty" role="status">
          <Megaphone size={28} aria-hidden="true" />
          <p>
            <strong>No running ads.</strong>
            <br />
            {pendingApp
              ? `Your application for “${pendingApp.brandName}” is ${pendingApp.status.replace(/_/g, " ")} — campaigns will appear here once one is live.`
              : "When you run a campaign, it will show up here with real performance numbers."}
          </p>
          {!pendingApp ? (
            <button
              type="button"
              className="adv-cta"
              onClick={() => navigate("/advertise/apply")}
            >
              Apply as a Brand
              <ArrowRight size={18} />
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const { totals, byType } = data!;

  const setCampaignStatus = async (
    campaignId: number,
    status: "active" | "paused" | "ended"
  ) => {
    try {
      await updateStatus.mutateAsync({ id: campaignId, status });
      await utils.analytics.brandDashboard.invalidate();
    } catch {
      /* Error surfaces via the mutation state; card stays as-is. */
    }
  };

  return (
    <section className="adv-card" aria-label="My ads report">
      <div className="an-head">
        <h3>
          <BarChart3 size={18} aria-hidden="true" /> My Ads
        </h3>
        <span className="an-priv">
          <Lock
            size={12}
            aria-hidden="true"
            style={{ verticalAlign: "-1px", marginRight: 4 }}
          />
          Your campaigns only
        </span>
      </div>

      {/* KPI SUMMARY */}
      <div className="an-kpis cols-4">
        <div className="an-kpi">
          <b>{formatCompact(totals.impressions)}</b>
          <span>Impressions</span>
        </div>
        <div className="an-kpi">
          <b>{formatCompact(totals.views)}</b>
          <span>Views</span>
        </div>
        <div className="an-kpi">
          <b>{formatCompact(totals.clicks)}</b>
          <span>Clicks</span>
        </div>
        <div className="an-kpi">
          <b>{formatPct(totals.ctr)}</b>
          <span>Avg CTR</span>
        </div>
      </div>

      <div className="an-wrap">
        {campaigns.map(camp => {
          const dotClass =
            camp.status === "active"
              ? "g"
              : camp.status === "paused"
                ? "a"
                : camp.status === "draft"
                  ? "b"
                  : "gr";
          const statusLabel =
            camp.status.charAt(0).toUpperCase() + camp.status.slice(1);
          const modeLabel =
            camp.runMode === "continuous"
              ? "Continuous"
              : `Scheduled${camp.endsAt ? ` · ends ${new Date(camp.endsAt).toLocaleDateString()}` : ""}`;
          const spentPct =
            camp.budgetCents && camp.budgetCents > 0
              ? Math.min(100, (camp.spentCents / camp.budgetCents) * 100)
              : 0;
          const sym =
            (camp.currency ?? "").toUpperCase() === "BDT" ? "৳" : "$";
          return (
            <div className="fb-card" key={camp.campaignId}>
              <div>
                <div className="fb-name">{camp.title}</div>
                <div className="fb-meta">
                  <i className={`dot ${dotClass}`} aria-hidden="true" />
                  {statusLabel} · {modeLabel}
                </div>
              </div>
              <div className="fb-stats">
                <div>
                  <b>{formatCompact(camp.impressions)}</b>
                  <span>Impressions</span>
                </div>
                <div>
                  <b>{formatCompact(camp.clicks)}</b>
                  <span>Clicks</span>
                </div>
                <div>
                  <b>{formatPct(camp.ctr)}</b>
                  <span>CTR</span>
                </div>
              </div>
              {camp.budgetCents ? (
                <>
                  <div
                    className="fb-bar"
                    role="progressbar"
                    aria-label="Budget spent"
                    aria-valuenow={Math.round(spentPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div style={{ width: `${spentPct}%` }} />
                  </div>
                  <div className="fb-spent">
                    {sym}
                    {(camp.spentCents / 100).toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    of {sym}
                    {(camp.budgetCents / 100).toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    spent
                  </div>
                </>
              ) : null}
              <div className="fb-actions">
                {camp.status === "active" ? (
                  <button
                    type="button"
                    className="fb-btn sec"
                    disabled={updateStatus.isPending}
                    onClick={() =>
                      void setCampaignStatus(camp.campaignId, "paused")
                    }
                  >
                    Pause
                  </button>
                ) : null}
                {camp.status === "paused" ? (
                  <button
                    type="button"
                    className="fb-btn pri"
                    disabled={updateStatus.isPending}
                    onClick={() =>
                      void setCampaignStatus(camp.campaignId, "active")
                    }
                  >
                    Resume
                  </button>
                ) : null}
                {camp.status === "draft" ? (
                  <span className="fb-spent">
                    Under review — activates once approved.
                  </span>
                ) : null}
                {camp.status === "active" || camp.status === "paused" ? (
                  <button
                    type="button"
                    className="fb-btn sec danger"
                    disabled={updateStatus.isPending}
                    onClick={() =>
                      void setCampaignStatus(camp.campaignId, "ended")
                    }
                  >
                    End
                  </button>
                ) : null}
              </div>
              {camp.creators.length > 0 ? (
                <div
                  className="an-table"
                  role="table"
                  aria-label={`Creator performance for ${camp.title}`}
                >
                  <div className="an-thead" role="row">
                    <span>Creator</span>
                    <span>Views</span>
                    <span>Eng.</span>
                    <span>Reward</span>
                  </div>
                  {camp.creators.map(c => (
                    <div className="an-trow" role="row" key={c.userId}>
                      <span className="an-post">
                        <span>
                          {c.username
                            ? `@${c.username}`
                            : (c.displayName ?? "Creator")}
                        </span>
                      </span>
                      <span>{formatCompact(c.views)}</span>
                      <b>{formatPct(c.engagementRate)}</b>
                      <b className="an-ok">
                        {formatReward(c.rewardAmount, c.rewardCurrency)}
                      </b>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* BY CONTENT TYPE — FB table style */}
        <div className="an-card">
          <b>By content type</b>
          <div
            className="an-table"
            role="table"
            aria-label="Performance by content type"
          >
            <div className="an-thead" role="row">
              <span>Type</span>
              <span>Views</span>
              <span>Eng.</span>
              <span>Rate</span>
            </div>
            {(Object.keys(TYPE_META) as Array<keyof typeof TYPE_META>).map(
              key => {
                const meta = TYPE_META[key];
                const Icon = meta.icon;
                const row = byType[key];
                // Facebook formula, computed from real DB numbers.
                const rate =
                  row.reach > 0
                    ? +((row.engagements / row.reach) * 100).toFixed(1)
                    : null;
                return (
                  <div className="an-trow" role="row" key={key}>
                    <span className="an-post">
                      <Icon size={15} aria-hidden="true" />
                      <span>{meta.label}</span>
                    </span>
                    <span>{formatCompact(row.views)}</span>
                    <span>{formatCompact(row.engagements)}</span>
                    <b>{formatPct(rate)}</b>
                  </div>
                );
              }
            )}
          </div>
        </div>

        <p className="an-fine">
          Estimated — Not Guaranteed · Real database numbers
        </p>
        <p className="fb-note">
          When the budget runs out, the ad pauses automatically.
        </p>
      </div>
    </section>
  );
}
