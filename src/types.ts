import type { CareObservation } from "./domain/care-types";

export type Tab = "time" | "inbox" | "recap" | "family";
export type MediaTheme = "sand" | "sage" | "rose";

export interface BabyProfile {
  name: string;
  birthDate: string;
  /** 可选：生长曲线与疫苗（HPV）需要。旧数据没有也能正常使用。 */
  sex?: "male" | "female";
  /** 可选：预产期，用于早产矫正月龄。 */
  dueDate?: string;
}

export interface DemoProfileRestorePoint {
  previousBaby: BabyProfile;
  demoBaby: BabyProfile;
}

export interface MediaAsset {
  id: string;
  kind: "image" | "video";
  name: string;
  mime: string;
  size: number;
  capturedAt: string;
  duration?: number;
  previewable?: boolean;
  demo?: boolean;
  theme: MediaTheme;
  /** 本次浏览器会话的对象 URL，不写入持久存储。 */
  url?: string;
  thumbnailUrl?: string;
}

export interface Candidate {
  id: string;
  mediaId: string;
  title: string;
  suggestion?: string;
  note: string;
  capturedAt: string;
  start?: number;
  end?: number;
  origin: "demo" | "upload";
  status: "pending" | "confirmed" | "dismissed";
}

export interface EntryDraft {
  title: string;
  note: string;
  capturedAt: string;
  tag: string;
  milestone: boolean;
  start?: number;
  end?: number;
  care?: CareObservation;
  activityId?: string;
}

export interface GrowthEntry extends EntryDraft {
  id: string;
  mediaId?: string;
  candidateId?: string;
  favorite: boolean;
  demo?: boolean;
}

export interface RecapDraft {
  title: string;
  entryIds: string[];
  dateFrom: string;
  dateTo: string;
}

export interface Recap extends RecapDraft {
  id: string;
  createdAt: string;
}

export interface Workspace {
  schemaVersion: 1;
  baby: BabyProfile;
  demoProfileRestorePoint?: DemoProfileRestorePoint;
  media: MediaAsset[];
  candidates: Candidate[];
  entries: GrowthEntry[];
  recaps: Recap[];
}

export interface FamilyStats {
  media: number;
  entries: number;
  recaps: number;
  bytes: number;
}

export const ENTRY_TAGS = [
  "日常片刻",
  "亲子互动",
  "家庭合影",
  "成长瞬间",
  "喂奶",
  "睡眠",
  "换尿布",
  "日常备注",
  "体温",
  "用药",
];
