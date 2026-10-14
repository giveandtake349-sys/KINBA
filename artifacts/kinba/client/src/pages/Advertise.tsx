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
    text: "Share your brand, objectives, preferred formats, and proposed budget.",
  },
  {
    title: "Review",
    text: "Our team assesses submitted applications. Review timing may vary.",
  },
  {
    title: "Discuss next steps",
    text: "If there is a fit, we can discuss availability, scope, and any estimate before an agreement.",
  },
];

const APPLICATION_DETAILS = [
  "Your brand and business contact details",
  "Campaign objectives, preferred formats, and target market",
  "Proposed budget, timing, and relevant links",
  "Optional business verification documents",
];

/** Public application information only; no unverified audience or service claims. */
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
          Explore
          <br />
          JHILIK
        </h1>
        <p>
          Share your brand goals and campaign idea. Submit an application for
          review; campaign availability and reach are not guaranteed.
        </p>
        <button
          type="button"
          className="adv-cta light"
          onClick={() => navigate("/advertise/apply")}
        >
          Apply as a Brand
          <ArrowRight size={18} />
        </button>
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

      <section className="adv-card" aria-label="Campaign formats to request">
        <h2>Formats to discuss</h2>
        <p className="adv-hint">
          You can ask about these formats in your application. Availability is
          assessed during review.
        </p>
        <div className="adv-formats">
          {FORMATS.map(format => (
            <span className="adv-format-pill" key={format}>
              {format}
            </span>
          ))}
        </div>
      </section>

      <section className="adv-card" aria-label="Application details">
        <h2>What to include</h2>
        <div className="adv-steps">
          {APPLICATION_DETAILS.map(line => (
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
        Submitting an application is not a campaign commitment. Any proposed
        scope, reach estimate, availability, and timing will be discussed
        separately before an agreement.
      </p>
    </main>
  );
}
