/**
 * 视频片段的播放边界，记录详情与编辑弹窗共用。
 *
 * 不要给 blob: URL 拼 `#t=起,止`：iOS Safari 与微信 WKWebView 会把片段
 * 当成 blob 地址的一部分，资源直接加载失败，播放器只剩一个带斜杠的
 * 播放图标。src 一律用原始 URL，片段起止由播放器事件收敛到这里。
 */

export interface ClipRange {
  start?: number;
  end?: number;
}

export type ClipAction = { seekTo: number } | { pause: true } | null;

/** 决定播放器在某个时刻该把播放头移到起点、暂停，还是什么都不做。 */
export function clipAction(
  currentTime: number,
  clip: ClipRange,
  event: "metadata" | "play" | "timeupdate",
): ClipAction {
  const rawStart = clip.start ?? 0;
  const rawEnd = clip.end;
  // 片段数据有一项不可信就整段放弃限制，宁可播完整段，也不把播放器卡死。
  if (!Number.isFinite(rawStart)) return null;
  if (rawEnd !== undefined && !Number.isFinite(rawEnd)) return null;
  const start = Math.max(0, rawStart);
  if (rawEnd !== undefined && rawEnd <= start) return null;
  if (!Number.isFinite(currentTime)) return null;
  const time = currentTime;
  const atEnd = rawEnd !== undefined && time >= rawEnd;

  if (event === "metadata")
    // 元数据刚就绪时只往前定位，别把已经在片段里的播放头拖回起点。
    return time < start ? { seekTo: start } : null;
  if (event === "play")
    // 播到片段末尾后再点播放，从片段起点重播。
    return time < start || atEnd ? { seekTo: start } : null;
  return atEnd ? { pause: true } : null;
}
