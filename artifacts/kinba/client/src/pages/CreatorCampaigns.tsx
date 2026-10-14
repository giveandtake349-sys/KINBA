import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Inbox,
  Loader2,
  Lock,
  Megaphone,
  Send,
  Wallet,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./advertise.css";
import "./campaigns.css";

function formatMoney(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const symbol = currency === "BDT" ? "৳" : "$";
  return `${symbol}${Number(amount).toLocaleString()}`;
}

/** Fiat earnings formatting — Intl per currency, never float math. */
function formatFiat(amount: string | null, currency: string | null): string {
  if (!amount || !currency) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

type Tab = "invitations" | "submit" | "earnings";

type InvitationRow = {
  id: number;
  status: string;
  campaignTitle: string;
  campaignBrief: string | null;
  rewardAmount: string | null;
  rewardCurrency: string | null;
};

/**
 * Creator Campaign Portal (/campaigns).
 * Invitations show ONLY the creator's own reward — never the campaign's
 * total budget, pool, or fee (the API never selects those columns).
 * Earnings shows ONLY the creator's own ledger rows.
 */
export default function CreatorCampaigns() {
  const [tab, setTab] = useState<Tab>("invitations");
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();

  const invitations = trpc.campaigns.myInvitations.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const myCampaigns = trpc.campaigns.myCampaigns.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const respond = trpc.campaigns.respondInvitation.useMutation();
  const [busyId, setBusyId] = useState<number | null>(null);

  const handleRespond = async (invitationId: number, accept: boolean) => {
    setBusyId(invitationId);
    setNotice("");
    try {
      await respond.mutateAsync({ invitationId, accept });
      await utils.campaigns.myInvitations.invalidate();
      await utils.campaigns.myCampaigns.invalidate();
      setNotice(
        accept ? "Invitation accepted — good luck!" : "Invitation declined."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const pending = (invitations.data ?? []).filter(
    inv => inv.status === "pending"
  );

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <button
          type="button"
          className="adv-back"
          onClick={() => window.history.back()}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <span className="adv-topbar-title">Campaigns</span>
        <span style={{ width: 40 }} />
      </div>

      <div className="camp-wrap">
        {notice ? (
          <p className="admin-notice" role="status">
            {notice}
          </p>
        ) : null}

        <div className="camp-tabs" role="tablist" aria-label="Creator campaign views">
          {(
            [
              { id: "invitations", label: "Invitations", icon: Inbox },
              { id: "submit", label: "Submit", icon: Send },
              { id: "earnings", label: "Earnings", icon: Wallet },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={14} aria-hidden="true" /> {label}
              {id === "invitations" && pending.length > 0 ? (
                <span className="camp-count">{pending.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === "invitations" ? (
          <InvitationsTab
            invitations={invitations}
            pending={pending}
            busyId={busyId}
            onRespond={handleRespond}
          />
        ) : null}
        {tab === "submit" ? (
          <SubmitTab
            campaigns={(myCampaigns.data ?? []) as MyCampaign[]}
            isLoading={myCampaigns.isLoading}
            onDone={message => setNotice(message)}
          />
        ) : null}
        {tab === "earnings" ? <EarningsTab /> : null}
      </div>
    </div>
  );
}

function InvitationsTab({
  invitations,
  pending,
  busyId,
  onRespond,
}: {
  invitations: { isLoading: boolean; data?: InvitationRow[] };
  pending: InvitationRow[];
  busyId: number | null;
  onRespond: (invitationId: number, accept: boolean) => Promise<void>;
}) {
  const handled = (invitations.data ?? []).filter(
    inv => inv.status !== "pending"
  );

  return (
    <section aria-label="Invitations">
      <h2 className="camp-section-title">
        <Inbox size={17} aria-hidden="true" /> Invitations
        {pending.length > 0 ? (
          <span className="camp-count">{pending.length}</span>
        ) : null}
      </h2>
      {invitations.isLoading ? (
        <p className="profile-loading-note">Loading invitations…</p>
      ) : pending.length === 0 ? (
        <p className="profile-loading-note">
          No pending invitations right now.
        </p>
      ) : (
        pending.map(inv => (
          <article key={inv.id} className="camp-invite-card">
            <p className="camp-private">
              <Lock size={12} aria-hidden="true" /> Only you see this offer
            </p>
            <h3>{inv.campaignTitle}</h3>
            {inv.campaignBrief ? <p>{inv.campaignBrief}</p> : null}
            <div className="camp-reward-box">
              <span>Your reward</span>
              <strong>
                {formatMoney(inv.rewardAmount, inv.rewardCurrency)}
              </strong>
            </div>
            <div className="camp-actions">
              <button
                type="button"
                className="adv-btn primary"
                disabled={busyId === inv.id}
                onClick={() => onRespond(inv.id, true)}
              >
                {busyId === inv.id ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={15} aria-hidden="true" />
                )}
                Accept
              </button>
              <button
                type="button"
                className="adv-btn"
                disabled={busyId === inv.id}
                onClick={() => onRespond(inv.id, false)}
              >
                <XCircle size={15} aria-hidden="true" />
                Decline
              </button>
            </div>
          </article>
        ))
      )}
      {handled.length > 0 ? (
        <>
          <h3 className="camp-section-title">Handled</h3>
          {handled.map(inv => (
            <article key={inv.id} className="camp-invite-card camp-handled">
              <h3>
                {inv.campaignTitle}{" "}
                <span className={`adv-status ${inv.status}`}>
                  {inv.status}
                </span>
              </h3>
              <div className="camp-reward-box">
                <span>Your reward</span>
                <strong>
                  {formatMoney(inv.rewardAmount, inv.rewardCurrency)}
                </strong>
              </div>
            </article>
          ))}
        </>
      ) : null}
    </section>
  );
}

type MyCampaign = {
  id: number;
  title: string;
  brief: string | null;
  concepts: unknown;
  rules: string | null;
  validationQuestions: unknown;
  status: string;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
};

/** Submit tab — one card per accepted campaign with checklist + video picker. */
function SubmitTab({
  campaigns,
  isLoading,
  onDone,
}: {
  campaigns: MyCampaign[];
  isLoading: boolean;
  onDone: (message: string) => void;
}) {
  if (isLoading) {
    return <p className="profile-loading-note">Loading…</p>;
  }
  if (campaigns.length === 0) {
    return (
      <p className="profile-loading-note">
        Accept an invitation to submit a deliverable here.
      </p>
    );
  }
  return (
    <section aria-label="Submit deliverable">
      {campaigns.map(campaign => (
        <SubmitCard key={campaign.id} campaign={campaign} onDone={onDone} />
      ))}
    </section>
  );
}

function SubmitCard({
  campaign,
  onDone,
}: {
  campaign: MyCampaign;
  onDone: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const ownVideos = trpc.profile.videos.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const submit = trpc.submissions.submitDeliverable.useMutation();

  const questions = useMemo(
    () => asStringList(campaign.validationQuestions),
    [campaign.validationQuestions]
  );
  const checklistItems = useMemo(() => {
    const items: string[] = [];
    if (typeof campaign.rules === "string" && campaign.rules.trim()) {
      items.push("I have read and agree to the campaign rules.");
    }
    for (const q of questions) items.push(`I confirm: ${q}`);
    return items;
  }, [campaign.rules, questions]);

  const [checked, setChecked] = useState<string[]>([]);
  const [videoId, setVideoId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allChecked =
    checklistItems.length > 0 && checked.length === checklistItems.length;
  const canSubmit =
    allChecked && videoId !== "" && campaign.status === "active" && !submitting;

  const toggle = (item: string) =>
    setChecked(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await submit.mutateAsync({
        campaignId: campaign.id,
        videoId: Number(videoId),
        answers: checked,
      });
      await utils.submissions.mySubmissions.invalidate();
      onDone(
        `Deliverable submitted — now in review (id #${result.submissionId}).`
      );
      setChecked([]);
      setVideoId("");
    } catch (error) {
      onDone(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="camp-card">
      <h3>
        {campaign.title}{" "}
        <span className={`adv-status ${campaign.status}`}>
          {campaign.status}
        </span>
      </h3>
      {campaign.brief ? <p>{campaign.brief}</p> : null}
      {asStringList(campaign.concepts).length > 0 ? (
        <div className="camp-list">
          <strong>Concepts</strong>
          {asStringList(campaign.concepts).map((concept, i) => (
            <p key={i}>• {concept}</p>
          ))}
        </div>
      ) : null}
      {typeof campaign.rules === "string" && campaign.rules ? (
        <div className="camp-list">
          <strong>Rules</strong>
          <p>{campaign.rules}</p>
        </div>
      ) : null}
      <p className="camp-meta">
        <CalendarDays size={13} aria-hidden="true" />{" "}
        {formatDate(campaign.startsAt)} → {formatDate(campaign.endsAt)}
      </p>

      {campaign.status !== "active" ? (
        <p className="camp-hint">
          This campaign is {campaign.status} — submissions open when it's
          active.
        </p>
      ) : (
        <>
          <div className="camp-list">
            <strong>Checklist — acknowledge each item</strong>
            {checklistItems.length === 0 ? (
              <p className="camp-hint">
                No checklist items for this campaign.
              </p>
            ) : (
              checklistItems.map(item => (
                <label key={item} className="camp-check">
                  <input
                    type="checkbox"
                    checked={checked.includes(item)}
                    onChange={() => toggle(item)}
                  />
                  <span>{item}</span>
                </label>
              ))
            )}
          </div>

          <label className="camp-field">
            <span>Your video</span>
            <select
              value={videoId}
              onChange={event => setVideoId(event.target.value)}
            >
              <option value="">Pick one of your videos…</option>
              {(ownVideos.data ?? []).map(v => (
                <option key={v.id} value={v.id}>
                  {v.title || `Video #${v.id}`}
                </option>
              ))}
            </select>
          </label>

          <div className="camp-actions">
            <button
              type="button"
              className="adv-btn primary"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {submitting ? (
                <Loader2 size={15} className="spin" aria-hidden="true" />
              ) : (
                <Send size={15} aria-hidden="true" />
              )}
              Submit deliverable
            </button>
          </div>
          {!allChecked && checklistItems.length > 0 ? (
            <p className="camp-hint">
              Acknowledge every checklist item to unlock submission.
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

/** Earnings tab — the creator's own fiat ledger rows only. No pool, no budget. */
function EarningsTab() {
  const earnings = trpc.submissions.myEarnings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const rows = earnings.data ?? [];

  return (
    <section aria-label="My earnings">
      <h2 className="camp-section-title">
        <Megaphone size={17} aria-hidden="true" /> My earnings
      </h2>
      <p className="camp-hint">
        Fiat ledger — rewards are recorded when your submission is approved.
      </p>
      {earnings.isLoading ? (
        <p className="profile-loading-note">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="profile-loading-note">
          No earnings yet — approved submissions show up here.
        </p>
      ) : (
        <div className="camp-table-wrap">
          <table className="camp-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>{row.campaignTitle}</td>
                  <td className="camp-num">
                    {formatFiat(row.amount, row.currency)}
                  </td>
                  <td>
                    <span className={`adv-status ${row.status}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
