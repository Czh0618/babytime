import type { CareObservation } from "./domain/care-types";

export type Tab = "time" | "health" | "inbox" | "recap" | "family";
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

/** 多设备同步元信息（P4.2）：旧数据没有，读入时由 migrateSyncMeta 补齐。 */
export interface SyncMeta {
  /** 最后修改时间，ISO（UTC）。 */
  updatedAt?: string;
  /** 最后一次写入的设备，只用于排查，不参与冲突判断。 */
  deviceId?: string;
}

export type SyncKind = "entry" | "vaccination" | "recap" | "media" | "milestone";

/** 删除墓碑：单独存放，界面读取的列表里永远只有未删除的条目。 */
export interface Tombstone {
  kind: SyncKind;
  /** 条目 id；里程碑为 `guideId:index`。 */
  id: string;
  deletedAt: string;
  deviceId: string;
}

export interface MediaAsset extends SyncMeta {
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

export interface GrowthEntry extends EntryDraft, SyncMeta {
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

export interface Recap extends RecapDraft, SyncMeta {
  id: string;
  createdAt: string;
}

export interface VaccinationRecord extends SyncMeta {
  id: string;
  /** 程序内缩写；自费疫苗用 "custom"。 */
  code: string;
  /** 自费疫苗名称，程序内疫苗留空。 */
  name?: string;
  /** 第几剂。 */
  dose: number;
  /** 接种日期，YYYY-MM-DD。 */
  date: string;
  clinic?: string;
  lot?: string;
  createdAt: string;
  /** 语音批次去重用。 */
  inputId?: string;
}

export interface VaccinePlan {
  /** 乙肝特殊程序：母亲 HBsAg 阳性且出生体重 <2000g。 */
  specialProgram: boolean;
  /** 乙脑、甲肝二选一。 */
  choices: { je?: "JE-L" | "JE-I"; hepa?: "HepA-L" | "HepA-I" };
}

export interface Workspace {
  schemaVersion: 1;
  baby: BabyProfile;
  demoProfileRestorePoint?: DemoProfileRestorePoint;
  media: MediaAsset[];
  candidates: Candidate[];
  entries: GrowthEntry[];
  recaps: Recap[];
  /** 接种记录；旧备份没有这个字段，读取时补空数组。 */
  vaccinations?: VaccinationRecord[];
  vaccinePlan?: VaccinePlan;
  /** 里程碑打勾：键 `guideId:index` → 达成日期。 */
  milestones?: Record<string, string>;
  /** 同步用：宝宝资料与疫苗计划各自的最后修改时间，缺失表示迁移后未改过。 */
  babyUpdatedAt?: string;
  vaccinePlanUpdatedAt?: string;
  /** 同步用：已删除条目的墓碑。 */
  tombstones?: Tombstone[];
  /** 同步用：本机改过、还没推送的键（`entry:<id>`、`milestone:<key>`、`baby` 等）。 */
  syncDirty?: string[];
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
  "接种",
  "测量",
];
