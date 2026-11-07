export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

/** 夜间窗口固定为 22:00–06:00，两端按整点归属。 */
export function isNightTime(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

export interface NightWindow {
  start: Date;
  end: Date;
}

/** 最近一个夜间窗口：前一天 22:00 到当天 06:00。 */
export function nightWindow(now: Date): NightWindow {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  start.setHours(22, 0, 0, 0);
  return { start, end };
}
