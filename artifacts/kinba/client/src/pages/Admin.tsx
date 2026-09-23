import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Clock3,
  ExternalLink,
  Flag,
  EyeOff,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getTrpcCode } from "@/pages/HypeRooms";

type ReportStatusFilter = "all" | "open" | "resolved";
type ReportTargetFilter =
  | "all"
  | "hype_room"
  | "hype_room_message"
  | "drop"
  | "user";

const formatDate = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";

const TARGET_LABELS: Record<Exclude<ReportTargetFilter, "all">, string> = {
  hype_room: "Hype Room",
  hype_room_message: "Hype Room Message",
  drop: "Drop",
  user: "User",
};

function moderationErrorMessage(error: unknown): string {
  if (getTrpcCode(error) === "PRECONDITION_FAILED") {
    return "Reporting is currently unavailable.";
  }
  return error instanceof Error ? error.message : "Request failed.";
}

export default function Admin() {
  const auth = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = auth.user?.role === "admin";
  const dashboard = trpc.admin.dashboard.useQuery(undefined, {
    enabled: !auth.loading && isAdmin,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const createSession = trpc.admin.createSession.useMutation();
  const startSession = trpc.admin.startSession.useMutation();
  const setSponsorStatus = trpc.admin.setSponsorStatus.useMutation();
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("TimeWheels Session");
  const [startsAt, setStartsAt] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingSponsor, setPendingSponsor] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("open");
  const [targetFilter, setTargetFilter] = useState<ReportTargetFilter>("all");
  const [resolveReportId, setResolveReportId] = useState<number | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [hideMessageId, setHideMessageId] = useState<number | null>(null);
  const [hideReason, setHideReason] = useState("");

  const reportsQuery = trpc.admin.reports.list.useQuery(
    {
      ...(statusFilter === "all"
        ? {}
        : { status: statusFilter }),
      ...(targetFilter === "all" ? {} : { targetType: targetFilter }),
      limit: 50,
    },
    {
      enabled: !auth.loading && isAdmin,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    }
  );
  const resolveReport = trpc.admin.reports.resolve.useMutation();
  const hideMessage = trpc.admin.messages.hide.useMutation();

  const refreshReports = async () => {
    await utils.admin.reports.list.invalidate();
  };

  useEffect(() => {
    if (!auth.loading && (!auth.user || !isAdmin)) navigate("/");
  }, [auth.loading, auth.user, isAdmin, navigate]);

  const refresh = async () => {
    await utils.admin.dashboard.invalidate();
  };
  const submitSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    try {
      await createSession.mutateAsync({
        title,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      });
      setNotice("Session scheduled. The one-hour entry window will open automatically.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Session could not be scheduled.");
    }
  };
  const manualStart = async (sessionId: number) => {
    setNotice("");
    try {
      await startSession.mutateAsync({ sessionId });
      setNotice("Session entry window opened for the next hour.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Session could not be started.");
    }
  };
  const updateSponsor = async (sponsorId: number, status: "approved" | "rejected") => {
    setPendingSponsor(sponsorId);
    try {
      await setSponsorStatus.mutateAsync({ sponsorId, status });
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sponsor status could not be updated.");
    } finally {
      setPendingSponsor(null);
    }
  };

  const handleResolve = async (reportId: number) => {
    const reason = resolveReason.trim();
    if (!reason || reason.length > 500) return;
    setNotice("");
    try {
      await resolveReport.mutateAsync({ reportId, reason });
      setResolveReportId(null);
      setResolveReason("");
      setNotice("Report resolved.");
      await refreshReports();
    } catch (error) {
      setNotice(moderationErrorMessage(error));
    }
  };

  const handleHideMessage = async (messageId: number) => {
    const reason = hideReason.trim();
    if (!reason || reason.length > 500) return;
    setNotice("");
    try {
      await hideMessage.mutateAsync({ messageId, reason });
      setHideMessageId(null);
      setHideReason("");
      setNotice("Message hidden.");
      await refreshReports();
    } catch (error) {
      setNotice(moderationErrorMessage(error));
    }
  };

  const data = dashboard.data;
  const totals = useMemo(() => ({
    wallets: data?.wallets.length ?? 0,
    sponsors: data?.sponsors.filter(row => row.sponsor.status === "pending").length ?? 0,
    payouts: data?.ledger.filter(row => row.transaction.type === "sponsor_bids_prize").length ?? 0,
  }), [data]);

  if (auth.loading || !isAdmin) return <main className="admin-page section-shell"><p className="profile-loading-note">Checking admin access…</p></main>;

  return (
    <main className="admin-page section-shell">
      <button
        type="button"
        className="admin-back-btn"
        onClick={() => navigate("/")}
      >
        <ArrowLeft size={15} />
        Back to feed
      </button>
      <header className="admin-page__header">
        <div>
          <p className="eyebrow eyebrow--bright"><ShieldCheck size={15} /> Restricted control center</p>
          <h1>TimeWheels Admin</h1>
          <p>Manage sessions, review wallet activity, and approve live sponsorships.</p>
        </div>
        <span className="admin-role-badge">Admin access</span>
      </header>
      {notice && <p className="form-message" role="status">{notice}</p>}

      <section className="admin-card admin-session-control">
        <div className="admin-section-heading"><div><p className="eyebrow">Session control</p><h2>Open a new TimeWheels entry window</h2></div><Clock3 size={22} /></div>
        <form className="admin-session-form" onSubmit={submitSession}>
          <label>Session title<input value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={180} required /></label>
          <label>Wheel start time<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
          <button className="primary-btn" type="submit" disabled={createSession.isPending}>{createSession.isPending ? "Scheduling…" : "Schedule Session"}</button>
        </form>
        <p className="admin-help">Leave the start time blank to schedule the wheel one hour from now, which opens the entry window immediately.</p>
        <div className="admin-session-list">
          {(data?.sessions ?? []).map(session => (
            <div className="admin-session-row" key={session.id}>
              <div><strong>{session.title}</strong><span>{session.status} · Starts {formatDate(session.startsAt)}</span></div>
              {session.status === "scheduled" && <button className="muted-btn" type="button" onClick={() => manualStart(session.id)} disabled={startSession.isPending}>Start 1-hour window</button>}
            </div>
          ))}
        </div>
      </section>

      <div className="admin-stat-grid">
        <div className="admin-stat"><WalletCards size={18} /><span>Wallets monitored</span><strong>{totals.wallets}</strong></div>
        <div className="admin-stat"><Clock3 size={18} /><span>Pending sponsors</span><strong>{totals.sponsors}</strong></div>
        <div className="admin-stat"><ShieldCheck size={18} /><span>Payout entries</span><strong>{totals.payouts}</strong></div>
      </div>

      <section className="admin-card">
        <div className="admin-section-heading"><div><p className="eyebrow">Financial monitoring</p><h2>Wallet balances & ledger</h2></div></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Balance</th><th>Recent activity</th></tr></thead><tbody>
          {(data?.wallets ?? []).map(row => <tr key={row.wallet.id}><td>{row.user.name || row.user.email || `User #${row.user.id}`}</td><td>৳{Number(row.wallet.balance).toFixed(2)}</td><td>{formatDate(row.wallet.updatedAt)}</td></tr>)}
        </tbody></table></div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Type</th><th>User</th><th>Amount</th><th>Reference</th></tr></thead><tbody>
          {(data?.ledger ?? []).map(row => <tr key={row.transaction.id}><td>{row.transaction.type}</td><td>{row.user.name || row.user.email || `User #${row.user.id}`}</td><td className={Number(row.transaction.amount) >= 0 ? "ledger-credit" : "ledger-debit"}>৳{Number(row.transaction.amount).toFixed(2)}</td><td>{row.transaction.referenceKey}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="admin-card">
        <div className="admin-section-heading"><div><p className="eyebrow">Sponsorship moderation</p><h2>Review Sponsor This Wheel requests</h2></div></div>
        <div className="admin-sponsor-list">
          {(data?.sponsors ?? []).map(row => <article className="admin-sponsor-row" key={row.sponsor.id}>
            <img src={row.sponsor.logoUrl} alt="Sponsor logo" />
            <div><strong>{row.user.name || row.user.email || `User #${row.user.id}`}</strong><span>{row.session.title} · ৳{Number(row.sponsor.sponsoredAmount).toFixed(2)} · Expires {formatDate(row.sponsor.expiresAt)}</span><a href={row.sponsor.externalLink} target="_blank" rel="noreferrer">Open sponsor link <ExternalLink size={13} /></a></div>
            <div className="admin-sponsor-actions"><span className={`status-chip status-chip--${row.sponsor.status}`}>{row.sponsor.status}</span>{row.sponsor.status === "pending" && <><button className="muted-btn" type="button" onClick={() => updateSponsor(row.sponsor.id, "approved")} disabled={pendingSponsor === row.sponsor.id}>Approve</button><button className="danger-btn" type="button" onClick={() => updateSponsor(row.sponsor.id, "rejected")} disabled={pendingSponsor === row.sponsor.id}>Reject</button></>}</div>
          </article>)}
        </div>
      </section>

      <section className="admin-card admin-reports-section" aria-label="Reports">
        <div className="admin-section-heading">
          <div>
            <p className="eyebrow">Content reports</p>
            <h2>Reports</h2>
          </div>
          <Flag size={22} />
        </div>
        <p className="admin-help">
          Raw report rows only — targetId is the backend target ID for the reported content.
        </p>
        <div className="admin-reports-filters">
          <label>
            Status
            <select
              value={statusFilter}
              onChange={event => {
                setStatusFilter(event.target.value as ReportStatusFilter);
                setResolveReportId(null);
              }}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <label>
            Target type
            <select
              value={targetFilter}
              onChange={event => {
                setTargetFilter(event.target.value as ReportTargetFilter);
                setResolveReportId(null);
                setHideMessageId(null);
              }}
            >
              <option value="all">All</option>
              <option value="hype_room">Hype Room</option>
              <option value="hype_room_message">Hype Room Message</option>
              <option value="drop">Drop</option>
              <option value="user">User</option>
            </select>
          </label>
          <button
            type="button"
            className="muted-btn"
            onClick={() => void refreshReports()}
            disabled={reportsQuery.isFetching}
          >
            {reportsQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {reportsQuery.isPending ? (
          <p className="admin-reports-empty">Loading reports…</p>
        ) : reportsQuery.isError ? (
          <div className="admin-reports-empty">
            <p>{moderationErrorMessage(reportsQuery.error)}</p>
            <button
              type="button"
              className="muted-btn"
              onClick={() => void reportsQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (reportsQuery.data?.reports ?? []).length === 0 ? (
          <p className="admin-reports-empty">No reports match these filters.</p>
        ) : (
          <div className="admin-reports-list">
            {(reportsQuery.data?.reports ?? []).map(report => (
              <article className="admin-report-row" key={report.id}>
                <div className="admin-report-meta">
                  <span className={`status-chip status-chip--${report.status}`}>
                    {report.status}
                  </span>
                  <span className="admin-report-id">Report #{report.id}</span>
                  <span className="admin-report-target">
                    {TARGET_LABELS[report.targetType as Exclude<ReportTargetFilter, "all">] ?? report.targetType}
                    {" · targetId "}
                    <strong>{report.targetId}</strong>
                  </span>
                  <span className="admin-report-time">{formatDate(report.createdAt)}</span>
                </div>
                <div className="admin-report-body">
                  <p className="admin-report-reason">{report.reason}</p>
                  {report.details ? (
                    <p className="admin-report-details">{report.details}</p>
                  ) : null}
                  <p className="admin-report-ids">
                    reporterId {report.reporterId}
                    {report.resolvedAt
                      ? ` · resolved ${formatDate(report.resolvedAt)}${report.resolvedBy != null ? ` by ${report.resolvedBy}` : ""}`
                      : ""}
                  </p>
                </div>
                <div className="admin-report-actions">
                  {report.status === "open" ? (
                    resolveReportId === report.id ? (
                      <div className="admin-report-inline-form">
                        <input
                          value={resolveReason}
                          onChange={event => setResolveReason(event.target.value)}
                          maxLength={500}
                          placeholder="Resolution reason (1–500)"
                          aria-label="Resolution reason"
                        />
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={
                            resolveReport.isPending ||
                            resolveReason.trim().length < 1
                          }
                          onClick={() => void handleResolve(report.id)}
                        >
                          {resolveReport.isPending ? "Saving…" : "Confirm resolve"}
                        </button>
                        <button
                          type="button"
                          className="muted-btn"
                          onClick={() => {
                            setResolveReportId(null);
                            setResolveReason("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="muted-btn"
                        onClick={() => {
                          setResolveReportId(report.id);
                          setResolveReason("");
                          setHideMessageId(null);
                        }}
                      >
                        Resolve
                      </button>
                    )
                  ) : null}
                  {report.targetType === "hype_room_message" ? (
                    hideMessageId === report.targetId ? (
                      <div className="admin-report-inline-form">
                        <input
                          value={hideReason}
                          onChange={event => setHideReason(event.target.value)}
                          maxLength={500}
                          placeholder="Hide reason (1–500)"
                          aria-label="Hide reason"
                        />
                        <button
                          type="button"
                          className="danger-btn"
                          disabled={
                            hideMessage.isPending || hideReason.trim().length < 1
                          }
                          onClick={() => void handleHideMessage(report.targetId)}
                        >
                          {hideMessage.isPending ? "Hiding…" : "Confirm hide"}
                        </button>
                        <button
                          type="button"
                          className="muted-btn"
                          onClick={() => {
                            setHideMessageId(null);
                            setHideReason("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="muted-btn"
                        onClick={() => {
                          setHideMessageId(report.targetId);
                          setHideReason("");
                          setResolveReportId(null);
                        }}
                      >
                        <EyeOff size={13} aria-hidden="true" /> Hide message
                      </button>
                    )
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
