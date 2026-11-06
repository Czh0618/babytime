/**
 * PWA 环境判断与迁移引导文案。
 * Safari 与主屏幕 Web App 的 IndexedDB 互相隔离，需要引导家长先导出再恢复。
 */

export interface MigrationGuide {
  title: string;
  steps: string[];
  note: string;
}

export interface DisplayEnvironment {
  standalone: boolean;
  ios: boolean;
}

type MatchMedia = (query: string) => { matches: boolean } | null;

function defaultMatchMedia(query: string): { matches: boolean } | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query)
      : null;
  } catch {
    return null;
  }
}

export function isStandalone(
  matchMedia: MatchMedia = defaultMatchMedia,
  navigatorStandalone = false,
): boolean {
  if (navigatorStandalone) return true;
  try {
    return Boolean(matchMedia("(display-mode: standalone)")?.matches);
  } catch {
    return false;
  }
}

export function isIOS(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent);
}

export function migrationCopy(env: DisplayEnvironment): MigrationGuide {
  if (env.standalone)
    return {
      title: "正在主屏幕应用里",
      steps: [
        "这里的记录和 Safari 里的记录各自独立，不会自动互通。",
        "如果 Safari 里还留着旧记录，先在 Safari 导出备份 JSON。",
        "回到主屏幕应用，用「从备份恢复」把记录与原片带过来。",
      ],
      note: "迁移完成后，建议固定在这一处记录；两边的原片始终留在本机。",
    };
  if (env.ios)
    return {
      title: "Safari 和主屏幕数据不互通",
      steps: [
        "先在 Safari 里导出备份 JSON。",
        "用分享菜单把 BabyTime「添加到主屏幕」。",
        "打开主屏幕应用，再用「从备份恢复」导入刚才的备份。",
      ],
      note: "两边的照片与记录不会自动同步；新版备份包含本机可用的原片。",
    };
  return {
    title: "数据保存在当前浏览器",
    steps: [
      "换浏览器或设备前，先用「导出备份 JSON」带走记录与原片。",
      "在新位置打开 BabyTime，用「从备份恢复」导入。",
    ],
    note: "不同域名、浏览器和设备之间的本机数据不互通。",
  };
}
