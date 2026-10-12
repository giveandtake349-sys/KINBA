import { useLocation } from "wouter";
import { ChevronLeft, Lock } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useIsMobile } from "@/hooks/useMobile";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { SettingsButton, SettingsState } from "./atoms";
import {
  DEFAULT_SECTION,
  SETTINGS_SECTIONS,
  findSection,
  isSettingsSectionId,
  sectionPath,
  type SettingsSectionId,
} from "./model";
import AccountPane from "./AccountPane";
import PrivacyPane from "./PrivacyPane";
import SecurityPane from "./SecurityPane";
import NotificationsPane from "./NotificationsPane";
import MessagingPane from "./MessagingPane";
import ContentPane from "./ContentPane";
import AppearancePane from "./AppearancePane";
import DataPane from "./DataPane";
import HelpPane from "./HelpPane";
import "./settings.css";

const SETTINGS_PREFIX = "/settings/";

function readSectionParam(location: string) {
  if (!location.startsWith(SETTINGS_PREFIX)) return undefined;
  try {
    return decodeURIComponent(location.slice(SETTINGS_PREFIX.length));
  } catch {
    return undefined;
  }
}

function paneFor(section: SettingsSectionId) {
  switch (section) {
    case "account":
      return <AccountPane />;
    case "privacy":
      return <PrivacyPane />;
    case "security":
      return <SecurityPane />;
    case "notifications":
      return <NotificationsPane />;
    case "messaging":
      return <MessagingPane />;
    case "content":
      return <ContentPane />;
    case "appearance":
      return <AppearancePane />;
    case "data":
      return <DataPane />;
    case "help":
      return <HelpPane />;
    default:
      return <AccountPane />;
  }
}

export default function Settings() {
  const [location, navigate] = useLocation();
  const isMobile = useIsMobile();
  const auth = useAuth();

  const rawSection = readSectionParam(location);
  const requestedSection = isSettingsSectionId(rawSection)
    ? rawSection
    : undefined;
  const sectionId = requestedSection ?? DEFAULT_SECTION;
  const section = findSection(sectionId);
  const paneOpen = requestedSection !== undefined;

  const goBack = () => {
    if (isMobile && paneOpen) navigate("/settings");
    else navigate("/");
  };

  const openSection = (id: SettingsSectionId) => navigate(sectionPath(id));

  const loading = auth.loading;
  const signedIn = auth.isAuthenticated;

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <button
          type="button"
          className="settings-header__icon"
          onClick={goBack}
          aria-label={paneOpen && isMobile ? "Back to settings" : "Back to feed"}
          title={paneOpen && isMobile ? "Back to settings" : "Back to feed"}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <div className="settings-header__copy">
          <p className="settings-header__eyebrow">Account Center</p>
          <p className="settings-header__title">Settings</p>
        </div>
      </header>

      {!loading && !signedIn ? (
        <main className="settings-signed-out">
          <span className="settings-signed-out__mark" aria-hidden="true">
            <Lock size={24} />
          </span>
          <h2>Sign in to manage your account</h2>
          <p>
            Account, security, privacy and appearance settings are tied to your
            JHILIK profile.
          </p>
          <SettingsButton onClick={auth.openAuth}>Sign in to JHILIK</SettingsButton>
          {auth.authDialogOpen ? (
            <SupabaseAuthDialog
              open
              onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
            />
          ) : null}
        </main>
      ) : loading ? (
        <main className="settings-main">
          <SettingsState kind="loading" message="Checking your session…" />
        </main>
      ) : (
        <main className="settings-main">
          <div
            className="settings-layout"
            data-view={paneOpen ? "pane" : "index"}
          >
            <nav className="settings-index" aria-label="Settings categories">
              <div className="settings-index__intro">
                <p className="settings-pane__eyebrow">JHILIK</p>
                <h1>Settings</h1>
                <p>
                  One place for your account, privacy, security and the
                  preferences JHILIK can actually honour today.
                </p>
              </div>
              <ul className="settings-index__list">
                {SETTINGS_SECTIONS.map(item => {
                  const Icon = item.icon;
                  const active = item.id === sectionId;
                  const current =
                    active && (paneOpen || !isMobile) ? "page" : undefined;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="settings-index__button"
                        aria-current={current}
                        onClick={() => openSection(item.id)}
                      >
                        <span className="settings-index__icon" aria-hidden="true">
                          <Icon size={18} />
                        </span>
                        <span className="settings-index__body">
                          <span className="settings-index__label">
                            {item.label}
                          </span>
                          <span className="settings-index__description">
                            {item.description}
                          </span>
                        </span>
                        <ChevronLeft
                          size={16}
                          className="settings-index__chevron"
                          aria-hidden="true"
                          style={{ transform: "rotate(180deg)" }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section className="settings-pane" aria-label={section.label}>
              {paneOpen ? (
                <button
                  type="button"
                  className="settings-pane__back"
                  onClick={() => navigate("/settings")}
                >
                  <ChevronLeft size={14} aria-hidden="true" /> All settings
                </button>
              ) : null}
              {paneFor(sectionId)}
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
