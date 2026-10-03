import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { applyStoredMotionPreference } from "./motionPreference";

type Theme = "light" | "dark";
/** What the user picked: an explicit theme or "follow the device". */
type ThemeMode = Theme | "system";

interface ThemeContextType {
  /** Resolved theme actually painted right now (`system` already applied). */
  theme: Theme;
  /** Stored preference, including `system`. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Flips between the light and dark resolution of the current mode. */
  toggleTheme: () => void;
  switchable: boolean;
}
interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

const THEME_STORAGE_KEY = "kinba-theme";
const THEME_MODE_STORAGE_KEY = "kinba-theme-mode";
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredMode(defaultTheme: Theme): ThemeMode {
  if (typeof window === "undefined") return defaultTheme;
  const mode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (mode === "light" || mode === "dark" || mode === "system") return mode;
  // Theme writes `kinba-theme` first; keep those installs on their choice.
  const legacy = window.localStorage.getItem(THEME_STORAGE_KEY);
  return legacy === "light" || legacy === "dark" ? legacy : defaultTheme;
}

function readSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(mode: ThemeMode): Theme {
  return mode === "system" ? readSystemTheme() : mode;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = true,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    readStoredMode(defaultTheme)
  );
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(mode));

  useEffect(() => {
    setTheme(resolveTheme(mode));
    if (mode !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
    if (switchable) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    }
    // Reduced motion is an appearance preference stored next to the theme and
    // must apply on first paint of every session, not only inside Settings.
    applyStoredMotionPreference();
  }, [theme, mode, switchable]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      if (!switchable) return;
      setModeState(next);
    },
    [switchable]
  );

  const toggleTheme = useCallback(() => {
    if (!switchable) return;
    setModeState(current => (resolveTheme(current) === "dark" ? "light" : "dark"));
  }, [switchable]);

  const value = useMemo(
    () => ({ theme, mode, setMode, toggleTheme, switchable }),
    [theme, mode, setMode, toggleTheme, switchable]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
