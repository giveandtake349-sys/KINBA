import { useState } from "react";
import {
  Bell,
  Bookmark,
  Check,
  ChevronRight,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Search,
  Send,
  Sparkles,
} from "lucide-react";

import "./KINBAFeed.css";

type ToastMessage = "Saved to collection" | "Opening collection" | "Story selected" | "Notifications muted";

export function KINBAFeed() {
  const [selectedHotspot, setSelectedHotspot] = useState<"one" | "two" | null>("one");
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (message: ToastMessage) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  };

  return (
    <main className="kinba-shell">
      <section className="kinba-stage" aria-label="KINBA mobile feed case study mockup">
        <div className="kinba-intro">
          <p className="kinba-kicker">A social atlas / 01</p>
          <h1>Find what<br />feels <em>alive.</em></h1>
          <p className="kinba-intro-copy">
            A private gallery for the places, art, and ideas your people keep close.
          </p>
          <div className="kinba-intro-rule" />
        </div>

        <div className="kinba-device-wrap">
          <div className="kinba-device-shadow" />
          <div className="kinba-hand" aria-hidden="true" />
          <div className="kinba-phone">
            <div className="kinba-island" aria-hidden="true" />
            <div className="kinba-screen">
              <div className="kinba-scroll">
                <header className="kinba-topbar">
                  <div className="kinba-wordmark">KIN<span>BA</span></div>
                  <div className="kinba-controls">
                    <button
                      className="kinba-icon-button"
                      type="button"
                      aria-label="Search KINBA"
                      onClick={() => showToast("Opening collection")}
                    >
                      <Search size={15} strokeWidth={1.8} />
                    </button>
                    <button
                      className="kinba-icon-button"
                      type="button"
                      aria-label="Toggle notifications"
                      onClick={() => showToast("Notifications muted")}
                    >
                      <Bell size={15} strokeWidth={1.8} />
                    </button>
                  </div>
                </header>

                <div className="kinba-search" role="search">
                  <Search size={12} strokeWidth={1.8} />
                  <span>Search art, places, ideas</span>
                  <Sparkles size={11} color="#D1AB6C" style={{ marginLeft: "auto" }} />
                </div>

                <div className="kinba-stories" aria-label="Story reels">
                  {[
                    ["M", "Mara", ""],
                    ["H", "Hiro", "s2"],
                    ["A", "Anika", "s3"],
                    ["J", "Jules", "s4"],
                    ["R", "Rafi", "s5"],
                  ].map(([initial, name, style], index) => (
                    <button
                      className="kinba-story"
                      type="button"
                      key={name}
                      aria-label={`View ${name}'s story`}
                      onClick={() => showToast("Story selected")}
                    >
                      <div className={`kinba-story-ring ${index === 0 ? "is-active" : ""}`}>
                        <div className={`kinba-story-art ${style}`}>{initial}</div>
                      </div>
                      <p>{name}</p>
                    </button>
                  ))}
                </div>

                <article className="kinba-post">
                  <div className="kinba-profile">
                    <div className="kinba-avatar">SA</div>
                    <div className="kinba-profile-meta">
                      <div className="kinba-handle-row">
                        <span className="kinba-handle">studio.aurora</span>
                        <Check className="kinba-verified" size={12} strokeWidth={2.5} />
                      </div>
                      <div className="kinba-location"><MapPin size={9} style={{ verticalAlign: "-1px" }} /> Reykjavík, IS · 2h</div>
                    </div>
                    <button className="kinba-icon-button kinba-more" type="button" aria-label="More post options" onClick={() => showToast("Saved to collection")}>
                      <MoreHorizontal size={16} />
                    </button>
                  </div>

                  <div className="kinba-art-frame">
                    <img src="/__mockup/images/kinba-light-sculpture.jpg" alt="Glowing alabaster light sculpture in a dark gallery" />
                    <div className="kinba-art-vignette" />
                    <button
                      type="button"
                      aria-label="Show Light Sculpture details"
                      className={`kinba-hotspot one ${selectedHotspot === "one" ? "is-selected" : ""}`}
                      onClick={() => setSelectedHotspot(selectedHotspot === "one" ? null : "one")}
                    />
                    <button
                      type="button"
                      aria-label="Show Exhibition Details"
                      className={`kinba-hotspot two ${selectedHotspot === "two" ? "is-selected" : ""}`}
                      onClick={() => setSelectedHotspot(selectedHotspot === "two" ? null : "two")}
                    />
                    <div className={`kinba-hotspot-tip one ${selectedHotspot === "one" ? "is-selected" : ""}`}><strong>Light Sculpture</strong>Alabaster / 2024</div>
                    <div className={`kinba-hotspot-tip two ${selectedHotspot === "two" ? "is-selected" : ""}`}><strong>Exhibition Details</strong>Open through 18 Aug</div>
                  </div>

                  <div className="kinba-post-copy">
                    <div className="kinba-dock">
                      <button className={`kinba-action ${liked ? "liked" : ""}`} type="button" aria-label="Like post" onClick={() => setLiked(!liked)}>
                        <Heart size={15} fill={liked ? "currentColor" : "none"} /> <span>{liked ? "2,846" : "2,845"}</span>
                      </button>
                      <button className="kinba-action" type="button" aria-label="Comment on post" onClick={() => showToast("Opening collection")}>
                        <MessageCircle size={15} /> <span>128</span>
                      </button>
                      <button className="kinba-action" type="button" aria-label="Share post" onClick={() => showToast("Opening collection")}>
                        <Send size={14} /> <span>Share</span>
                      </button>
                      <button className={`kinba-action bookmark ${saved ? "saved" : ""}`} type="button" aria-label="Save post" onClick={() => { setSaved(!saved); showToast("Saved to collection"); }}>
                        <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <p className="kinba-engagement">Liked by <strong>studio.art</strong> <span>&amp; 2,845 others</span></p>
                    <p className="kinba-caption"><strong>studio.aurora</strong> The room listens back when the light is given enough space.<br />A quiet study in warmth, weight, and waiting.</p>
                    <div className="kinba-tags">
                      <span className="kinba-tag">#lightasmedium</span>
                      <span className="kinba-tag">#nordicspaces</span>
                      <span className="kinba-tag">#slowlooking</span>
                    </div>
                  </div>
                </article>

                <button className="kinba-explore" type="button" onClick={() => showToast("Opening collection")}>
                  Explore collection <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="kinba-grip" aria-hidden="true" />
          {toast && <div className="kinba-toast" role="status">{toast}</div>}
        </div>

        <aside className="kinba-annotations" aria-label="Product annotations">
          <div className="kinba-note">glowing wordmark</div>
          <div className="kinba-note">portrait reels</div>
          <div className="kinba-note">contextual hotspots</div>
          <div className="kinba-note">save the feeling</div>
        </aside>
        <div className="kinba-footer-mark">KINBA / FIELD NOTES</div>
      </section>
    </main>
  );
}