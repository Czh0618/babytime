import { computed, onBeforeUnmount, ref } from "vue";
import type {
  BabyProfile,
  Candidate,
  EntryDraft,
  GrowthEntry,
  MediaAsset,
  Recap,
  RecapDraft,
  Workspace,
  MediaSlotInput,
} from "../types";
import { MAX_ENTRY_MEDIA } from "../types";
import { localDateTime } from "../domain/date";
import { createId } from "../domain/id";
import { emptyWorkspace } from "../domain/seed";
import {
  addDemo,
  confirmCandidate,
  removeDemo,
  removeEntry,
  validateEntry,
  validateRecap,
} from "../domain/records";
import {
  clearAllData,
  deleteMedia,
  pruneOrphanMedia,
  readMedia,
  readWorkspace,
  removeMediaAndWorkspace,
  storeMedia,
  writeWorkspace,
  writeWorkspaceAndMedia,
  type StoredMedia,
} from "./storage";
import {
  peerChangeMessage,
  shouldRefreshFromPeer,
  WORKSPACE_CHANNEL,
} from "./peer-refresh";
import { inspectMedia, mediaKindOf, validateMediaFile, type PreparedMedia } from "./media";
import { isWorkspace, migrateMediaIds } from "../domain/workspace-schema";
import { validateProfile } from "../domain/profile";
import { defaultVaccinePlan } from "../domain/vaccines";
import type { VaccinationRecord, VaccinePlan } from "../types";
import { decodeBackup } from "./backup";
import { addVoiceEntries } from "../domain/care-records";
import type { VoiceDraft } from "../domain/care-types";
import type { AICaption } from "../domain/ai";
import { migrateSyncMeta, stampChanges } from "../domain/sync-meta";
import { activeProfileOf, migrateProfiles } from "../domain/profiles";
import { referencedMediaIds } from "../domain/media-refs";
import { runSync, type SyncOutcome } from "../domain/sync";
import {
  clearMediaProgress,
  readMediaProgress,
  syncMedia,
  writeMediaProgress,
} from "./media-sync";
import {
  clearSyncConfig,
  createTransport,
  readSince,
  readSyncConfig,
  resetSince,
  syncUnavailableReason,
  syncState,
  writeSince,
} from "./sync-service";

let cachedDeviceId: string | undefined;
/** 本机设备标识，存 localStorage；隐私模式写不进时本次会话内保持不变。 */
function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    cachedDeviceId = localStorage.getItem("babytime.deviceId") ?? undefined;
    if (!cachedDeviceId) {
      cachedDeviceId = createId();
      localStorage.setItem("babytime.deviceId", cachedDeviceId);
    }
  } catch {
    cachedDeviceId ??= createId();
  }
  return cachedDeviceId;
}

/** 新记录一律归到当前宝宝；旧数据在 migrateProfiles 里已经补齐。 */
function tagActiveBaby(target: Workspace) {
  if (!Array.isArray(target.vaccinations)) target.vaccinations = [];
  const id = target.activeProfileId;
  for (const key of ["media", "candidates", "entries", "recaps", "vaccinations"] as const)
    for (const item of target[key] ?? [])
      if (!item.babyId) item.babyId = id;
}

