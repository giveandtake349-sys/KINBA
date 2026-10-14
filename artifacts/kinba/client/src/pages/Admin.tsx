/**
 * JHILIK Admin Control Center — unified, Meta-style.
 *
 * Tabs: Overview | Ads | Revenue | Users | Content | Broadcasts | Settings
 * FB-classic professional styling. No fake data — honest empty states.
 * Role-based: admin sees all; moderators see Overview/Users/Content only.
 */
import { useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bell,
  CheckCircle2,
  DollarSign,
  Eye,
  Flag,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  XCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import AdminCampaigns from "./AdminCampaigns";

type TabId =
  | "overview"
  | "ads"
  | "revenue"
  | "users"
  | "content"
  | "broadcasts"
  | "settings";

const TABS: { id: TabId; label: string; icon: typeof Bell; adminOnly?: boolean }[] = [
  { id: "overview", label: "Overview", icon: Bell },
  { id: "ads", label: "Ads", icon: Megaphone, adminOnly: true },
  { id: "revenue", label: "Revenue", icon: DollarSign, adminOnly: true },
  { id: "users", label: "Users", icon: Users },
  { id: "content", label: "Content", icon: Flag },
  { id: "broadcasts", label: "Broadcasts", icon: Bell, adminOnly: true },
  { id: "settings", label: "Settings", icon: Settings2, adminOnly: true },
];

const fmtMoney = (cents: number, currency = "USD") =>
  `${currency === "BDT" ? "৳" : "$"}${(cents / 100).toFixed(2)}`;

const fmtDate = (v: Date | string | null | undefined) =>
  v ? new Date(v).toLocaleString() : "—";

export default function Admin() {
  const auth = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabId>("overview");
  const isAdmin = auth.user?.role === "admin";
  const isModerator = auth.user?.role === "moderator" || isAdmin;

  if (auth.loading) {
    return (
      <main className="admin-page section-shell">
        <p className="profile-loading-note">Checking access…</p>
      </main>
    );
  }
  if (!isModerator) {
    return (
      <main className="admin-page section-shell">
        <p className="profile-loading-note">Admin access required.</p>
        <button type="button" className="muted-btn" onClick={() => navigate("/")}>
          Back to feed
        </button>
      </main>
    );
  }

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <main className="admin-page section-shell">
      <button
        type="button"
        className="admin-back-btn"
        onClick={() => navigate("/")}
      >
        <ArrowLeft size={16} /> Back to feed
      </button>
      <header className="admin-page__header">
        <div>
          <p className="eyebrow eyebrow--bright">
            <ShieldCheck size={16} /> Control Center
          </p>
          <h1>JHILIK Admin</h1>
          <p>
            {isAdmin
              ? "Full platform control — ads, revenue, users, content."
              : "Moderator access — users and content."}
          </p>
        </div>
        <span className="admin-role-badge">
          {isAdmin ? "Admin" : "Moderator"}
        </span>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {visibleTabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={`admin-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "overview" && <OverviewTab />}
      {tab === "ads" && isAdmin && <AdminCampaigns />}
      {tab === "revenue" && isAdmin && <RevenueTab />}
      {tab === "users" && <UsersTab isAdmin={isAdmin} />}
      {tab === "content" && <ContentTab />}
      {tab === "broadcasts" && isAdmin && <BroadcastsTab />}
      {tab === "settings" && isAdmin && <SettingsTab />}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                             */
/* ------------------------------------------------------------------ */

function OverviewTab() {
  const overview = trpc.admin.control.overview.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const d = overview.data;
  return (
    <section className="admin-card">
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>Overview</h2>
          <p className="admin-tab-desc">
            Live platform health at a glance — users, content, ad revenue and
            everything waiting for your attention.
          </p>
        </div>
        {!overview.isPending && !overview.isError && (
          <button
            type="button"
            className="admin-refresh-btn"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw size={14} />
            {overview.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
      {overview.isPending ? (
        <p className="profile-loading-note">Loading…</p>
      ) : overview.isError ? (
        <div className="admin-error-box">
          <p className="form-message">
            Could not load overview: {overview.error?.message ?? "Unknown error"}
          </p>
          <button
            type="button"
            className="admin-refresh-btn"
            onClick={() => overview.refetch()}
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      ) : d ? (
        <>
          <div className="admin-stat-grid">
            <div className="admin-stat">
              <Users size={18} />
              <span>Users</span>
              <strong>{d.users.toLocaleString()}</strong>
            </div>
            <div className="admin-stat">
              <Eye size={18} />
              <span>Content</span>
              <strong>{d.content.toLocaleString()}</strong>
            </div>
            <div className="admin-stat">
              <DollarSign size={18} />
              <span>Ad revenue</span>
              <strong>{fmtMoney(d.adRevenueCents)}</strong>
            </div>
            <div className="admin-stat">
              <ShieldAlert size={18} />
              <span>Pending payouts</span>
              <strong>{d.pendingPayouts}</strong>
            </div>
          </div>
          <div className="admin-attention">
            <h3>Needs action</h3>
            <div className="admin-attention-row">
              <span>
                <i className="dot dot-red" /> {d.pendingAdReviews} ads pending review
              </span>
            </div>
            <div className="admin-attention-row">
              <span>
                <i className="dot dot-red" /> {d.openReports} open reports
              </span>
            </div>
            <div className="admin-attention-row">
              <span>
                <i className="dot dot-amber" /> {d.pendingPayouts} payouts pending
              </span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Revenue                                                              */
/* ------------------------------------------------------------------ */

function RevenueTab() {
  const utils = trpc.useUtils();
  const settings = trpc.admin.control.revenueSettings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const payouts = trpc.admin.control.payoutQueue.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const [defaultPct, setDefaultPct] = useState("");
  const [notice, setNotice] = useState("");

  const setDefault = trpc.admin.control.setDefaultPercent.useMutation({
    onSuccess: () => {
      setNotice("Default split updated.");
      setDefaultPct("");
      utils.admin.control.revenueSettings.invalidate();
    },
    onError: e => setNotice(e.message),
  });
  const release = trpc.admin.control.releasePayout.useMutation({
    onSuccess: () => {
      setNotice("Payout released.");
      utils.admin.control.payoutQueue.invalidate();
    },
    onError: e => setNotice(e.message),
  });
  const delOverride = trpc.admin.control.deleteRevenueOverride.useMutation({
    onSuccess: () => {
      setNotice("Override removed.");
      utils.admin.control.revenueSettings.invalidate();
    },
    onError: e => setNotice(e.message),
  });

  const s = settings.data;
  return (
    <section className="admin-card">
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Money</p>
          <h2>Revenue control</h2>
        </div>
        <DollarSign size={24} />
      </div>
      <p className="admin-help">
        You decide the creator's cut. Creators see only their own earnings —
        never the split, never others' data.
      </p>
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}

      <h3>Default split</h3>
      {settings.isPending ? (
        <p className="profile-loading-note">Loading…</p>
      ) : s ? (
        <div className="admin-split-row">
          <div>
            <span>Creator</span>
            <strong>{s.defaultCreatorPercent}%</strong>
          </div>
          <div className="admin-split-bar">
            <div style={{ width: `${s.defaultCreatorPercent}%` }} />
          </div>
          <div>
            <span>Platform</span>
            <strong>{100 - s.defaultCreatorPercent}%</strong>
          </div>
          <div className="admin-inline-form">
            <input
              type="number"
              min={0}
              max={100}
              placeholder="New %"
              value={defaultPct}
              onChange={e => setDefaultPct(e.target.value)}
              aria-label="New default creator percent"
            />
            <button
              type="button"
              className="muted-btn"
              disabled={setDefault.isPending || !defaultPct}
              onClick={() => setDefault.mutate({ percent: Number(defaultPct) })}
            >
              Update
            </button>
          </div>
        </div>
      ) : null}

      <h3>Overrides</h3>
      {!s?.overrides.length ? (
        <p className="admin-empty">No overrides. Default applies everywhere.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Creator</th>
                <th>Cut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.overrides.map(o => (
                <tr key={o.id}>
                  <td>{o.adTitle ?? (o.adId ? `Ad #${o.adId}` : "—")}</td>
                  <td>{o.creatorName ?? (o.creatorId ? `User #${o.creatorId}` : "All")}</td>
                  <td>{o.creatorPercent}%</td>
                  <td>
                    <button
                      type="button"
                      className="muted-btn"
                      onClick={() => delOverride.mutate({ id: o.id })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Payout queue</h3>
      {payouts.isPending ? (
        <p className="profile-loading-note">Loading…</p>
      ) : !payouts.data?.length ? (
        <p className="admin-empty">No pending payouts.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Amount</th>
                <th>Earnings</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payouts.data.map(p => (
                <tr key={p.creatorId}>
                  <td>{p.creatorName ?? `User #${p.creatorId}`}</td>
                  <td>{fmtMoney(p.totalCents, p.currency)}</td>
                  <td>{p.earningCount}</td>
                  <td>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => release.mutate({ creatorId: p.creatorId })}
                    >
                      <CheckCircle2 size={14} /> Release
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Users                                                                */
/* ------------------------------------------------------------------ */

function UsersTab({ isAdmin }: { isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const search = trpc.admin.control.searchUsers.useQuery(
    { query },
    { enabled: query.trim().length >= 2, refetchOnWindowFocus: false }
  );

  const moderate = trpc.admin.control.moderateUser.useMutation({
    onSuccess: () => {
      setNotice("Action applied.");
      utils.admin.control.searchUsers.invalidate();
    },
    onError: e => setNotice(e.message),
  });
  const setRole = trpc.admin.control.setUserRole.useMutation({
    onSuccess: () => {
      setNotice("Role updated.");
      utils.admin.control.searchUsers.invalidate();
    },
    onError: e => setNotice(e.message),
  });

  return (
    <section className="admin-card">
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">People</p>
          <h2>Users</h2>
          <p className="admin-tab-desc">
            Search any account, warn, restrict, suspend or ban — and assign
            moderator roles. Strict hierarchy: moderators can't touch admins.
          </p>
        </div>
        <Users size={24} />
      </div>
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}
      <label className="admin-field">
        <span>Search by name or email</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type at least 2 characters…"
        />
      </label>
      {search.data && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {search.data.map(u => (
                <tr key={u.id}>
                  <td>
                    {u.name ?? u.email ?? `User #${u.id}`}
                    <br />
                    <small>{fmtDate(u.createdAt)}</small>
                  </td>
                  <td>
                    <span className="admin-pill">{u.role}</span>
                    {isAdmin && (
                      <select
                        value={u.role}
                        onChange={e =>
                          setRole.mutate({
                            userId: u.id,
                            role: e.target.value as "user" | "moderator" | "admin",
                          })
                        }
                        aria-label="Change role"
                      >
                        <option value="user">user</option>
                        <option value="moderator">moderator</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {u.isBanned ? (
                      <span className="admin-pill admin-pill--red">banned</span>
                    ) : u.suspendedUntil &&
                      new Date(u.suspendedUntil) > new Date() ? (
                      <span className="admin-pill admin-pill--amber">suspended</span>
                    ) : (
                      <span className="admin-pill admin-pill--green">active</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      {!u.isBanned ? (
                        <>
                          <button
                            type="button"
                            className="muted-btn"
                            title="Warn"
                            onClick={() =>
                              moderate.mutate({ userId: u.id, action: "warn" })
                            }
                          >
                            <Flag size={14} />
                          </button>
                          <button
                            type="button"
                            className="muted-btn"
                            title="Restrict 24h"
                            onClick={() =>
                              moderate.mutate({ userId: u.id, action: "restrict" })
                            }
                          >
                            <Pause size={14} />
                          </button>
                          <button
                            type="button"
                            className="muted-btn"
                            title="Suspend 7d"
                            onClick={() =>
                              moderate.mutate({ userId: u.id, action: "suspend" })
                            }
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="danger-btn"
                            title="Ban"
                            onClick={() =>
                              moderate.mutate({ userId: u.id, action: "ban" })
                            }
                          >
                            <Ban size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() =>
                            moderate.mutate({ userId: u.id, action: "unban" })
                          }
                        >
                          <Play size={14} /> Unban
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {search.data && !search.data.length && (
        <p className="admin-empty">No users found.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Content — Meta 3-tier: REMOVE / REDUCE / KEEP                         */
/* ------------------------------------------------------------------ */

function ContentTab() {
  const utils = trpc.useUtils();
  const [notice, setNotice] = useState("");
  const queue = trpc.admin.control.moderationQueue.useQuery(
    { limit: 25, offset: 0 },
    { refetchOnWindowFocus: false }
  );
  const decide = trpc.admin.control.decideModeration.useMutation({
    onSuccess: () => {
      setNotice("Decision recorded.");
      utils.admin.control.moderationQueue.invalidate();
    },
    onError: e => setNotice(e.message),
  });

  return (
    <section className="admin-card">
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Enforcement</p>
          <h2>Moderation queue</h2>
        </div>
        <Flag size={24} />
      </div>
      <p className="admin-help">
        Meta 3-tier model: <strong>Remove</strong> (violates standards),{" "}
        <strong>Reduce</strong> (limit distribution), <strong>Keep</strong>{" "}
        (dismiss report).
      </p>
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}
      {queue.isPending ? (
        <p className="profile-loading-note">Loading…</p>
      ) : !queue.data?.length ? (
        <p className="admin-empty">Queue is clear. No open reports.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Reason</th>
                <th>Reports</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map(r => (
                <tr key={r.id}>
                  <td>
                    {r.targetType} #{r.targetId}
                    <br />
                    <small>by {r.reporterName ?? "unknown"}</small>
                  </td>
                  <td>{r.reason}</td>
                  <td>{r.reportCount}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="danger-btn"
                        title="Remove — violates standards"
                        onClick={() =>
                          decide.mutate({ reportId: r.id, decision: "remove" })
                        }
                      >
                        <XCircle size={14} /> Remove
                      </button>
                      <button
                        type="button"
                        className="muted-btn"
                        title="Reduce — limit distribution"
                        onClick={() =>
                          decide.mutate({ reportId: r.id, decision: "reduce" })
                        }
                      >
                        <Eye size={14} /> Reduce
                      </button>
                      <button
                        type="button"
                        className="muted-btn"
                        title="Keep — dismiss report"
                        onClick={() =>
                          decide.mutate({ reportId: r.id, decision: "keep" })
                        }
                      >
                        <CheckCircle2 size={14} /> Keep
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Broadcasts                                                           */
/* ------------------------------------------------------------------ */

function BroadcastsTab() {
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const create = trpc.community.create.useMutation({
    onSuccess: () => {
      setNotice("Announcement published.");
      setBody("");
    },
    onError: e => setNotice(e.message),
  });

  return (
    <section className="admin-card">
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Comms</p>
          <h2>Broadcasts</h2>
          <p className="admin-tab-desc">
            Publish platform-wide announcements every user will see.
          </p>
        </div>
        <Megaphone size={24} />
      </div>
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}
      <label className="admin-field">
        <span>Message</span>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={4}
          placeholder="Write the announcement…"
        />
      </label>
      <button
        type="button"
        className="primary-btn"
        disabled={create.isPending || !body.trim()}
        onClick={() => create.mutate({ body: body.trim() })}
      >
        <Megaphone size={16} /> Publish announcement
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Settings — audit log                                                  */
/* ------------------------------------------------------------------ */

function SettingsTab() {
  const [notice, setNotice] = useState("");
  const audit = trpc.admin.control.auditLog.useQuery(
    { limit: 50, offset: 0 },
    { refetchOnWindowFocus: false }
  );

  return (
    <section className="admin-card">
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Platform</p>
          <h2>Settings</h2>
          <p className="admin-tab-desc">
            Platform policy, feature flags and the full audit log — every
            admin action, who did it and when.
          </p>
        </div>
        <Settings2 size={24} />
      </div>
      {notice && (
        <p className="form-message" role="status">
          {notice}
        </p>
      )}

      <h3>Audit log</h3>
      <p className="admin-help">
        Every admin action is recorded: who did what, when.
      </p>
      {audit.isPending ? (
        <p className="profile-loading-note">Loading…</p>
      ) : !audit.data?.length ? (
        <p className="admin-empty">No admin actions logged yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map(a => (
                <tr key={a.id}>
                  <td>{fmtDate(a.createdAt)}</td>
                  <td>{a.adminName ?? `User #${a.adminId}`}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>
                    {a.targetType ? `${a.targetType} ${a.targetId ?? ""}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Quick links</h3>
      <div className="admin-row-actions">
        <button
          type="button"
          className="muted-btn"
          onClick={() => setNotice("Verification queue lives in the main admin router.")}
        >
          <BadgeCheck size={16} /> Verification
        </button>
        <button
          type="button"
          className="muted-btn"
          onClick={() => setNotice("Feature flags are under Ads → Video ads settings.")}
        >
          <SlidersHorizontal size={16} /> Feature flags
        </button>
        <button
          type="button"
          className="muted-btn"
          onClick={() => setNotice("Ad eligibility and pricing are under Ads → Video ads.")}
        >
          <ScrollText size={16} /> Ad settings
        </button>
      </div>
    </section>
  );
}
