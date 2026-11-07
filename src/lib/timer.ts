import {
  parseActiveTimers,
  type ActiveTimer,
} from "../domain/timer.ts";

const KEY = "babytime.activeTimer";

/** 计时状态存本机；隐私模式下写不进去时，本次会话仍可用内存里的值。 */
export function readActiveTimers(): ActiveTimer[] {
  try {
    return parseActiveTimers(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function writeActiveTimers(timers: ActiveTimer[]): void {
  try {
    if (timers.length) localStorage.setItem(KEY, JSON.stringify(timers));
    else localStorage.removeItem(KEY);
  } catch {
    // 写不进去也不影响当前会话的计时。
  }
}
