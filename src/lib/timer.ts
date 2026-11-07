import { parseActiveTimer, type ActiveTimer } from "../domain/timer.ts";

const KEY = "babytime.activeTimer";

/** 计时状态存本机；隐私模式下写不进去时，本次会话仍可用内存里的值。 */
export function readActiveTimer(): ActiveTimer | null {
  try {
    return parseActiveTimer(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeActiveTimer(timer: ActiveTimer): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(timer));
  } catch {
    // 写不进去也不影响当前会话的计时。
  }
}

export function clearActiveTimer(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略：下次读取时会被当成没有计时。
  }
}
