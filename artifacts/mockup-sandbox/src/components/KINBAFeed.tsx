import { useState, type FormEvent, type MouseEvent } from "react";
import {
  Bell,
  ChevronDown,
  Heart,
  MessageCircle,
  Music2,
  Pause,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";

const tabs = ["WHEELS", "ALL FEED", "VIDEOS", "SHORTS"] as const;
type Tab = (typeof tabs)[number];

function stopAction(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.preventDefault();
  event.stopPropagation();
  action();
}

export function KINBAFeed() {
  const [activeTab, setActiveTab] = useState<Tab>("ALL FEED");
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(14500);
  const [following, setFollowing] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState([
    { author: "mika.wav", body: "this feels like a movie." },
    { author: "lina", body: "the sound design is perfect." },
  ]);

  const toggleLike = () => {
    setLiked(current => !current);
    setLikes(current => current + (liked ? -1 : 1));
  };

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const body = comment.trim();
    if (!body) return;
    setComments(current => [...current, { author: "you", body }]);
    setComment("");
  };

  return (
    <main className="kinba-feed-app">
      <header className="kinba-feed-header">
        <button
          className="kinba-feed-brand"
          type="button"
          onClick={event => stopAction(event, () => setActiveTab("ALL FEED"))}
          aria-label="Go to KINBA home feed"
        >
          <span className="kinba-feed-brand-mark">K</span>
          <span>KINBA</span>
          <Sparkles size={13} aria-hidden="true" />
        </button>
        <div className="kinba-feed-actions">
          <button
            type="button"
            className="kinba-feed-action coral"
            aria-label="Create"
            onClick={event => stopAction(event, () => setComposerOpen(true))}
          >
            <Plus size={19} />
          </button>
          <button
            type="button"
            className="kinba-feed-action"
            aria-label="Search"
            onClick={event => stopAction(event, () => setSearchOpen(current => !current))}
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            className="kinba-feed-action notification"
            aria-label="Notifications"
            onClick={event => stopAction(event, () => setNotificationsOpen(current => !current))}
          >
            <Bell size={18} />
            <span className="kinba-feed-badge">3</span>
          </button>
          <button
            type="button"
            className="kinba-feed-avatar"
            aria-label="Open profile"
            onClick={event => stopAction(event, () => setNotificationsOpen(false))}
          >
            P
          </button>
        </div>
      </header>

      <nav className="kinba-feed-tabs" aria-label="Feed tabs" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "active" : ""}
            aria-selected={activeTab === tab}
            role="tab"
            onClick={event => stopAction(event, () => setActiveTab(tab))}
          >
            {tab}
          </button>
        ))}
      </nav>

      {searchOpen && (
        <div className="kinba-feed-searchbar">
          <Search size={16} aria-hidden="true" />
          <input autoFocus placeholder="Search creators, videos, or sounds" aria-label="Search feed" />
          <button type="button" aria-label="Close search" onClick={event => stopAction(event, () => setSearchOpen(false))}>
            <X size={16} />
          </button>
        </div>
      )}

      {notificationsOpen && (
        <aside className="kinba-feed-notifications" aria-label="Notifications">
          <strong>Notifications</strong>
          <p><b>Pookied</b> liked your signal.</p>
          <p><b>Sarah Jenkins</b> started following you.</p>
        </aside>
      )}

      <section className="kinba-feed-stage" aria-label={`${activeTab} feed`}>
        <div className="kinba-feed-poster" aria-hidden="true">
          <div className="kinba-feed-poster-glow glow-one" />
          <div className="kinba-feed-poster-glow glow-two" />
          <div className="kinba-feed-poster-person">P</div>
          <span className="kinba-feed-poster-label">KINBA ORIGINAL</span>
        </div>

        <div className="kinba-feed-gradient" />
        <div className="kinba-feed-copy">
          <div className="kinba-feed-author-row">
            <div className="kinba-feed-author-avatar">P</div>
            <div>
              <strong>Pookied</strong>
              <span>@pookied · Creator</span>
            </div>
            <button
              type="button"
              className={following ? "kinba-feed-follow followed" : "kinba-feed-follow"}
              onClick={event => stopAction(event, () => setFollowing(current => !current))}
            >
              {following ? "Following" : "Follow"}
            </button>
          </div>
          <h1>Late night energy in the city.</h1>
          <p>Finding little sparks of joy between the noise. Stay for the feeling.</p>
          <div className="kinba-feed-tags"><span>#citylights</span><span>#pookied</span><span>#kinba</span></div>
          <button type="button" className="kinba-feed-sound" onClick={event => stopAction(event, () => setPlaying(current => !current))}>
            {playing ? <Pause size={14} /> : <Music2 size={14} />}
            <span>{playing ? "Playing original sound" : "Original sound · Pookied"}</span>
          </button>
        </div>

        <aside className="kinba-feed-engagement" aria-label="Engagement actions">
          <button type="button" className={liked ? "liked" : ""} onClick={event => stopAction(event, toggleLike)} aria-label="Like">
            <Heart size={27} fill={liked ? "currentColor" : "none"} />
            <span>{(likes / 1000).toFixed(1)}K</span>
          </button>
          <button
            type="button"
            onClick={event => stopAction(event, () => setCommentsOpen(current => !current))}
            aria-label="Comments"
            aria-expanded={commentsOpen}
            title={commentsOpen ? "Hide comments" : "Show comments"}
          >
            <MessageCircle size={27} />
            <span>2.1K</span>
          </button>
          <button type="button" onClick={event => stopAction(event, () => undefined)} aria-label="Share">
            <Share2 size={27} />
            <span>880</span>
          </button>
          <button type="button" className="kinba-feed-engagement-avatar" onClick={event => stopAction(event, () => setFollowing(current => !current))} aria-label="Follow Pookied">
            <span>P</span><UserPlus size={13} />
          </button>
        </aside>

        {commentsOpen && (
          <section className="kinba-feed-comments" aria-label="Comments">
            <div className="kinba-feed-comments-head">
              <strong>Comments ({comments.length})</strong>
              <button type="button" onClick={event => stopAction(event, () => setCommentsOpen(false))} aria-label="Close comments">
                <X size={17} />
              </button>
            </div>
            <div className="kinba-feed-comments-list">
              {comments.map((commentItem, index) => (
                <p key={`${commentItem.author}-${index}`}><b>{commentItem.author}</b> {commentItem.body}</p>
              ))}
            </div>
            <form onSubmit={submitComment}>
              <input value={comment} onChange={event => setComment(event.target.value)} placeholder="Add a comment…" aria-label="Add a comment" />
              <button type="submit" aria-label="Send comment" disabled={!comment.trim()}><Send size={16} /></button>
            </form>
          </section>
        )}
      </section>

      {composerOpen && (
        <div className="kinba-feed-modal-layer">
          <button type="button" className="kinba-feed-modal-backdrop" onClick={event => stopAction(event, () => setComposerOpen(false))} aria-label="Close create dialog" />
          <section className="kinba-feed-composer" aria-label="Create a post">
            <button type="button" className="kinba-feed-modal-close" onClick={event => stopAction(event, () => setComposerOpen(false))} aria-label="Close create dialog"><X size={18} /></button>
            <span className="kinba-feed-eyebrow">CREATE ON KINBA</span>
            <h2>Share your signal.</h2>
            <p>Record a short audio message or upload a video for your community.</p>
            <button type="button" className="kinba-feed-audio-box" onClick={event => stopAction(event, () => setPlaying(true))}>
              <span className="kinba-feed-audio-icon"><Music2 size={19} /></span>
              <span><strong>Record an audio message</strong><small>Tap to start a new voice signal</small></span>
              <ChevronDown size={16} />
            </button>
          </section>
        </div>
      )}

      <nav className="kinba-feed-bottom-nav" aria-label="Primary navigation">
        <button type="button" className="active" onClick={event => stopAction(event, () => setActiveTab("ALL FEED"))}><span>⌂</span><small>Home</small></button>
        <button type="button" onClick={event => stopAction(event, () => setSearchOpen(true))}><Search size={20} /><small>Search</small></button>
        <button type="button" className="kinba-feed-create" onClick={event => stopAction(event, () => setComposerOpen(true))}><Plus size={24} /><small>Create</small></button>
        <button type="button" onClick={event => stopAction(event, () => setNotificationsOpen(true))}><Bell size={20} /><small>Alerts</small></button>
        <button type="button" onClick={event => stopAction(event, () => setFollowing(current => !current))}><span className="kinba-feed-menu-dot">•••</span><small>Menu</small></button>
      </nav>
    </main>
  );
}

export default KINBAFeed;
