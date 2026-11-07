import { localDate, localDateTime } from "./date.ts";
import type { Workspace } from "../types.ts";

export function emptyWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    baby: { name: "宝宝", birthDate: "" },
    media: [],
    candidates: [],
    entries: [],
    recaps: [],
    vaccinations: [],
    vaccinePlan: { specialProgram: false, choices: {} },
  };
}

export function demoWorkspace(): Workspace {
  const now = new Date();
  const before = (days: number, hour: number, minute: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    date.setHours(hour, minute, 0, 0);
    return localDateTime(date);
  };
  const birth = new Date(now);
  birth.setDate(birth.getDate() - 44);
  const dates = [before(1, 20, 12), before(2, 9, 36), before(3, 16, 8)];
  const titles = [
    "被爸爸轻轻抱着",
    "今天的小手，握得很紧",
    "这个月的第一张合照",
  ];
  const notes = [
    "忙碌一天后，最喜欢的时刻。",
    "小小的手，刚好握住我的手指。",
    "和你一起，开始新的一月。",
  ];
  const themes = ["sand", "sage", "rose"] as const;
  const workspace: Workspace = {
    schemaVersion: 1,
    baby: { name: "小满", birthDate: localDate(birth) },
    media: dates.map((date, i) => ({
      id: `demo-media-${i}`,
      kind: "image",
      name: `成长相片 ${i + 1}`,
      mime: "image/jpeg",
      size: 0,
      capturedAt: date,
      demo: true,
      theme: themes[i]!,
    })),
    entries: dates.map((date, i) => ({
      id: `demo-entry-${i}`,
      mediaId: `demo-media-${i}`,
      title: titles[i]!,
      note: notes[i]!,
      capturedAt: date,
      tag: i === 2 ? "家庭合影" : "日常片刻",
      favorite: false,
      milestone: false,
      demo: true,
    })),
    candidates: [
      {
        id: "demo-smile",
        mediaId: "demo-video-smile",
        title: "这一刻，你的小小笑脸",
        suggestion: "疑似互动微笑",
        note: "想把你的小小笑脸，留给以后的我们。",
        capturedAt: before(1, 17, 24),
        start: 8,
        end: 16,
        origin: "demo",
        status: "pending",
      },
      {
        id: "demo-tummy",
        mediaId: "demo-video-tummy",
        title: "趴着看世界的片刻",
        suggestion: "疑似抬头片段",
        note: "今天也在认真地看这个世界。",
        capturedAt: before(2, 10, 18),
        start: 12,
        end: 20,
        origin: "demo",
        status: "pending",
      },
    ],
    recaps: [],
  };
  workspace.media.push(
    ...workspace.candidates.map((candidate, i) => ({
      id: candidate.mediaId,
      kind: "video" as const,
      name: `IMG_DEMO_${i + 1}.MOV`,
      mime: "video/quicktime",
      size: 0,
      capturedAt: candidate.capturedAt,
      duration: 28,
      demo: true,
      theme: themes[i]!,
      previewable: false,
    })),
  );
  return workspace;
}
