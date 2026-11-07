import { computed, ref } from "vue";
import type {
  BabyProfile,
  Candidate,
  EntryDraft,
  GrowthEntry,
  MediaAsset,
  Recap,
  RecapDraft,
  Workspace,
} from "../types";
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
  readMedia,
  readWorkspace,
  removeMediaAndWorkspace,
  storeMedia,
  writeWorkspace,
  writeWorkspaceAndMedia,
  type StoredMedia,
} from "./storage";
import { inspectMedia, validateMediaFile, type PreparedMedia } from "./media";
import { isWorkspace } from "../domain/workspace-schema";
import { decodeBackup } from "./backup";
import { addVoiceEntries } from "../domain/care-records";
import type { VoiceDraft } from "../domain/care-types";
import type { AICaption } from "../domain/ai";

export function useWorkspace() {
  const workspace = ref<Workspace>(emptyWorkspace());
  const loading = ref(true);
  const storageError = ref("");
  const importing = ref(false);
  const importProgress = ref("");
  let writes = Promise.resolve();

  const pending = computed(() =>
    workspace.value.candidates.filter((item) => item.status === "pending"),
  );
  const hasDemo = computed(
    () =>
      workspace.value.media.some((item) => item.demo) ||
      workspace.value.entries.some((item) => item.demo),
  );
  const stats = computed(() => ({
    media: workspace.value.media.length,
    entries: workspace.value.entries.length,
    recaps: workspace.value.recaps.length,
    bytes: workspace.value.media.reduce((sum, media) => sum + media.size, 0),
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
      item.url = URL.createObjectURL(data.file);
      if (data.thumbnail) item.thumbnailUrl = URL.createObjectURL(data.thumbnail);
    }
    return missing;
  }

  async function load() {
    try {
      const saved = await readWorkspace();
      if (saved) {
        if (!isWorkspace(saved))
          throw new Error("本机数据格式暂不支持，原有内容未被修改。");
        workspace.value = saved;
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
    const { workspace: next, mediaFiles } = decodeBackup(await file.text());
    const action = writes
      .catch(() => {})
      .then(async () => {
        // ponytail: 旧工作区独有的原片留在 IndexedDB 不清理，需要时再做孤儿原片回收。
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
        await writeWorkspaceAndMedia(next, mediaFiles);
        workspace.value = next;
      });
    writes = action;
    return action;
  }

  async function importFiles(files: File[]) {
    if (storageError.value) throw new Error(storageError.value);
    if (!files.length) return { count: 0, errors: [] as string[] };
    if (files.length > 10)
      throw new Error("每次最多导入 10 个素材，请分批选择。");
    importing.value = true;
    const errors: string[] = [];
    let count = 0;
    try {
      for (const [index, file] of files.entries()) {
        importProgress.value = `正在保存第 ${index + 1} / ${files.length} 个素材`;
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
          await update((next) => {
            next.media.push(asset!);
            next.candidates.push({
              id: createId(),
              mediaId: id,
              title: "一个想记住的瞬间",
              note: "",
              capturedAt,
              start: info.duration ? 0 : undefined,
              end: info.duration,
              origin: "upload",
              status: "pending",
            });
          });
          count++;
        } catch (error) {
          if (saved) await deleteMedia(id).catch(() => {});
          if (asset) releaseUrls([asset]);
          errors.push(
            `${file.name}：${error instanceof Error ? error.message : "导入失败，请重试。"}`,
          );
        }
      }
    } finally {
      importing.value = false;
      importProgress.value = "";
    }
    return { count, errors };
  }

  async function saveEntry(
    draft: EntryDraft,
    candidate?: Candidate,
    existing?: GrowthEntry,
    upload?: PreparedMedia,
  ) {
    if (upload) validateMediaFile(upload.file);
    const mediaFiles: StoredMedia[] = [];
    let asset: MediaAsset | undefined;
    try {
      await update((next) => {
        const entry = existing ? next.entries.find((item) => item.id === existing.id) : undefined;
        if (existing && !entry) throw new Error("这条记录已经被删除。");
        if (upload) {
          const previous = next.media.find((item) => item.id === entry?.mediaId);
          // 独占的缺失素材可以补回原 ID；共享素材换图时只修改当前记录。
          const reusable = previous && !previous.url && !previous.demo &&
            !next.entries.some((item) => item.id !== entry?.id && item.mediaId === previous.id) &&
            !next.candidates.some((item) => item.status === "pending" && item.mediaId === previous.id);
          asset = {
            id: reusable ? previous.id : createId(),
            kind: upload.kind,
            name: upload.file.name,
            mime: upload.file.type,
            size: upload.file.size,
            capturedAt: draft.capturedAt,
            duration: upload.duration,
            previewable: upload.previewable,
            theme: previous?.theme || "sand",
            url: URL.createObjectURL(upload.file),
            thumbnailUrl: upload.thumbnail ? URL.createObjectURL(upload.thumbnail) : undefined,
          };
          next.media = next.media.filter((item) => item.id !== asset!.id);
          next.media.push(asset);
          mediaFiles.push({ id: asset.id, file: upload.file, thumbnail: upload.thumbnail });
        }
        const mediaId = asset?.id ?? candidate?.mediaId ?? entry?.mediaId;
        const duration = next.media.find((media) => media.id === mediaId)?.duration;
        const error = validateEntry(draft, duration);
        if (error) throw new Error(error);
        if (entry) {
          Object.assign(entry, draft, { title: draft.title.trim() });
          if (asset) {
            entry.mediaId = asset.id;
            entry.demo = false;
          }
        } else if (candidate) {
          const current = next.candidates.find((item) => item.id === candidate.id);
          if (!current) throw new Error("这个候选已经被移除。");
          confirmCandidate(next, current, draft, createId());
        } else
          next.entries.push({
            ...draft,
            title: draft.title.trim(),
            id: createId(),
            favorite: false,
            mediaId: asset?.id,
          });
      }, mediaFiles);
    } catch (error) {
      if (asset) releaseUrls([asset]);
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

  async function deleteEntry(entry: GrowthEntry, withOriginal = false) {
    if (!withOriginal || !entry.mediaId)
      return update((next) => removeEntry(next, entry.id));
    const action = writes
      .catch(() => {})
      .then(async () => {
        const next: Workspace = JSON.parse(JSON.stringify(workspace.value));
        const mediaId = entry.mediaId!;
        const removed = next.media.filter((media) => media.id === mediaId);
        next.entries
          .filter((item) => item.mediaId === mediaId)
          .forEach((item) => removeEntry(next, item.id));
        next.media = next.media.filter((media) => media.id !== mediaId);
        next.candidates = next.candidates.filter(
          (item) => item.mediaId !== mediaId,
        );
        await removeMediaAndWorkspace(mediaId, next);
        workspace.value = next;
        releaseUrls(removed);
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

  async function saveProfile(baby: BabyProfile) {
    const today = localDateTime().slice(0, 10);
    if (!baby.name.trim() || !baby.birthDate || baby.birthDate > today)
      throw new Error("请填写宝宝昵称，以及不晚于今天的有效生日。");
    await update((next) => {
      delete next.demoProfileRestorePoint;
      next.baby = { ...baby, name: baby.name.trim() };
    });
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
    saveProfile,
    clearDemo,
    loadDemo,
    deleteRecap,
    reset,
    restore,
  };
}
