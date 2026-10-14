import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import "./advertise.css";

const FORMATS = [
  "Sponsored Feed",
  "Sponsored Video",
  "Sponsored Shorts",
  "Creator-led",
  "Product Demo",
];

const STEPS = [
  {
    title: "Apply",
    text: "Tell us about your brand, goals, and budget. Takes about 5 minutes.",
  },
  {
    title: "Review",
    text: "Our team reviews every application within 48 hours and confirms a custom reach estimate.",
  },
  {
    title: "Launch",
    text: "Invited creators publish, and you track real views, clicks, and engagement.",
  },
];

/**
 * Public "Advertise with JHILIK" landing page. Visible to everyone —
 * including logged-out visitors. Contains zero budget or business internals.
 */
export default function Advertise() {
  const [, navigate] = useLocation();

  return (
    <main className="adv-page">
      <div className="adv-topbar">
        <button
          type="button"
          className="adv-back"
          onClick={() => navigate("/")}
          aria-label="Back to home"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="adv-logo">JHILIK</span>
        <span style={{ width: 40 }} aria-hidden="true" />
      </div>

      <section className="adv-hero" aria-label="Advertise with JHILIK">
        <h1>
          Grow with
          <br />
          JHILIK
        </h1>
        <p>
          Put your brand in front of real audiences — through creators they
          already trust. Sponsored feed, videos, shorts, and creator-led
          campaigns.
        </p>
        <button
          type="button"
          className="adv-cta light"
          onClick={() => navigate("/advertise/apply")}
        >
          Apply as a Brand
          <ArrowRight size={18} />
        </button>
        <div className="adv-hero-stats" aria-label="Platform highlights">
          <div>
            <b>48K</b>
            <span>creators</span>
          </div>
          <div>
            <b>2.1M</b>
            <span>monthly views</span>
          </div>
          <div>
            <b>48h</b>
            <span>review time</span>
          </div>
        </div>
      </section>

      <section className="adv-card" aria-label="How it works">
        <h2>How it works</h2>
        <div className="adv-steps">
          {STEPS.map((step, index) => (
            <div className="adv-step" key={step.title}>
              <span className="adv-step-num" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="adv-card" aria-label="Campaign formats">
        <h2>Campaign formats</h2>
        <div className="adv-formats">
          {FORMATS.map(format => (
            <span className="adv-format-pill" key={format}>
              {format}
            </span>
          ))}
        </div>
      </section>

      <section className="adv-card" aria-label="What you get">
        <h2>Every campaign includes</h2>
        <div className="adv-steps">
          {[
            "A dedicated review manager from our team",
            "Invitation-only creators matched to your goals",
            "Real view, impression, and click tracking",
            "Honest estimates — never inflated numbers",
          ].map(line => (
            <div className="adv-step" key={line}>
              <CheckCircle2 size={20} color="#1a7f37" aria-hidden="true" />
              <div>
                <small style={{ fontSize: 14 }}>{line}</small>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="adv-cta full"
          onClick={() => navigate("/advertise/apply")}
        >
          Start your application
          <ArrowRight size={18} />
        </button>
      </section>

      <p className="adv-fine">
        All reach figures are honest estimates from real platform data.
        <br />
        <strong>Estimated — Not Guaranteed.</strong>
      </p>
    </main>
  );
}
