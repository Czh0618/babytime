import { ref } from "vue";
import { resolveTheme, type ThemePreference } from "../domain/night";

const STORAGE_KEY = "babytime.theme";

export const themePreference = ref<ThemePreference>("system");

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function systemPrefersDark(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  } catch {
    return false;
  }
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(
    themePreference.value,
    systemPrefersDark(),
  );
}

export function initializeTheme(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    themePreference.value = isPreference(saved) ? saved : "system";
  } catch {
    themePreference.value = "system";
  }
  applyTheme();
  try {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (themePreference.value === "system") applyTheme();
      });
  } catch {
    // 老浏览器不支持监听时，重新打开页面会重新计算。
  }
}

export function setThemePreference(value: ThemePreference): void {
  if (!isPreference(value)) return;
  themePreference.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 隐私模式下本次会话仍生效。
  }
  applyTheme();
}
