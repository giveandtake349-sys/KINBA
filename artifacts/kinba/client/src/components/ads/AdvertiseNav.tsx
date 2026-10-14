import { useLocation } from "wouter";

export type AdvertiseSection = "advertise" | "my-ads" | "apply";

const ITEMS: Array<{ id: AdvertiseSection; label: string; path: string }> = [
  { id: "advertise", label: "Advertise", path: "/advertise" },
  { id: "my-ads", label: "My Ads", path: "/advertise/my-ads" },
  { id: "apply", label: "Apply", path: "/advertise/apply" },
];

/**
 * Top section nav for the advertise area (Advertise | My Ads | Apply).
 * Never called "dashboard" — the user's confirmed IA names it "My Ads".
 */
export function AdvertiseNav({ active }: { active: AdvertiseSection }) {
  const [, navigate] = useLocation();
  return (
    <nav className="adv-section-nav" aria-label="Advertise sections">
      {ITEMS.map(item => (
        <button
          key={item.id}
          type="button"
          className={item.id === active ? "on" : ""}
          aria-current={item.id === active ? "page" : undefined}
          onClick={() => {
            if (item.id !== active) navigate(item.path);
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
