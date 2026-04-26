/**
 * Theme provider — persistent light/dark/system selection.
 *
 * The actual `data-theme` attribute is set on `<html>` by the inline
 * boot script in `index.html` (so first paint matches the user's
 * preference and we avoid a flash). This hook keeps React in sync with
 * that state and exposes a setter that updates both the DOM attribute
 * and `localStorage`.
 *
 * Three modes:
 *   - "light" / "dark": explicit pin, persisted
 *   - "system":         follow `prefers-color-scheme`, react to changes
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "mako.theme";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode(mode: ThemeMode): void;
  toggle(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* noop */
  }
  return "system";
}

function writeStoredMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
}

function detectSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(detectSystemTheme);

  // Track system preference changes so "system" mode stays live.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const resolved: ResolvedTheme = mode === "system" ? systemTheme : mode;

  // Mirror resolved theme to the DOM whenever it changes.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeStoredMode(next);
  }, []);

  const toggle = useCallback(() => {
    // Toggle cycles through the resolved binary states; if the operator
    // is on "system" we lock the next state explicitly so the toggle
    // feels predictable.
    setModeState((prev) => {
      const current = prev === "system" ? detectSystemTheme() : prev;
      const next: ThemeMode = current === "dark" ? "light" : "dark";
      writeStoredMode(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
