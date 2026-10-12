import "./feedSections.css";

const I = {
  heart: <path d="M19.5 12.6 12 20l-7.5-7.4a5 5 0 0 1 7.5-6.6 5 5 0 0 1 7.5 6.6z" />,
  comment: <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.2A8 8 0 1 1 21 12z" />,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>,
  save: <path d="M6 4h12v17l-6-4-6 4z" />,
  play: <path d="M7 4v16l13-8z" />,
  dots: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  badge: <><path d="M12 3l2.4 1.6 2.9-.1 1.2 2.6 2.4 1.7-.7 2.8.7 2.8-2.4 1.7-1.2 2.6-2.9-.1L12 21l-2.4-1.6-2.9.1-1.2-2.6L3.1 15l.7-2.8-.7-2.8 2.4-1.7 1.2-2.6 2.9.1z" /><path d="m9 12 2 2 4-4" /></>,
};
const Icon = ({ n }) => <svg viewBox="0 0 24 24" aria-hidden="true">{I[n]}</svg>;

const initials = (name = "") => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const Avatar = ({ user, large }) => (
  <div className={`kf-av${large ? " lg" : ""}`} style={user.avatar ? { backgroundImage: `url(${user.avatar})` } : undefined}>
    {!user.avatar && initials(user.name)}
  </div>
);

/* Row 1: Newest updates.
   items: [{ id, user:{name,avatar}, timeAgo, type:"text"|"photo"|"video", text, thumb, unseen }] */
export function NewestUpdates({ items = [], onOpen, onViewAll }) {
  if (!items.length) return null;
  return (
    <section>
      <div className="kf-head">
        <h2 className="kf-title">Newest updates</h2>
        <button className="kf-link" onClick={onViewAll}>View all</button>
      </div>
      <div className="kf-row">
        {items.map((p) => (
          <button key={p.id} className="kf-upd" onClick={() => onOpen?.(p)}>
            {p.unseen && <span className="kf-upd-dot" aria-label="New" />}
            <div className="kf-upd-user">
              <Avatar user={p.user} />
              <div style={{ minWidth: 0 }}>
                <div className="kf-upd-name">{p.user.name}</div>
                <div className="kf-upd-time">{p.timeAgo}</div>
              </div>
            </div>
            {p.type === "text" || !p.thumb
              ? <div className="kf-upd-text">{p.text}</div>
              : <div className="kf-upd-thumb" style={{ backgroundImage: `url(${p.thumb})` }} />}
            <span className={`kf-tag ${p.type}`}>{p.type[0].toUpperCase() + p.type.slice(1)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* Row 2: Shorts.
   items: [{ id, title, thumb, likes, comments }] */
export function ShortsRow({ items = [], onOpen, onSeeAll }) {
  if (!items.length) return null;
  return (
    <section>
      <div className="kf-head">
        <h2 className="kf-title">Shorts</h2>
        <button className="kf-link" onClick={onSeeAll}>See all</button>
      </div>
      <div className="kf-row" style={{ paddingBottom: 18 }}>
        {items.map((s) => (
          <button key={s.id} className="kf-short" onClick={() => onOpen?.(s)}
            style={s.thumb ? { backgroundImage: `url(${s.thumb})` } : undefined}>
            <span className="kf-short-play"><Icon n="play" /></span>
            <span className="kf-short-info" style={{ display: "block" }}>
              <span className="kf-short-title" style={{ display: "block" }}>{s.title}</span>
              <span className="kf-short-meta">
                <span><Icon n="heart" /> {s.likes ?? 0}</span>
                <span><Icon n="comment" /> {s.comments ?? 0}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* Normal post, Facebook style.
   post: { id, user:{name,avatar,verified}, date, kind:"Photo"|"Video"|undefined, text, mediaUrl, mediaType:"image"|"video",
           pookies, comments, views, pookied, saved } */
export function PostCard({ post, onPookie, onComment, onShare, onSave, onMore }) {
  const { user } = post;
  return (
    <article className="kf-post">
      <div className="kf-post-head">
        <Avatar user={user} large />
        <div className="kf-post-who">
          <div className="kf-post-name">{user.name} {user.verified && <Icon n="badge" />}</div>
          <div className="kf-post-sub">{post.date}{post.kind ? ` · ${post.kind}` : ""}</div>
        </div>
        <button className="kf-more" aria-label="More options" onClick={() => onMore?.(post)}><Icon n="dots" /></button>
      </div>

      {post.text && <div className="kf-post-text">{post.text}</div>}
      {post.mediaUrl && (post.mediaType === "video"
        ? <video className="kf-post-media" src={post.mediaUrl} controls playsInline />
        : <img className="kf-post-media" src={post.mediaUrl} alt="" loading="lazy" />)}

      <div className="kf-counts">
        <span><Icon n="heart" /> {post.pookies ?? 0}</span>
        <span>{post.comments ?? 0} comments · {post.views ?? 0} views</span>
      </div>
      <div className="kf-actions">
        <button className={`kf-act${post.pookied ? " on" : ""}`} onClick={() => onPookie?.(post)}><Icon n="heart" />Pookie</button>
        <button className="kf-act" onClick={() => onComment?.(post)}><Icon n="comment" />Comment</button>
        <button className="kf-act" onClick={() => onShare?.(post)}><Icon n="share" />Share</button>
        <button className={`kf-act${post.saved ? " on" : ""}`} onClick={() => onSave?.(post)}><Icon n="save" />Save</button>
      </div>
    </article>
  );
}

/* Drop-in: put this where the For You feed renders. */
export default function ForYouFeed({ updates, shorts, posts, handlers = {} }) {
  return (
    <div className="kf">
      <NewestUpdates items={updates} onOpen={handlers.openPost} onViewAll={handlers.viewAllUpdates} />
      <ShortsRow items={shorts} onOpen={handlers.openShort} onSeeAll={handlers.seeAllShorts} />
      <div className="kf-feed">
        {posts?.map((p) => (
          <PostCard key={p.id} post={p} onPookie={handlers.pookie} onComment={handlers.comment}
            onShare={handlers.share} onSave={handlers.save} onMore={handlers.more} />
        ))}
      </div>
    </div>
  );
}
