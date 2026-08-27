// NIVO Signal Noir: the primary product narrative and prototype interaction surface.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight, Check, ChevronDown, Compass, Globe2, Home as HomeIcon,
  Link2, Menu, MessageCircle, Plus, Search, ShieldCheck, Sparkles,
  UserRound, X, Zap,
} from "lucide-react";

type Mode = "need" | "can";

const logoSrc = "/official-nivo-logo.png";
const heroImage = "/manus-storage/nivo-hero-field_7ca54bc2.png";
const orbitImage = "/manus-storage/nivo-global-orbit_791a7208.png";
const collageImage = "/manus-storage/nivo-profile-collage_7dc84bc9.png";

const categories = ["All signals", "Business", "Technology", "Design", "Education", "Jobs", "Services"];
const discoverItems = [
  { type: "CAN", title: "I can design a thoughtful brand identity.", desc: "Logos, visual systems, and launch-ready direction for new businesses.", category: "Design", person: "Maya Chen", place: "Singapore", initials: "MC", tone: "cyan" },
  { type: "NEED", title: "I need a Flutter developer for a new app.", desc: "Looking for a collaborative partner to turn a clear product brief into v1.", category: "Technology", person: "Jon Bell", place: "London", initials: "JB", tone: "violet" },
  { type: "CAN", title: "I can help you make sense of your next move.", desc: "Career and business advice from a decade of building small teams.", category: "Business", person: "Amina Yusuf", place: "Nairobi", initials: "AY", tone: "gold" },
];

function OfficialLogo({ small = false }: { small?: boolean }) {
  return <div className={`official-logo ${small ? "official-logo--small" : ""}`}><img src={logoSrc} alt="NIVO official logo" onError={(event) => { event.currentTarget.style.display = "none"; }} /><span className="logo-fallback">NIVO</span></div>;
}

