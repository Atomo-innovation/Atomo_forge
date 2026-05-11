export type ThemeMode = "light" | "dark";

const KEY = "atomo-forge:theme-mode:v1";

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // ignore
  }
  return "dark";
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
  applyThemeMode(mode);
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function initThemeMode(): void {
  applyThemeMode(getThemeMode());
}

