import { useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Inbox,
  Loader2,
  Lock,
  Megaphone,
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

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Creator Campaign Portal (/campaigns).
 * Invitations show ONLY the creator's own reward — never the campaign's
 * total budget, pool, or fee (the API never selects those columns).
 */
export default function CreatorCampaigns() {
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
  const handled = (invitations.data ?? []).filter(
    inv => inv.status !== "pending"
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
                {inv.message ? (
                  <p className="camp-note">“{inv.message}”</p>
                ) : null}
                <p className="camp-meta">
                  <CalendarDays size={13} aria-hidden="true" /> Deadline:{" "}
                  {formatDate(inv.expiresAt ?? inv.campaignEndsAt)}
                </p>
                {inv.campaignRules ||
                asStringList(inv.campaignConcepts).length > 0 ? (
                  <details className="camp-details">
                    <summary>Brief & rules</summary>
                    {typeof inv.campaignRules === "string" &&
                    inv.campaignRules ? (
                      <p>{inv.campaignRules}</p>
                    ) : null}
                    {asStringList(inv.campaignConcepts).map((concept, i) => (
                      <p key={i}>• {concept}</p>
                    ))}
                  </details>
                ) : null}
                <div className="camp-invite-actions">
                  <button
                    type="button"
                    className="adv-btn ghost"
                    disabled={busyId === inv.id}
                    onClick={() => handleRespond(inv.id, false)}
                  >
                    <XCircle size={15} aria-hidden="true" /> Decline
                  </button>
                  <button
                    type="button"
                    className="adv-btn primary"
                    disabled={busyId === inv.id}
                    onClick={() => handleRespond(inv.id, true)}
                  >
                    {busyId === inv.id ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <CheckCircle2 size={15} aria-hidden="true" />
                    )}{" "}
                    Accept
                  </button>
                </div>
              </article>
            ))
          )}

          {handled.length > 0 ? (
            <details className="camp-details">
              <summary>Past invitations ({handled.length})</summary>
              <ul className="camp-invites">
                {handled.map(inv => (
                  <li key={inv.id}>
                    <span className="camp-invitee">{inv.campaignTitle}</span>
                    <span className={`adv-status ${inv.status}`}>
                      {inv.status}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section aria-label="My campaigns">
          <h2 className="camp-section-title">
            <Megaphone size={17} aria-hidden="true" /> My campaigns
          </h2>
          {myCampaigns.isLoading ? (
            <p className="profile-loading-note">Loading…</p>
          ) : (myCampaigns.data ?? []).length === 0 ? (
            <p className="profile-loading-note">
              Accept an invitation to see your campaigns here.
            </p>
          ) : (
            (myCampaigns.data ?? []).map(campaign => (
              <article key={campaign.id} className="camp-card">
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
                {asStringList(campaign.validationQuestions).length > 0 ? (
                  <div className="camp-list">
                    <strong>Before you submit</strong>
                    {asStringList(campaign.validationQuestions).map((q, i) => (
                      <p key={i}>
                        {i + 1}. {q}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="camp-meta">
                  <CalendarDays size={13} aria-hidden="true" />{" "}
                  {formatDate(campaign.startsAt)} →{" "}
                  {formatDate(campaign.endsAt)}
                </p>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
