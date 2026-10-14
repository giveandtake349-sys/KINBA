import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Lock,
  Megaphone,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  Search,
  StopCircle,
  Type as TypeIcon,
  UserPlus,
  Video as VideoIcon,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./advertise.css";
import "./campaigns.css";
import "./analytics.css";

type CampaignStatus = "draft" | "active" | "paused" | "ended";

const STATUS_FILTERS: { id: CampaignStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "ended", label: "Ended" },
];

function formatMoney(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const symbol = currency === "BDT" ? "৳" : "$";
  return `${symbol}${Number(amount).toLocaleString()}`;
}

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Admin "Campaigns" section. Create campaigns from approved applications,
 * manage status (manual Activate/Pause/End), and invite creators.
 * Full budget breakdown is admin-only — never sent to brand/creator views.
 */
export default function AdminCampaigns() {
  const [view, setView] = useState<
    "list" | "new" | "review" | "earnings" | "analytics"
  >(
    "list"
  );
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "all">(
    "all"
  );
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();

  const list = trpc.campaigns.admin.list.useQuery(
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 25,
      offset: 0,
    },
    { refetchOnWindowFocus: false }
  );

  const refresh = async () => {
    await utils.campaigns.admin.list.invalidate();
    await utils.campaigns.admin.detail.invalidate();
  };

  return (
    <>
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Brand advertising</p>
          <h2>Campaigns</h2>
        </div>
        <Megaphone size={24} />
      </div>
      <p className="admin-help">
        Create campaigns from approved applications, invite creators, and
        control the campaign lifecycle. The budget split is admin-only.
      </p>

      <div className="camp-toolbar">
        <div className="camp-tabs" role="tablist" aria-label="Campaign views">
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            All campaigns
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "new"}
            className={view === "new" ? "active" : ""}
            onClick={() => {
              setView("new");
              setOpenId(null);
            }}
          >
            <PlusCircle size={14} aria-hidden="true" /> New campaign
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "review"}
            className={view === "review" ? "active" : ""}
            onClick={() => {
              setView("review");
              setOpenId(null);
            }}
          >
            Review queue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "earnings"}
            className={view === "earnings" ? "active" : ""}
            onClick={() => {
              setView("earnings");
              setOpenId(null);
            }}
          >
            Earnings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "analytics"}
            className={view === "analytics" ? "active" : ""}
            onClick={() => {
              setView("analytics");
              setOpenId(null);
            }}
          >
            <BarChart3 size={14} aria-hidden="true" /> Analytics
          </button>
        </div>
        {view === "list" ? (
          <label className="camp-filter">
            Status
            <select
              value={statusFilter}
              onChange={event => {
                setStatusFilter(event.target.value as CampaignStatus | "all");
                setOpenId(null);
              }}
            >
              {STATUS_FILTERS.map(f => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {notice ? (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      ) : null}

      {view === "new" ? (
        <NewCampaignForm
          onDone={message => {
            setNotice(message);
            setView("list");
            void refresh();
          }}
          onError={setNotice}
        />
      ) : view === "review" ? (
        <ReviewQueueTab onDone={setNotice} />
      ) : view === "earnings" ? (
        <AdminEarningsTab onDone={setNotice} />
      ) : view === "analytics" ? (
        <AdminAnalyticsTab />
      ) : list.isLoading ? (
        <p className="profile-loading-note">Loading campaigns…</p>
      ) : list.data && list.data.items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Budget</th>
                <th>Status</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map(item => (
                <tr
                  key={item.id}
                  onClick={() =>
                    setOpenId(openId === item.id ? null : item.id)
                  }
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <strong>{item.title}</strong>
                    <br />
                    <small style={{ color: "var(--muted)" }}>
                      {item.brandName || "—"}
                    </small>
                  </td>
                  <td>
                    {formatMoney(item.budgetTotal, item.budgetCurrency)}
                  </td>
                  <td>
                    <span className={`adv-status ${item.status}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    <small>
                      {formatDate(item.startsAt)} → {formatDate(item.endsAt)}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="profile-loading-note">No campaigns yet.</p>
      )}

      {view === "list" && openId != null ? (
        <CampaignDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={async message => {
            setNotice(message);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* New campaign form                                                   */
/* ------------------------------------------------------------------ */

function NewCampaignForm({
  onDone,
  onError,
}: {
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [concepts, setConcepts] = useState("");
  const [rules, setRules] = useState("");
  const [questions, setQuestions] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [creatorPool, setCreatorPool] = useState("");
  const [serviceFee, setServiceFee] = useState("");
  const [saving, setSaving] = useState(false);

  const approved = trpc.brands.admin.list.useQuery(
    { status: "approved", limit: 50, offset: 0 },
    { refetchOnWindowFocus: false }
  );
  const create = trpc.campaigns.admin.create.useMutation();

  const selected = approved.data?.items.find(
    item => String(item.id) === applicationId
  );
  const total = selected?.budgetAmount ? Number(selected.budgetAmount) : 0;
  const poolNum = Number(creatorPool) || 0;
  const feeNum = Number(serviceFee) || 0;
  const splitOk =
    total > 0 &&
    creatorPool.trim() !== "" &&
    serviceFee.trim() !== "" &&
    Math.abs(poolNum + feeNum - total) < 0.005;

  const submit = async () => {
    if (!applicationId || !title.trim()) {
      onError("Pick an approved application and enter a title.");
      return;
    }
    if (!splitOk) {
      onError(
        `Creator pool + service fee must equal the approved total (${formatMoney(
          selected?.budgetAmount ?? null,
          selected?.budgetCurrency ?? null
        )}).`
      );
      return;
    }
    setSaving(true);
    try {
      const result = await create.mutateAsync({
        applicationId: Number(applicationId),
        title: title.trim(),
        brief,
        concepts: linesToList(concepts),
        rules,
        validationQuestions: linesToList(questions),
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        creatorPool: creatorPool.trim(),
        serviceFee: serviceFee.trim(),
      });
      onDone(`Campaign created (draft #${result.campaignId}).`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="camp-form">
      <label>
        Approved application
        <select
          value={applicationId}
          onChange={event => setApplicationId(event.target.value)}
        >
          <option value="">Select…</option>
          {(approved.data?.items ?? []).map(item => (
            <option key={item.id} value={item.id}>
              {item.brandName} —{" "}
              {formatMoney(item.budgetAmount, item.budgetCurrency)}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <p className="camp-hint">
          Approved total:{" "}
          <strong>
            {formatMoney(selected.budgetAmount, selected.budgetCurrency)}
          </strong>{" "}
          — the split below must add up to exactly this.
        </p>
      ) : null}
      <label>
        Campaign title
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={200}
          placeholder="e.g. Aarong Dairy — Winter Launch"
        />
      </label>
      <label>
        Brief for creators
        <textarea
          value={brief}
          onChange={event => setBrief(event.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="What should creators make?"
        />
      </label>
      <label>
        Concepts (one per line)
        <textarea
          value={concepts}
          onChange={event => setConcepts(event.target.value)}
          rows={3}
          placeholder="Morning routine with the product…"
        />
      </label>
      <label>
        Rules for creators
        <textarea
          value={rules}
          onChange={event => setRules(event.target.value)}
          rows={3}
          maxLength={5000}
          placeholder="Must mention the promo link, no competitors…"
        />
      </label>
      <label>
        Validation questions (one per line)
        <textarea
          value={questions}
          onChange={event => setQuestions(event.target.value)}
          rows={2}
          placeholder="Did you show the product clearly?"
        />
      </label>
      <div className="camp-row">
        <label>
          Starts
          <input
            type="date"
            value={startsAt}
            onChange={event => setStartsAt(event.target.value)}
          />
        </label>
        <label>
          Ends
          <input
            type="date"
            value={endsAt}
            onChange={event => setEndsAt(event.target.value)}
          />
        </label>
      </div>
      <div className="camp-row">
        <label>
          Creator pool ({selected?.budgetCurrency ?? "USD"})
          <input
            value={creatorPool}
            onChange={event => setCreatorPool(event.target.value)}
            inputMode="decimal"
            placeholder="3500.00"
          />
        </label>
        <label>
          Service fee ({selected?.budgetCurrency ?? "USD"})
          <input
            value={serviceFee}
            onChange={event => setServiceFee(event.target.value)}
            inputMode="decimal"
            placeholder="1500.00"
          />
        </label>
      </div>
      {selected ? (
        <p
          className={`camp-split ${splitOk ? "ok" : "bad"}`}
          role="status"
        >
          {splitOk ? (
            <>
              <CheckCircle2 size={14} aria-hidden="true" /> Split matches the
              approved total.
            </>
          ) : (
            <>
              <XCircle size={14} aria-hidden="true" /> Pool + fee must equal{" "}
              {formatMoney(selected.budgetAmount, selected.budgetCurrency)}.
            </>
          )}
        </p>
      ) : null}
      <button
        type="button"
        className="adv-btn primary"
        onClick={submit}
        disabled={saving}
      >
        {saving ? <Loader2 size={16} className="spin" /> : null}
        Create draft campaign
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campaign detail                                                     */
/* ------------------------------------------------------------------ */

function CampaignDetail({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const detail = trpc.campaigns.admin.detail.useQuery(
    { id },
    { refetchOnWindowFocus: false }
  );
  const setStatus = trpc.campaigns.admin.setStatus.useMutation();
  const [busy, setBusy] = useState(false);

  const changeStatus = async (toStatus: "active" | "paused" | "ended") => {
    setBusy(true);
    try {
      await setStatus.mutateAsync({ id, toStatus });
      await onChanged(`Campaign ${toStatus}.`);
    } catch (error) {
      await onChanged(
        error instanceof Error ? error.message : "Status change failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const campaign = detail.data?.campaign;
  const status = campaign?.status as CampaignStatus | undefined;

  return (
    <div className="admin-detail-panel camp-detail">
      <button type="button" className="adv-back" onClick={onClose}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to list
      </button>
      {detail.isLoading ? (
        <p className="profile-loading-note">Loading…</p>
      ) : !campaign || !detail.data ? (
        <p className="profile-loading-note">Campaign not found.</p>
      ) : (
        <>
          <h3>
            {campaign.title}{" "}
            <span className={`adv-status ${campaign.status}`}>
              {campaign.status}
            </span>
          </h3>

          <div className="camp-budget">
            <div>
              <span>Total</span>
              <strong>
                {formatMoney(campaign.budgetTotal, campaign.budgetCurrency)}
              </strong>
            </div>
            <div>
              <span>Creator pool</span>
              <strong>
                {formatMoney(campaign.creatorPool, campaign.budgetCurrency)}
              </strong>
            </div>
            <div>
              <span>Service fee</span>
              <strong>
                {formatMoney(campaign.serviceFee, campaign.budgetCurrency)}
              </strong>
            </div>
          </div>
          <p className="camp-hint">
            <CheckCircle2 size={13} aria-hidden="true" /> Admin-only breakdown —
            creators and brands never see this.
          </p>

          {campaign.brief ? (
            <p className="camp-brief">{campaign.brief}</p>
          ) : null}
          <p className="camp-meta">
            {formatDate(campaign.startsAt)} → {formatDate(campaign.endsAt)}
          </p>

          <div className="camp-actions" role="group" aria-label="Campaign status">
            {status === "draft" || status === "paused" ? (
              <button
                type="button"
                className="adv-btn primary"
                disabled={busy}
                onClick={() => changeStatus("active")}
              >
                <PlayCircle size={15} aria-hidden="true" /> Activate
              </button>
            ) : null}
            {status === "active" ? (
              <button
                type="button"
                className="adv-btn ghost"
                disabled={busy}
                onClick={() => changeStatus("paused")}
              >
                <PauseCircle size={15} aria-hidden="true" /> Pause
              </button>
            ) : null}
            {status === "active" || status === "paused" ? (
              <button
                type="button"
                className="adv-btn danger"
                disabled={busy}
                onClick={() => changeStatus("ended")}
              >
                <StopCircle size={15} aria-hidden="true" /> End campaign
              </button>
            ) : null}
          </div>

          <InviteCreator
            campaignId={id}
            currency={campaign.budgetCurrency ?? "USD"}
            onInvited={async () => onChanged("Invitation sent.")}
          />

          <h4>Invitations ({detail.data.invitations.length})</h4>
          {detail.data.invitations.length === 0 ? (
            <p className="profile-loading-note">No invitations yet.</p>
          ) : (
            <ul className="camp-invites">
              {detail.data.invitations.map(inv => (
                <li key={inv.id}>
                  <span className="camp-invitee">
                    {inv.displayName || inv.username || `User ${inv.userId}`}
                  </span>
                  <span className="camp-reward">
                    {formatMoney(inv.rewardAmount, inv.rewardCurrency)}
                  </span>
                  <span className={`adv-status ${inv.status}`}>
                    {inv.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <CampaignLinks
            campaignId={id}
            onChanged={onChanged}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Invite creator                                                      */
/* ------------------------------------------------------------------ */

function InviteCreator({
  campaignId,
  currency,
  onInvited,
}: {
  campaignId: number;
  currency: string;
  onInvited: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{
    userId: number;
    username: string | null;
    displayName: string | null;
  } | null>(null);
  const [reward, setReward] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const search = trpc.campaigns.admin.searchCreators.useQuery(
    { query, limit: 8 },
    { enabled: query.trim().length >= 2, refetchOnWindowFocus: false }
  );
  const invite = trpc.campaigns.admin.inviteCreator.useMutation();

  const send = async () => {
    if (!picked || !reward.trim()) {
      setError("Pick a creator and set a reward.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await invite.mutateAsync({
        campaignId,
        userId: picked.userId,
        rewardAmount: reward.trim(),
        message: message.trim(),
      });
      setPicked(null);
      setReward("");
      setMessage("");
      setQuery("");
      await onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="camp-invite-box">
      <h4>
        <UserPlus size={15} aria-hidden="true" /> Invite a creator
      </h4>
      <label className="camp-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setPicked(null);
          }}
          placeholder="Search by username or name…"
          aria-label="Search creators"
        />
      </label>
      {search.data && search.data.length > 0 && !picked ? (
        <ul className="camp-search-results">
          {search.data.map(person => (
            <li key={person.userId}>
              <button
                type="button"
                onClick={() =>
                  setPicked({
                    userId: person.userId,
                    username: person.username,
                    displayName: person.displayName,
                  })
                }
              >
                {person.displayName || person.username || `User ${person.userId}`}
                {person.username ? (
                  <small> @{person.username}</small>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {picked ? (
        <p className="camp-picked">
          Inviting:{" "}
          <strong>
            {picked.displayName || picked.username || `User ${picked.userId}`}
          </strong>{" "}
          <button type="button" onClick={() => setPicked(null)}>
            change
          </button>
        </p>
      ) : null}
      <div className="camp-row">
        <label>
          Reward ({currency})
          <input
            value={reward}
            onChange={event => setReward(event.target.value)}
            inputMode="decimal"
            placeholder="120.00"
          />
        </label>
      </div>
      <label>
        Personal note (optional)
        <textarea
          value={message}
          onChange={event => setMessage(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="We'd love you for this launch…"
        />
      </label>
      {error ? (
        <p className="camp-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="adv-btn primary"
        onClick={send}
        disabled={sending || !picked}
      >
        {sending ? <Loader2 size={16} className="spin" /> : null}
        Send invitation
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 4 — campaign links (/r/:linkId targets)                       */
/* ------------------------------------------------------------------ */

function CampaignLinks({
  campaignId,
  onChanged,
}: {
  campaignId: number;
  onChanged: (message: string) => Promise<void>;
}) {
  const links = trpc.submissions.admin.links.useQuery(
    { campaignId },
    { refetchOnWindowFocus: false }
  );
  const createLink = trpc.submissions.admin.createLink.useMutation();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!label.trim() || !url.trim() || saving) return;
    setSaving(true);
    try {
      const result = await createLink.mutateAsync({
        campaignId,
        label: label.trim(),
        url: url.trim(),
      });
      setLabel("");
      setUrl("");
      await links.refetch();
      await onChanged(`Link created — short URL ${result.shortUrl}.`);
    } catch (error) {
      await onChanged(error instanceof Error ? error.message : "Add link failed.");
    } finally {
      setSaving(false);
    }
  };

  const copy = async (shortUrl: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${shortUrl}`);
      await onChanged(`Copied ${shortUrl}.`);
    } catch {
      await onChanged(`Copy failed — the URL is ${shortUrl}.`);
    }
  };

  return (
    <div className="camp-links">
      <h4>Links ({links.data?.length ?? 0})</h4>
      <div className="camp-link-form">
        <input
          value={label}
          onChange={event => setLabel(event.target.value)}
          placeholder="Label (e.g. Promo page)"
          maxLength={160}
          aria-label="Link label"
        />
        <input
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="https://…"
          maxLength={2048}
          inputMode="url"
          aria-label="Link URL"
        />
        <button
          type="button"
          className="adv-btn primary"
          disabled={saving || !label.trim() || !url.trim()}
          onClick={add}
        >
          {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
          Add link
        </button>
      </div>
      {(links.data ?? []).map(link => (
        <div key={link.id} className="camp-link-row">
          <div>
            <strong>{link.label || link.kind}</strong>
            <br />
            <small className="camp-link-url">{link.url}</small>
          </div>
          <button
            type="button"
            className="adv-btn ghost"
            onClick={() => copy(`/r/${link.id}`)}
          >
            Copy /r/{link.id}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 4 — review queue                                              */
/* ------------------------------------------------------------------ */

function ReviewQueueTab({ onDone }: { onDone: (message: string) => void }) {
  const list = trpc.campaigns.admin.list.useQuery(
    { limit: 100 },
    { refetchOnWindowFocus: false }
  );
  const [campaignId, setCampaignId] = useState("");
  const queue = trpc.submissions.admin.reviewQueue.useQuery(
    { campaignId: Number(campaignId) },
    { enabled: campaignId !== "", refetchOnWindowFocus: false }
  );
  const review = trpc.submissions.admin.reviewSubmission.useMutation();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const decide = async (submissionId: number, decision: "approve" | "reject") => {
    setBusyId(submissionId);
    try {
      const result = await review.mutateAsync({
        submissionId,
        decision,
        note: notes[submissionId]?.trim() || undefined,
      });
      await queue.refetch();
      onDone(
        decision === "approve"
          ? `Submission approved — earning #${result.earningId ?? "?"} recorded.`
          : "Submission rejected."
      );
    } catch (error) {
      onDone(error instanceof Error ? error.message : "Review failed.");
    } finally {
      setBusyId(null);
    }
  };

  const items = list.data?.items ?? [];

  return (
    <section aria-label="Review queue">
      <h3 className="camp-section-title">Review queue</h3>
      <label className="camp-field">
        <span>Campaign</span>
        <select
          value={campaignId}
          onChange={event => setCampaignId(event.target.value)}
        >
          <option value="">Pick a campaign…</option>
          {items.map(item => (
            <option key={item.id} value={item.id}>
              {item.title} ({item.status})
            </option>
          ))}
        </select>
      </label>
      {campaignId === "" ? (
        <p className="profile-loading-note">Pick a campaign to see submissions.</p>
      ) : queue.isLoading ? (
        <p className="profile-loading-note">Loading submissions…</p>
      ) : (queue.data ?? []).length === 0 ? (
        <p className="profile-loading-note">No submissions yet.</p>
      ) : (
        (queue.data ?? []).map(sub => (
          <article key={sub.id} className="camp-card">
            <h3>
              {sub.videoTitle || `Video #${sub.videoId ?? "?"}`}{" "}
              <span className={`adv-status ${sub.reviewStatus}`}>
                {sub.reviewStatus}
              </span>
            </h3>
            <p className="camp-meta">
              {sub.creatorDisplayName || sub.creatorUsername || `User ${sub.creatorId}`}
              {" · "}
              {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : "—"}
            </p>
            {Array.isArray(sub.answers) && sub.answers.length > 0 ? (
              <div className="camp-list">
                <strong>Checklist answers</strong>
                {sub.answers.map((answer: string, i: number) => (
                  <p key={i}>✓ {answer}</p>
                ))}
              </div>
            ) : null}
            {sub.reviewStatus === "in_review" ? (
              <>
                <label className="camp-field">
                  <span>Note (optional)</span>
                  <input
                    value={notes[sub.id] ?? ""}
                    onChange={event =>
                      setNotes(prev => ({ ...prev, [sub.id]: event.target.value }))
                    }
                    placeholder="Review note…"
                    maxLength={500}
                  />
                </label>
                <div className="camp-actions">
                  <button
                    type="button"
                    className="adv-btn primary"
                    disabled={busyId === sub.id}
                    onClick={() => decide(sub.id, "approve")}
                  >
                    {busyId === sub.id ? (
                      <Loader2 size={15} className="spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 size={15} aria-hidden="true" />
                    )}
                    Approve + pay
                  </button>
                  <button
                    type="button"
                    className="adv-btn danger"
                    disabled={busyId === sub.id}
                    onClick={() => decide(sub.id, "reject")}
                  >
                    <XCircle size={15} aria-hidden="true" />
                    Reject
                  </button>
                </div>
              </>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 4 — admin earnings ledger                                     */
/* ------------------------------------------------------------------ */

function AdminEarningsTab({ onDone }: { onDone: (message: string) => void }) {
  const list = trpc.campaigns.admin.list.useQuery(
    { limit: 100 },
    { refetchOnWindowFocus: false }
  );
  const [campaignId, setCampaignId] = useState("");
  const earnings = trpc.submissions.admin.earnings.useQuery(
    { campaignId: Number(campaignId) },
    { enabled: campaignId !== "", refetchOnWindowFocus: false }
  );
  const reverse = trpc.submissions.admin.reverseEarning.useMutation();
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const doReverse = async (earningId: number) => {
    if (reason.trim().length < 3 || busyId != null) return;
    setBusyId(earningId);
    try {
      await reverse.mutateAsync({ earningId, reason: reason.trim() });
      await earnings.refetch();
      onDone("Earning reversed (append-only — original row untouched).");
      setReason("");
    } catch (error) {
      onDone(error instanceof Error ? error.message : "Reversal failed.");
    } finally {
      setBusyId(null);
    }
  };

  const items = list.data?.items ?? [];
  const data = earnings.data;

  return (
    <section aria-label="Earnings ledger">
      <h3 className="camp-section-title">Earnings</h3>
      <p className="camp-hint">
        Admin-only fiat ledger. Reversals append a new row — money rows are
        never edited.
      </p>
      <label className="camp-field">
        <span>Campaign</span>
        <select
          value={campaignId}
          onChange={event => setCampaignId(event.target.value)}
        >
          <option value="">Pick a campaign…</option>
          {items.map(item => (
            <option key={item.id} value={item.id}>
              {item.title} ({item.status})
            </option>
          ))}
        </select>
      </label>
      {campaignId === "" ? (
        <p className="profile-loading-note">Pick a campaign to see the ledger.</p>
      ) : earnings.isLoading ? (
        <p className="profile-loading-note">Loading ledger…</p>
      ) : !data ? (
        <p className="profile-loading-note">No data.</p>
      ) : (
        <>
          <div className="camp-budget">
            {data.totals.length === 0 ? (
              <div>
                <span>Approved total</span>
                <strong>—</strong>
              </div>
            ) : (
              data.totals.map(total => (
                <div key={total.currency}>
                  <span>Approved ({total.currency})</span>
                  <strong>{total.amount}</strong>
                </div>
              ))
            )}
          </div>
          {(data.rows ?? []).length === 0 ? (
            <p className="profile-loading-note">No earning rows yet.</p>
          ) : (
            <div className="camp-table-wrap">
              <table className="camp-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(row => (
                    <tr key={row.id}>
                      <td>
                        {row.creatorDisplayName || row.creatorUsername || `#${row.creatorId}`}
                      </td>
                      <td className="camp-num">
                        {row.currency === "BDT" ? "৳" : "$"}
                        {Number(row.amount).toLocaleString()}
                      </td>
                      <td>
                        <span className={`adv-status ${row.status}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>
                        <small>{row.reason || "—"}</small>
                      </td>
                      <td>
                        <small>
                          {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                        </small>
                      </td>
                      <td>
                        {(row.status === "approved" || row.status === "paid_recorded") ? (
                          <button
                            type="button"
                            className="adv-btn ghost"
                            disabled={busyId === row.id}
                            onClick={() => doReverse(row.id)}
                            title="Reverse this earning (append-only)"
                          >
                            Reverse
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="camp-field">
            <span>Reversal reason (required)</span>
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Why is this earning being reversed?"
              maxLength={500}
            />
          </label>
        </>
      )}
    </section>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function formatPct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

const TYPE_META = {
  VIDEO: { label: "Videos", icon: VideoIcon },
  IMAGE: { label: "Photos", icon: ImageIcon },
  TEXT: { label: "Text posts", icon: TypeIcon },
} as const;

/**
 * Admin analytics dashboard — platform-wide totals (last 30 days) plus a
 * top-campaigns table. Confirmed "number 2" engagement-preview visual
 * language: KPI cards, FB Creator Studio-style tables with status pills.
 * Every number comes from the real DB (event tables + lazy rollup). Thin
 * data renders an honest empty state — never invented figures.
 */
function AdminAnalyticsTab() {
  const stats = trpc.analytics.adminDashboard.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const data = stats.data;

  if (stats.isLoading) {
    return <p className="profile-loading-note">Loading analytics…</p>;
  }
  if (!data || !data.hasData) {
    return (
      <div className="an-empty" role="status">
        <BarChart3 size={28} aria-hidden="true" />
        <p>
          <strong>Not enough data yet.</strong>
          <br />
          Campaign activity is tracked from real events — check back after
          campaigns go live.
        </p>
      </div>
    );
  }

  const { totals, byType, campaigns } = data;

  return (
    <div className="an-wrap">
      <div className="an-head">
        <h3>
          <BarChart3 size={18} aria-hidden="true" /> Platform Overview
        </h3>
        <span className="an-priv">
          <Lock
            size={12}
            aria-hidden="true"
            style={{ verticalAlign: "-1px", marginRight: 4 }}
          />
          Admin
        </span>
      </div>

      <div className="an-kpis">
        <div className="an-kpi">
          <b>{formatCompact(totals.views)}</b>
          <span>Views</span>
        </div>
        <div className="an-kpi">
          <b>{formatCompact(totals.impressions)}</b>
          <span>Impressions</span>
        </div>
        <div className="an-kpi">
          <b>{formatPct(totals.avgEngagementRate)}</b>
          <span>Avg eng.</span>
        </div>
      </div>

      {/* TOP CAMPAIGNS — FB table style */}
      <div className="an-card">
        <b>Top campaigns</b>
        <div className="an-table" role="table" aria-label="Top campaigns">
          <div className="an-thead" role="row">
            <span>Campaign</span>
            <span>Impr.</span>
            <span>CTR</span>
            <span></span>
          </div>
          {campaigns.map(camp => (
            <div className="an-trow" role="row" key={camp.campaignId}>
              <span className="an-post">
                <span>{camp.title}</span>
              </span>
              <span>{formatCompact(camp.impressions)}</span>
              <span>{formatPct(camp.ctr)}</span>
              <em className={`an-status ${camp.status}`}>{camp.status}</em>
            </div>
          ))}
        </div>
      </div>

      {/* BY CONTENT TYPE */}
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
        Real database numbers — deduplicated, bot-filtered, self-views excluded.
      </p>
    </div>
  );
}