function SignalCard({ mode, onPost }: { mode: Mode; onPost: (mode: Mode) => void }) {
  const [value, setValue] = useState("");
  const isNeed = mode === "need";
  return (
    <div className={`signal-card ${isNeed ? "signal-card--need" : "signal-card--can"}`}>
      <div className="signal-card__top"><span className="eyebrow">{isNeed ? "01 / INTENT" : "02 / CAPABILITY"}</span><span className="signal-dot" /></div>
      <h3>{isNeed ? "I NEED" : "I CAN"}</h3>
      <p className="signal-question">{isNeed ? "What are you looking for?" : "What can you provide?"}</p>
      <textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={isNeed ? "Tell the world what you need..." : "Tell the world what you can do..."} rows={3} />
      <div className="chip-row">{(isNeed ? ["a website", "a tutor", "a partner"] : ["design logos", "teach English", "build apps"]).map((chip) => <button key={chip} onClick={() => setValue(`${isNeed ? "I need " : "I can "}${chip}`)}>{isNeed ? "I need " : "I can "}{chip}</button>)}</div>
      <button className="primary-btn primary-btn--wide" onClick={() => { if (!value.trim()) return toast("Put it into words first", { description: isNeed ? "What are you looking for?" : "What can you provide?" }); onPost(mode); }}>{isNeed ? "Post a Need" : "Post What I Can"}<ArrowRight size={16} /></button>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState("All signals");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState("I think I can help you with your need.");
  const [mode, setMode] = useState<Mode>("need");
  const filtered = useMemo(() => category === "All signals" ? discoverItems : discoverItems.filter((item) => item.category === category), [category]);

  const jump = (id: string) => { setActive(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); };
  const post = (postedMode: Mode) => { setMode(postedMode); setActive("matches"); document.getElementById("matches")?.scrollIntoView({ behavior: "smooth" }); toast(postedMode === "need" ? "Need published" : "Capability published", { description: "Your signal is now ready to meet the right person." }); };

  return (
    <div className="nivo-app">
      <header className="topbar"><a className="brand" href="#home" onClick={() => jump("home")}><OfficialLogo /><span className="brand-name">NIVO</span></a><nav className="desktop-nav"><button onClick={() => jump("discover")}>Explore</button><button onClick={() => jump("how")}>How it works</button><button onClick={() => jump("about")}>About</button></nav><div className="topbar-actions"><button className="login-btn" onClick={() => toast("Sign in is coming next", { description: "The MVP keeps the doorway clear while the phone OTP flow is connected." })}>Log in</button><button className="primary-btn primary-btn--compact" onClick={() => jump("signals")}>Get started <ArrowRight size={15} /></button><button className="menu-btn" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>{menuOpen && <div className="mobile-menu"><button onClick={() => jump("discover")}>Explore</button><button onClick={() => jump("how")}>How it works</button><button onClick={() => jump("about")}>About</button></div>}</header>

      <main>
        <section className="hero" id="home"><div className="hero-image" style={{ backgroundImage: `url(${heroImage})` }} /><div className="hero-copy"><p className="eyebrow eyebrow--bright"><span className="live-pulse" /> A new kind of human network</p><h1>What do you <em>need?</em><br />What can you <em>offer?</em></h1><p className="hero-lede">NIVO connects people through what they need and what they can do.</p><div className="hero-actions"><button className="primary-btn" onClick={() => jump("signals")}>Find a match <ArrowRight size={17} /></button><button className="ghost-btn" onClick={() => { setMode("can"); jump("signals"); }}>I can help <Zap size={16} /></button></div></div><div className="signal-diagram" aria-label="I NEED to NIVO to I CAN"><div className="diagram-node diagram-node--left"><span>I NEED</span><small>an answer, a partner</small></div><div className="diagram-line"><i /><i /><i /></div><div className="diagram-core"><OfficialLogo small /><span>NIVO</span></div><div className="diagram-line diagram-line--right"><i /><i /><i /></div><div className="diagram-node diagram-node--right"><span>I CAN</span><small>a skill, a hand</small></div></div><div className="hero-foot"><span>Everyone needs.</span><span className="hero-foot-line" /><span>Everyone can.</span></div></section>

        <section className="signals-section section-shell" id="signals"><div className="section-heading"><div><p className="eyebrow">The signal layer</p><h2>Start with what’s<br /><span>useful.</span></h2></div><p className="section-intro">A simple place to put your intent into words — and make your capability visible to someone who needs it.</p></div><div className="signal-grid"><SignalCard mode="need" onPost={post} /><SignalCard mode="can" onPost={post} /></div></section>

        <section className="matches-section section-shell" id="matches"><div className="section-heading section-heading--tight"><div><p className="eyebrow">Recommended match</p><h2>Someone is already<br /><span>close to your signal.</span></h2></div><span className="recommend-badge"><Sparkles size={14} /> MVP recommendation</span></div><div className="match-panel"><div className="match-intent"><span className="eyebrow">Your {mode === "need" ? "need" : "capability"}</span><p>“{mode === "need" ? "I need a logo for my business." : "I create modern brand identities and logos."}”</p><div className="intent-status"><Check size={14} /> Ready to connect</div></div><div className="match-arrow"><Link2 size={19} /></div><div className="match-person"><div className="avatar avatar--large">MC</div><div><span className="eyebrow">Possible match</span><h3>Maya Chen <ShieldCheck size={15} /></h3><p>I create modern brand identities and logos.</p><span className="meta">Design · Singapore · English</span></div><button className="primary-btn primary-btn--compact" onClick={() => setRequestOpen(true)}>Connect <ArrowRight size={15} /></button></div></div></section>

        <section className="discover-section section-shell" id="discover"><div className="section-heading"><div><p className="eyebrow">Explore the network</p><h2>Find the signal<br /><span>that matters.</span></h2></div><button className="text-btn" onClick={() => toast("Discover is in preview", { description: "Browse the first set of public signals below." })}>View all <ArrowRight size={15} /></button></div><div className="category-row">{categories.map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="discover-list">{filtered.map((item) => <article className="discover-card" key={item.title}><div className={`type-pill type-pill--${item.tone}`}>{item.type}</div><h3>{item.title}</h3><p>{item.desc}</p><div className="card-meta"><div className={`avatar avatar--${item.tone}`}>{item.initials}</div><div><strong>{item.person}</strong><span>{item.place} · 2h ago</span></div><button className="icon-btn" aria-label={`Connect with ${item.person}`} onClick={() => setRequestOpen(true)}><Link2 size={17} /></button></div></article>)}</div></section>

        <section className="how-section section-shell" id="how"><div className="how-visual" style={{ backgroundImage: `url(${collageImage})` }}><div className="orbit-tag"><Globe2 size={16} /> 01 — 1,000,000,000 possibilities</div></div><div className="how-copy"><p className="eyebrow">How NIVO works</p><h2>The world already<br />has the <span>answers.</span></h2><p>Sometimes the right person is all you are missing. NIVO makes it easier to surface useful people without turning human connection into a noisy feed.</p><div className="step-list">{[["01", "Tell us what you need", "Post a NEED."], ["02", "Tell us what you can do", "Post a CAN."], ["03", "Discover the right people", "Find a relevant signal."], ["04", "Connect", "Talk and collaborate."]].map(([num, title, desc]) => <div className="step" key={num}><span>{num}</span><div><strong>{title}</strong><small>{desc}</small></div><ArrowRight size={15} /></div>)}</div></div></section>

        <section className="vision-section" id="about" style={{ backgroundImage: `linear-gradient(90deg, rgba(6,10,28,.98) 0%, rgba(6,10,28,.78) 52%, rgba(6,10,28,.32) 100%), url(${orbitImage})` }}><div className="section-shell vision-inner"><p className="eyebrow">A long view</p><h2>One world.<br /><span>Billions of people.</span><br />Infinite possibilities.</h2><p>NIVO is building toward a calmer global layer for discovering people who can help you — and people you can help.</p><button className="ghost-btn" onClick={() => toast("You’re looking at the beginning", { description: "Future versions will add AI matching, translation, verification, and more." })}>See the roadmap <ArrowRight size={16} /></button></div></section>
      </main>

      <footer className="footer section-shell"><div><div className="brand"><OfficialLogo /><span className="brand-name">NIVO</span></div><p>CONNECT WHAT MATTERS</p></div><div className="footer-links"><button>About</button><button>How it works</button><button>Community guidelines</button><button>Privacy</button><button>Terms</button><button>Contact</button></div><span className="footer-note">© 2026 NIVO · Everyone needs. Everyone can.</span></footer>

      <nav className="bottom-nav"><button className={active === "home" ? "active" : ""} onClick={() => jump("home")}><HomeIcon size={19} /><span>Home</span></button><button className={active === "discover" ? "active" : ""} onClick={() => jump("discover")}><Compass size={19} /><span>Discover</span></button><button className="create-nav" onClick={() => jump("signals")}><Plus size={23} /></button><button onClick={() => toast("Connections are ready for your first match", { description: "Connect from any signal card to start." })}><MessageCircle size={19} /><span>Connections</span></button><button onClick={() => toast("Profile preview", { description: "Verified phone · English / Arabic · 3 completed connections" })}><UserRound size={19} /><span>Profile</span></button></nav>

      {requestOpen && <div className="modal-backdrop" onClick={() => setRequestOpen(false)}><div className="request-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setRequestOpen(false)}><X size={18} /></button><p className="eyebrow">Connection request</p><h2>Make the first move.</h2><p className="modal-copy">Tell Maya why you want to connect. Keep it human and specific.</p><div className="request-person"><div className="avatar avatar--large">MC</div><div><strong>Maya Chen</strong><span>Logo designer · Singapore</span></div></div><textarea value={requestText} onChange={(e) => setRequestText(e.target.value)} rows={4} /><button className="primary-btn primary-btn--wide" onClick={() => { setRequestOpen(false); toast("Request sent", { description: "We’ll let you know when Maya responds." }); }}>Send connection request <ArrowRight size={16} /></button><small className="safety-note"><ShieldCheck size={14} /> Phone verified · You can report or block at any time.</small></div></div>}
    </div>
  );
}