export function useWorkspace() {
  const workspace = ref<Workspace>(emptyWorkspace());
  const loading = ref(true);
  const storageError = ref("");
  const importing = ref(false);
  const importProgress = ref("");
  let writes = Promise.resolve();
  const peerId = createId();
  let peerChannel: BroadcastChannel | undefined;
  let peerRefresh = Promise.resolve();

  /** 每次写入成功后通知同浏览器其它标签页；收到通知的一方只读内存，不再广播。 */
  function notifyPeers() {
    try {
      peerChannel?.postMessage(peerChangeMessage(peerId));
    } catch {
      // 通道已关闭或隐私模式禁用，忽略：本机数据不受影响。
    }
  }

  /** 回收失败不影响主流程，也不打断备份恢复与同步。 */
  async function collectOrphanMedia(next: Workspace, extraIds: string[] = []) {
    try {
      await pruneOrphanMedia(referencedMediaIds(next, extraIds));
    } catch {
      // 清理只是节省本机空间，留到下次触发再试。
    }
  }

  async function refreshFromPeer() {
    await writes.catch(() => {});
    try {
      const saved = await readWorkspace();
      if (!saved || !isWorkspace(saved)) return;
      const next = migrateMediaIds(migrateProfiles(saved, createId));
      migrateSyncMeta(next, deviceId());
      // 当前宝宝是本机偏好，不跟着其它标签页的切换跑。
      if (next.profiles.some((item) => item.id === workspace.value.activeProfileId))
        next.activeProfileId = workspace.value.activeProfileId;
      await attachMedia(next);
      const oldMedia = workspace.value.media;
      workspace.value = next;
      releaseUrls(oldMedia);
      storageError.value = "";
    } catch {
      // 读失败时保留当前内存，等下一次写入广播再刷新。
    }
  }

  function listenPeers() {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      peerChannel = new BroadcastChannel(WORKSPACE_CHANNEL);
      peerChannel.onmessage = (event: MessageEvent) => {
        if (!shouldRefreshFromPeer(event.data, peerId)) return;
        peerRefresh = peerRefresh.then(refreshFromPeer, refreshFromPeer);
      };
    } catch {
      peerChannel = undefined;
    }
  }
  listenPeers();
  onBeforeUnmount(() => {
    peerChannel?.close();
    peerChannel = undefined;
  });

  const profiles = computed(() => workspace.value.profiles);
  const activeProfile = computed(() => activeProfileOf(workspace.value));
  const activeId = computed(() => activeProfile.value.id);
  /** 只显示当前宝宝的条目；迁移前的旧条目没有 babyId，视为唯一宝宝的。 */
  function forActive<T extends { babyId?: string }>(items: T[]): T[] {
    return items.filter((item) => !item.babyId || item.babyId === activeId.value);
  }
  const entries = computed(() => forActive(workspace.value.entries));
  const media = computed(() => forActive(workspace.value.media));
  const recaps = computed(() => forActive(workspace.value.recaps));
  const vaccinations = computed(() => forActive(workspace.value.vaccinations ?? []));
  const milestones = computed(() => activeProfile.value.milestones ?? {});
  const vaccinePlan = computed(() => activeProfile.value.vaccinePlan ?? defaultVaccinePlan());

  const pending = computed(() =>
    forActive(workspace.value.candidates).filter((item) => item.status === "pending"),
  );
  const hasDemo = computed(
    () =>
      media.value.some((item) => item.demo) ||
      entries.value.some((item) => item.demo),
  );
  const stats = computed(() => ({
    media: media.value.length,
    entries: entries.value.length,
    recaps: recaps.value.length,
    bytes: media.value.reduce((sum, item) => sum + item.size, 0),
  }));

  function releaseUrls(media: MediaAsset[]) {
    media.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
    });
  }

  async function attachMedia(target: Workspace, mediaFiles: StoredMedia[] = []) {
    const restored = new Map(mediaFiles.map((item) => [item.id, item]));
    let missing = 0;
    for (const item of target.media) {
      if (item.demo) continue;
      const data = restored.get(item.id) ?? await readMedia(item.id);
      if (!data) {
        missing++;
        continue;
      }
      if (data.remoteOnly) {
        // P7.2：原片还在服务器上，本机只存了缩略图，不能把 file 当原图显示。
        item.url = undefined;
        item.thumbnailUrl = URL.createObjectURL(data.thumbnail ?? data.file);
      } else {
        item.url = URL.createObjectURL(data.file);
        if (data.thumbnail) item.thumbnailUrl = URL.createObjectURL(data.thumbnail);
      }
    }
    return missing;
  }

  /** P7.2：从服务器拉到缩略图 / 原片后，只刷新这几条的预览地址，不动记录本身。 */
  async function refreshAttachedMedia(ids: string[]) {
    const wanted = new Set(ids);
    for (const item of workspace.value.media) {
      if (!wanted.has(item.id) || item.demo) continue;
      const data = await readMedia(item.id);
      if (!data) continue;
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
      if (data.remoteOnly) {
        item.url = undefined;
        item.thumbnailUrl = URL.createObjectURL(data.thumbnail ?? data.file);
      } else {
        item.url = URL.createObjectURL(data.file);
        item.thumbnailUrl = data.thumbnail
          ? URL.createObjectURL(data.thumbnail)
          : undefined;
      }
    }
  }

  async function load() {
    try {
      const saved = await readWorkspace();
      if (saved) {
        if (!isWorkspace(saved))
          throw new Error("本机数据格式暂不支持，原有内容未被修改。");
        workspace.value = migrateMediaIds(migrateProfiles(saved, createId));
        migrateSyncMeta(workspace.value, deviceId());
      } else await writeWorkspace(workspace.value); // 首次进入为空白工作区，示例由用户主动加载
      await attachMedia(workspace.value);
    } catch (error) {
      storageError.value =
        error instanceof Error
          ? error.message
          : "无法读取本机记录，请检查浏览器是否允许存储。";
    } finally {
      loading.value = false;
    }
  }

  /** 用备份覆盖当前工作区；返回原片不在本机的素材数量。 */
  async function restore(file: File) {
    const { workspace: decoded, mediaFiles } = decodeBackup(await file.text());
    const next = migrateMediaIds(migrateProfiles(decoded, createId));
    migrateSyncMeta(next, deviceId());
    const action = writes
      .catch(() => {})
      .then(async () => {
        // 旧工作区独有的原片在覆盖成功后回收；备份刚写入的原片不在白名单丢失。
        const oldMedia = workspace.value.media;
        let missing: number;
        try {
          missing = await attachMedia(next, mediaFiles);
          await writeWorkspaceAndMedia(next, mediaFiles);
        } catch (error) {
          releaseUrls(next.media);
          throw error;
        }
        workspace.value = next;
        releaseUrls(oldMedia);
        storageError.value = "";
        resetSince();
        notifyPeers();
        await collectOrphanMedia(
          next,
          mediaFiles.map((item) => item.id),
        );
        return missing;
      });
    // 队列只负责等待；恢复错误由返回的 action 交给界面处理。
    writes = action.then(() => {}, () => {});
    return action;
  }

  function update(change: (next: Workspace) => void, mediaFiles: StoredMedia[] = []) {
    const action = writes
      .catch(() => {})
      .then(async () => {
        if (storageError.value) throw new Error(storageError.value);
        const next: Workspace = JSON.parse(JSON.stringify(workspace.value));
        change(next);
        tagActiveBaby(next);
        stampChanges(workspace.value, next, deviceId());
        await writeWorkspaceAndMedia(next, mediaFiles);
        workspace.value = next;
        notifyPeers();
        scheduleSync();
      });
    writes = action;
    return action;
  }

  /** P7.1：一次导入里的一个素材，先落原片，再按类型合成候选。 */
  interface ImportedAsset {
    asset: MediaAsset;
    stored: StoredMedia;
    duration?: number;
  }
  const MAX_IMPORT_FILES = 20;

  async function importFiles(files: File[]) {
    if (storageError.value) throw new Error(storageError.value);
    if (!files.length) return { count: 0, errors: [] as string[], warnings: [] as string[] };
    if (files.length > MAX_IMPORT_FILES)
      throw new Error(`每次最多导入 ${MAX_IMPORT_FILES} 个文件，请分批选择。`);
    importing.value = true;
    const errors: string[] = [];
    const warnings: string[] = [];
    const photos: ImportedAsset[] = [];
    const videos: ImportedAsset[] = [];
    let skippedPhotos = 0;
    let count = 0;
    try {
      for (const [index, file] of files.entries()) {
        importProgress.value = `正在保存第 ${index + 1} / ${files.length} 个素材`;
        // 照片合成一条候选，超过上限的只提示并跳过；视频各自成条。
        if (mediaKindOf(file) === "image" && photos.length >= MAX_ENTRY_MEDIA) {
          skippedPhotos++;
          continue;
        }
        const id = createId();
        let saved = false;
        let asset: MediaAsset | undefined;
        try {
          validateMediaFile(file);
          const info = await inspectMedia(file);
          const date = file.lastModified
            ? new Date(file.lastModified)
            : new Date();
          const capturedAt = localDateTime(date);
          asset = {
            id,
            kind: info.kind,
            name: file.name,
            mime: file.type,
            size: file.size,
            capturedAt,
            duration: info.duration,
            previewable: info.previewable,
            theme: "sand",
            url: URL.createObjectURL(file),
          };
          if (info.thumbnail)
            asset.thumbnailUrl = URL.createObjectURL(info.thumbnail);
          await storeMedia(id, file, info.thumbnail);
          saved = true;
          const item: ImportedAsset = {
            asset,
            stored: { id, file, thumbnail: info.thumbnail },
            duration: info.duration,
          };
          (info.kind === "image" ? photos : videos).push(item);
        } catch (error) {
          if (saved) await deleteMedia(id).catch(() => {});
          if (asset) releaseUrls([asset]);
          errors.push(
            `${file.name}：${error instanceof Error ? error.message : "导入失败，请重试。"}`,
          );
        }
      }
      if (skippedPhotos)
        warnings.push(
          `一条记录最多 ${MAX_ENTRY_MEDIA} 张照片，已跳过超出的 ${skippedPhotos} 张；可以再导入一次。`,
        );

      const groups: ImportedAsset[][] = [
        ...(photos.length ? [photos] : []),
        ...videos.map((item) => [item]),
      ];
      for (const group of groups) {
        try {
          await update((next) => {
            for (const item of group) next.media.push(item.asset);
            next.candidates.push({
              id: createId(),
              mediaIds: group.map((item) => item.asset.id),
              title:
                group.length > 1 ? `${group.length} 张照片` : "一个想记住的瞬间",
              note: "",
              capturedAt: group[0]!.asset.capturedAt,
              start: group[0]!.duration ? 0 : undefined,
              end: group[0]!.duration,
              origin: "upload",
              status: "pending",
            });
          }, group.map((item) => item.stored));
          count++;
        } catch (error) {
          await Promise.all(
            group.map((item) => deleteMedia(item.asset.id).catch(() => {})),
          );
          releaseUrls(group.map((item) => item.asset));
          errors.push(
            `整理这批素材时出错：${error instanceof Error ? error.message : "请重试。"}`,
          );
        }
      }
    } finally {
      importing.value = false;
      importProgress.value = "";
    }
    return { count, errors, warnings };
  }

  /** 这个素材是否还被「当前这条以外」的记录或候选引用。 */
  function referencedElsewhere(
    next: Workspace,
    id: string,
    entryId?: string,
    candidateId?: string,
    pendingOnly = false,
  ): boolean {
    return (
      next.entries.some(
        (item) => item.id !== entryId && (item.mediaIds ?? []).includes(id),
      ) ||
      next.candidates.some(
        (item) =>
          item.id !== candidateId &&
          (!pendingOnly || item.status === "pending") &&
          (item.mediaIds ?? []).includes(id),
      )
    );
  }

  /**
   * 只有待整理候选和其它记录算「还在用」；已确认 / 已忽略的候选界面上看不到，
   * 但它们仍留在 candidates 里，这里顺手清掉失效引用，孤儿回收才不会误留原片。
   */
  function dropUnusedMedia(
    next: Workspace,
    ids: string[],
    entryId?: string,
    candidateId?: string,
  ): string[] {
    const blockers = ids.filter((id) =>
      referencedElsewhere(next, id, entryId, candidateId, true),
    );
    const drop = ids.filter((id) => !blockers.includes(id));
    for (const item of next.candidates)
      if (item.status !== "pending")
        item.mediaIds = item.mediaIds.filter((id) => !drop.includes(id));
    next.media = next.media.filter((item) => !drop.includes(item.id));
    return drop;
  }

  /**
   * P7.1：slots 是编辑弹窗给出的最终顺序，每格可以保留旧素材、补回/换图或新增。
   * 不传 slots（例如「醒来」补记）表示不动素材。
   */
  async function saveEntry(
    draft: EntryDraft,
    candidate?: Candidate,
    existing?: GrowthEntry,
    slots?: MediaSlotInput[],
  ) {
    if (slots)
      for (const slot of slots)
        if (slot.upload) validateMediaFile(slot.upload.file);
    const mediaFiles: StoredMedia[] = [];
    const createdAssets: MediaAsset[] = [];
    let removedIds: string[] = [];
    try {
      await update((next) => {
        const entry = existing ? next.entries.find((item) => item.id === existing.id) : undefined;
        if (existing && !entry) throw new Error("这条记录已经被删除。");
        const previousIds = entry?.mediaIds ?? candidate?.mediaIds ?? [];
        let finalIds: string[] | undefined;
        if (slots) {
          if (slots.length > MAX_ENTRY_MEDIA)
            throw new Error(`一条记录最多 ${MAX_ENTRY_MEDIA} 张照片。`);
          finalIds = [];
          for (const slot of slots) {
            if (!slot.upload) {
              if (slot.mediaId) finalIds.push(slot.mediaId);
              continue;
            }
            const upload: PreparedMedia = slot.upload;
            const previous = slot.mediaId
              ? next.media.find((item) => item.id === slot.mediaId)
              : undefined;
            // 独占的缺失素材可以补回原 ID；共享素材换图时只修改当前记录。
            const reusable =
              previous &&
              !previous.url &&
              !previous.demo &&
              !referencedElsewhere(next, previous.id, entry?.id, candidate?.id, true);
            const id = reusable ? previous.id : createId();
            const asset: MediaAsset = {
              id,
              kind: upload.kind,
              name: upload.file.name,
              mime: upload.file.type,
              size: upload.file.size,
              capturedAt: draft.capturedAt,
              duration: upload.duration,
              previewable: upload.previewable,
              theme: previous?.theme || "sand",
              url: URL.createObjectURL(upload.file),
              thumbnailUrl: upload.thumbnail
                ? URL.createObjectURL(upload.thumbnail)
                : undefined,
            };
            next.media = next.media.filter((item) => item.id !== id);
            next.media.push(asset);
            mediaFiles.push({ id, file: upload.file, thumbnail: upload.thumbnail });
            createdAssets.push(asset);
            finalIds.push(id);
          }
          const resolved = [...new Set(finalIds)].slice(0, MAX_ENTRY_MEDIA);
          finalIds = resolved;
          // 视频仍是一条记录一个素材，start/end 只对那一个视频有意义。
          const hasVideo = resolved.some(
            (id) => next.media.find((item) => item.id === id)?.kind === "video",
          );
          if (hasVideo && resolved.length !== 1)
            throw new Error("含视频的记录只能保留一个素材，请先移除其它照片。");
          removedIds = previousIds.filter((id) => !resolved.includes(id));
        }
        const ids = finalIds ?? (entry?.mediaIds ?? candidate?.mediaIds ?? []);
        const duration =
          ids.length === 1
            ? next.media.find((media) => media.id === ids[0])?.duration
            : undefined;
        const error = validateEntry(draft, duration);
        if (error) throw new Error(error);
        if (entry) {
          Object.assign(entry, draft, { title: draft.title.trim() });
          if (finalIds) {
            entry.mediaIds = finalIds;
            if (createdAssets.length) entry.demo = false;
          }
        } else if (candidate) {
          const current = next.candidates.find((item) => item.id === candidate.id);
          if (!current) throw new Error("这个候选已经被移除。");
          if (finalIds) current.mediaIds = finalIds;
          confirmCandidate(next, current, draft, createId());
        } else
          next.entries.push({
            ...draft,
            title: draft.title.trim(),
            id: createId(),
            favorite: false,
            mediaIds: finalIds ?? [],
          });
        // 只有不再被任何其它记录引用的素材才从工作区移除，原片随后由 GC 回收。
        if (removedIds.length)
          dropUnusedMedia(next, removedIds, entry?.id, candidate?.id);
      }, mediaFiles);
      if (removedIds.length) await collectOrphanMedia(workspace.value);
    } catch (error) {
      releaseUrls(createdAssets);
      throw error;
    }
  }

  async function toggleFavorite(id: string) {
    await update((next) => {
      const item = next.entries.find((entry) => entry.id === id);
      if (item) item.favorite = !item.favorite;
    });
  }

  /** 一键快记：直接落一条只含确定事实的记录，返回 id 供界面撤销。 */
  async function addQuickEntry(draft: EntryDraft): Promise<string> {
    const id = createId();
    await update((next) => {
      const error = validateEntry(draft);
      if (error) throw new Error(error);
      next.entries.push({
        ...draft,
        title: draft.title.trim(),
        id,
        favorite: false,
      });
    });
    return id;
  }

  async function saveVoiceEntries(drafts: VoiceDraft[], batchId: string) {
    let count = 0;
    await update((next) => {
      count = addVoiceEntries(next, drafts, batchId);
    });
    return count;
  }

  async function dismiss(id: string) {
    await update((next) => {
      const item = next.candidates.find((entry) => entry.id === id);
      if (item) item.status = "dismissed";
    });
  }

  /** AI 建议只写入待确认候选；已确认的成长记录永远不会被重新分析覆盖。 */
  async function applyCandidateSuggestion(id: string, caption: AICaption) {
    await update((next) => {
      const candidate = next.candidates.find(
        (item) => item.id === id && item.status === "pending",
      );
      if (!candidate) throw new Error("这个候选已经被整理过，请刷新后再试。");
      candidate.title = caption.title;
      candidate.suggestion = caption.suggestion;
      candidate.note = caption.note;
    });
  }

  /** P7.1：勾选删除原片时，只删这条记录独有、没有别人引用的素材；视频与照片一视同仁。 */
  async function deleteEntry(entry: GrowthEntry, withOriginal = false) {
    const ids = entry.mediaIds ?? [];
    if (!withOriginal || !ids.length)
      return update((next) => removeEntry(next, entry.id));
    const action = writes
      .catch(() => {})
      .then(async () => {
        const next: Workspace = JSON.parse(JSON.stringify(workspace.value));
        const beforeMedia = next.media;
        const drop = dropUnusedMedia(next, ids, entry.id);
        const removed = beforeMedia.filter((media) => drop.includes(media.id));
        removeEntry(next, entry.id);
        stampChanges(workspace.value, next, deviceId());
        if (drop.length) await removeMediaAndWorkspace(drop, next);
        else await writeWorkspace(next);
        workspace.value = next;
        releaseUrls(removed);
        notifyPeers();
        scheduleSync();
      });
    writes = action;
    return action;
  }

  async function createRecap(draft: RecapDraft): Promise<Recap> {
    const recap: Recap = {
      ...draft,
      title: draft.title.trim(),
      id: createId(),
      createdAt: new Date().toISOString(),
    };
    await update((next) => {
      const error = validateRecap(draft, next.entries);
      if (error) throw new Error(error);
      next.recaps.unshift(recap);
    });
    return recap;
  }

  async function addVaccination(
    record: Omit<VaccinationRecord, "id" | "createdAt">,
  ): Promise<string> {
    const id = createId();
    await update((next) => {
      const list = next.vaccinations!;
      if (
        record.code !== "custom" &&
        list.some(
          (item) =>
            item.babyId === next.activeProfileId &&
            item.code === record.code &&
            item.dose === record.dose,
        )
      )
        throw new Error("这一剂已经记过了。");
      list.push({ ...record, id, createdAt: new Date().toISOString() });
    });
    return id;
  }

  async function removeVaccination(id: string) {
    await update((next) => {
      next.vaccinations = next.vaccinations!.filter((item) => item.id !== id);
    });
  }

  async function saveVaccinePlan(plan: VaccinePlan) {
    await update((next) => {
      const profile = next.profiles.find((item) => item.id === next.activeProfileId);
      if (!profile) throw new Error("当前宝宝档案不在了，请刷新后再试。");
      profile.vaccinePlan = {
        specialProgram: Boolean(plan.specialProgram),
        choices: { ...plan.choices },
      };
    });
  }

  async function saveMilestones(milestones: Record<string, string>) {
    await update((next) => {
      const profile = next.profiles.find((item) => item.id === next.activeProfileId);
      if (!profile) throw new Error("当前宝宝档案不在了，请刷新后再试。");
      profile.milestones = { ...milestones };
    });
  }

  function cleanProfile(baby: BabyProfile): BabyProfile {
    return {
      ...baby,
      name: baby.name.trim(),
      ...(baby.sex ? { sex: baby.sex } : {}),
      ...(baby.dueDate ? { dueDate: baby.dueDate } : {}),
    };
  }

  async function saveProfile(baby: BabyProfile) {
    const error = validateProfile(baby);
    if (error) throw new Error(error);
    const saved = cleanProfile(baby);
    if (!saved.sex) delete saved.sex;
    if (!saved.dueDate) delete saved.dueDate;
    await update((next) => {
      delete next.demoProfileRestorePoint;
      const index = next.profiles.findIndex((item) => item.id === next.activeProfileId);
      if (index < 0) throw new Error("当前宝宝档案不在了，请刷新后再试。");
      next.profiles[index] = {
        ...next.profiles[index]!,
        ...saved,
        id: next.profiles[index]!.id,
      };
    });
  }

  /** 新宝宝从空白开始；保存后自动切过去。 */
  async function addProfile(baby: BabyProfile): Promise<string> {
    const error = validateProfile(baby);
    if (error) throw new Error(error);
    const id = createId();
    const saved = cleanProfile(baby);
    await update((next) => {
      next.profiles.push({
        ...saved,
        id,
        vaccinePlan: defaultVaccinePlan(),
        milestones: {},
      });
      next.activeProfileId = id;
    });
    return id;
  }

  /** 切换只看本机，不进同步。 */
  async function switchProfile(id: string) {
    if (!workspace.value.profiles.some((profile) => profile.id === id)) return;
    await update((next) => {
      next.activeProfileId = id;
    });
  }

  /** 删除宝宝：它的记录一并移出本机并写墓碑，家人设备同步后同样看不到。 */
  async function deleteProfile(id: string) {
    await update((next) => {
      if (next.profiles.length <= 1) throw new Error("至少要保留一个宝宝档案。");
      next.profiles = next.profiles.filter((profile) => profile.id !== id);
      if (next.activeProfileId === id)
        next.activeProfileId = next.profiles[0]!.id ?? next.activeProfileId;
      const gone = (item: { babyId?: string }) => item.babyId !== id;
      next.entries = next.entries.filter(gone);
      next.recaps = next.recaps.filter(gone);
      next.media = next.media.filter(gone);
      next.candidates = next.candidates.filter(gone);
      next.vaccinations = (next.vaccinations ?? []).filter(gone);
    });
    await collectOrphanMedia(workspace.value);
  }

  async function loadDemo() {
    await update(addDemo);
  }

  async function clearDemo() {
    await update(removeDemo);
  }
  async function deleteRecap(id: string) {
    await update((next) => {
      next.recaps = next.recaps.filter((recap) => recap.id !== id);
    });
  }

  async function reset() {
    await writes.catch(() => {});
    const oldMedia = workspace.value.media;
    await clearAllData();
    const empty = emptyWorkspace();
    await writeWorkspace(empty);
    workspace.value = empty;
    releaseUrls(oldMedia);
    storageError.value = "";
    notifyPeers();
    // 清空本机也清掉家庭密钥，否则下次同步会把服务器上的记录全部拉回来。
    clearSyncConfig();
    clearMediaProgress();
  }

  /** 把同步结果写回本机：走同一个写入队列，但不盖章，否则合并会被当成新修改推回去。 */
  function mergeRemote(change: (next: Workspace) => void) {
    const action = writes
      .catch(() => {})
      .then(async () => {
        const beforeMedia = workspace.value.media.length;
        const next: Workspace = JSON.parse(JSON.stringify(workspace.value));
        change(next);
        await writeWorkspace(next);
        workspace.value = next;
        notifyPeers();
        // 远端同步删掉了素材元信息时，把本机留着的原片一起回收。
        if (next.media.length < beforeMedia) await collectOrphanMedia(next);
      });
    writes = action;
    return action;
  }

  let syncing: Promise<SyncOutcome | null> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;

  /** 一轮同步。未开启、非 https、离线或本机存储出错时直接返回 null；失败只记在 syncState，不影响本机使用。 */
  function syncNow(): Promise<SyncOutcome | null> {
    clearTimeout(syncTimer);
    const config = readSyncConfig();
    if (!config?.enabled || syncUnavailableReason() || storageError.value || loading.value)
      return Promise.resolve(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      return Promise.resolve(null);
    syncing ??= (async () => {
      syncState.value.running = true;
      try {
        const outcome = await runSync({
          since: readSince(),
          deviceId: deviceId(),
          transport: createTransport(config.key),
          read: () => workspace.value,
          merge: mergeRemote,
        });
        writeSince(outcome.now);
        syncState.value.lastAt = new Date().toISOString();
        syncState.value.error = "";
        // P7.2：结构化同步成功后才传照片；服务器尚未升级或离线时不影响记录同步。
        try {
          const media = await syncMedia(workspace.value, config.key);
          if (media.downloaded.length)
            await refreshAttachedMedia(media.downloaded);
        } catch {
          writeMediaProgress({
            ...readMediaProgress(),
            error: "服务器还没有开启照片同步，记录同步不受影响。",
          });
        }
        return outcome;
      } catch (error) {
        syncState.value.error = error instanceof Error ? error.message : "同步失败，稍后会自动重试。";
        throw error;
      } finally {
        syncState.value.running = false;
        syncing = null;
      }
    })();
    return syncing;
  }

  /** 本机写入后稍等片刻再推送，连续操作合并成一轮。 */
  function scheduleSync(delay = 3000) {
    if (!readSyncConfig()?.enabled) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncNow().catch(() => {}), delay);
  }

  return {
    workspace,
    loading,
    storageError,
    importing,
    importProgress,
    pending,
    hasDemo,
    stats,
    load,
    importFiles,
    saveEntry,
    addQuickEntry,
    saveVoiceEntries,
    toggleFavorite,
    dismiss,
    applyCandidateSuggestion,
    deleteEntry,
    createRecap,
    addVaccination,
    removeVaccination,
    saveVaccinePlan,
    saveMilestones,
    saveProfile,
    clearDemo,
    loadDemo,
    refreshAttachedMedia,
    deleteRecap,
    reset,
    restore,
    syncNow,
    profiles,
    activeProfile,
    entries,
    media,
    recaps,
    vaccinations,
    milestones,
    vaccinePlan,
    addProfile,
    switchProfile,
    deleteProfile,
  };
}
