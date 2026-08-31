import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";
import "../index.css";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="kinba-app not-found-shell">
      <main className="not-found-card">
        <AlertCircle aria-hidden="true" />
        <p className="eyebrow eyebrow--bright">Signal not found</p>
        <h1>404</h1>
        <h2>This page is out of range.</h2>
        <p>The address may have changed, or the conversation has not started yet.</p>
        <button type="button" className="primary-btn" onClick={handleGoHome}>
          <Home size={16} />
          Return to feed
        </button>
      </main>
    </div>
  );
}
