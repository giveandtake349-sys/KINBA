import { useRef, useState } from "react";
import {
  ArrowRight,
  Clapperboard,
  Plus,
  Upload,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./advertise.css";
import "./analytics.css";

function formatMoney(cents: number, currency: string): string {
  const sym = currency === "BDT" ? "৳" : "$";
  return `${sym}${(cents / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Pending review",
  active: "Running",
  paused: "Paused",
  ended: "Ended",
};

/**
 * Video ads — the advertiser's own pre-roll ads. FB-style continuous run:
 * each ad shows "Running" with a spent/budget bar plus manual
 * Pause/Resume/End buttons (no cron). Honest empty state when none.
 */
export function VideoAdsSection() {
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const ads = trpc.preroll.myAds.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const statusMutation = trpc.preroll.updateAdStatus.useMutation();

  const refresh = () => utils.preroll.myAds.invalidate();

  const setStatus = async (adId: number, status: "active" | "paused" | "ended") => {
    setNotice("");
    try {
      await statusMutation.mutateAsync({ adId, status });
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update ad.");
    }
  };

  const rows = ads.data ?? [];

  return (
    <section className="adv-card" aria-label="Video ads">
      <div className="an-head">
        <h3>
          <Clapperboard size={18} aria-hidden="true" /> Video ads
        </h3>
        <button
          type="button"
          className="adv-cta small"
          onClick={() => setShowForm(v => !v)}
        >
          <Plus size={16} aria-hidden="true" />
          {showForm ? "Close" : "New video ad"}
        </button>
      </div>
      <p className="adv-hint">
        5-second skippable ads before eligible creators&apos; videos. Runs
        until the budget is spent or you pause it — 55% of each play goes to
        the creator.
      </p>

      {notice ? (
        <p className="adv-error" role="alert">
          {notice}
        </p>
      ) : null}

      {showForm ? (
        <NewVideoAdForm
          onDone={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      ) : null}

      {ads.isLoading ? (
        <p className="profile-loading-note">Loading your video ads…</p>
      ) : rows.length === 0 ? (
        <div className="an-empty" role="status">
          <Clapperboard size={28} aria-hidden="true" />
          <p>
            <strong>No video ads yet.</strong>
            <br />
            Create one to reach viewers before popular creators&apos; videos.
          </p>
        </div>
      ) : (
        <div className="an-wrap">
          {rows.map(ad => {
            const pct =
              ad.budgetCents > 0
                ? Math.min(100, (ad.spentCents / ad.budgetCents) * 100)
                : 0;
            const dotClass =
              ad.status === "active"
                ? "g"
                : ad.status === "paused"
                  ? "a"
                  : ad.status === "draft"
                    ? "b"
                    : "gr";
            return (
              <div className="fb-card" key={ad.id}>
                <div>
                  <div className="fb-name">{ad.title}</div>
                  <div className="fb-meta">
                    <i className={`dot ${dotClass}`} aria-hidden="true" />
                    {STATUS_LABEL[ad.status] ?? ad.status}
                  </div>
                </div>
                <div className="fb-stats">
                  <div>
                    <b>{ad.plays.toLocaleString()}</b>
                    <span>Plays</span>
                  </div>
                  <div>
                    <b>
                      {ad.completionRate == null
                        ? "—"
                        : `${ad.completionRate}%`}
                    </b>
                    <span>Completion</span>
                  </div>
                </div>
                <div
                  className="fb-bar"
                  role="progressbar"
                  aria-label="Budget spent"
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="fb-spent">
                  {formatMoney(ad.spentCents, ad.currency)} of{" "}
                  {formatMoney(ad.budgetCents, ad.currency)} spent
                </div>
                <div className="fb-actions">
                  {ad.status === "active" ? (
                    <button
                      type="button"
                      className="fb-btn sec"
                      disabled={statusMutation.isPending}
                      onClick={() => void setStatus(ad.id, "paused")}
                    >
                      Pause
                    </button>
                  ) : null}
                  {ad.status === "paused" ? (
                    <button
                      type="button"
                      className="fb-btn pri"
                      disabled={statusMutation.isPending}
                      onClick={() => void setStatus(ad.id, "active")}
                    >
                      Resume
                    </button>
                  ) : null}
                  {ad.status === "active" || ad.status === "paused" ? (
                    <button
                      type="button"
                      className="fb-btn sec danger"
                      disabled={statusMutation.isPending}
                      onClick={() => void setStatus(ad.id, "ended")}
                    >
                      End
                    </button>
                  ) : null}
                  {ad.status === "draft" ? (
                    <span className="fb-spent">
                      Under review — it will start running once approved.
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="fb-note">
        When the budget runs out, the ad stops automatically.
      </p>
    </section>
  );
}

function NewVideoAdForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState<"USD" | "BDT">("USD");
  const [dropId, setDropId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const drops = trpc.preroll.myDrops.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const uploadUrl = trpc.preroll.createAdUploadUrl.useMutation();
  const createAd = trpc.preroll.createAd.useMutation();

  const submit = async () => {
    setError("");
    if (!title.trim()) {
      setError("Give your ad a title.");
      return;
    }
    const budgetCents = Math.round(Number(budget) * 100);
    if (!Number.isFinite(budgetCents) || budgetCents < 100) {
      setError("Budget must be at least $1 (or ৳1).");
      return;
    }
    if (!file) {
      setError("Choose an ad video file (MP4/WebM/MOV, up to 50 MB).");
      return;
    }
    setBusy(true);
    try {
      const { uploadUrl: url, publicUrl } = await uploadUrl.mutateAsync({
        contentType: file.type,
        fileName: file.name,
        fileSize: file.size,
      });
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status}).`);
      await createAd.mutateAsync({
        title: title.trim(),
        videoUrl: publicUrl,
        dropId: dropId ? Number(dropId) : null,
        budgetCents,
        currency,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the ad.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adv-form-card" aria-label="New video ad">
      <label className="adv-field">
        <span>Ad title</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          placeholder="Summer Sale — 20% off"
          onChange={e => setTitle(e.target.value)}
        />
      </label>
      <label className="adv-field">
        <span>Ad video</span>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <span className="adv-hint">
            <Upload size={12} aria-hidden="true" /> {file.name} (
            {(file.size / 1024 / 1024).toFixed(1)} MB)
          </span>
        ) : null}
      </label>
      <label className="adv-field">
        <span>Drop link (optional)</span>
        <select value={dropId} onChange={e => setDropId(e.target.value)}>
          <option value="">No drop attached</option>
          {(drops.data ?? []).map(d => (
            <option key={d.id} value={d.id}>
              {d.title} — {d.currency === "BDT" ? "৳" : "$"}
              {d.discountedPrice}
            </option>
          ))}
        </select>
      </label>
      <div className="adv-row-2">
        <label className="adv-field">
          <span>Budget</span>
          <input
            type="number"
            min={1}
            step="any"
            value={budget}
            placeholder="500"
            onChange={e => setBudget(e.target.value)}
          />
        </label>
        <label className="adv-field">
          <span>Currency</span>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value as "USD" | "BDT")}
          >
            <option value="USD">USD</option>
            <option value="BDT">BDT</option>
          </select>
        </label>
      </div>
      <label className="adv-field">
        <span>Start date (optional)</span>
        <input
          type="date"
          value={startsAt}
          onChange={e => setStartsAt(e.target.value)}
        />
      </label>
      {error ? (
        <p className="adv-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="adv-cta full"
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "Creating…" : "Create video ad"}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p className="adv-hint">
        New ads start as drafts — our team reviews them before they run.
      </p>
    </div>
  );
}
