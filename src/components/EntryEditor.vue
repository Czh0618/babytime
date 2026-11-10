<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from "vue";
import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Save,
  Trash2,
} from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";
import MediaTile from "./MediaTile.vue";
import { localDateTime } from "../domain/date";
import { validateEntry } from "../domain/records";
import {
  CARE_LABELS,
  FEEDING_METHOD_LABELS,
  SITE_LABELS,
  careFromTag,
  type CareKind,
  type FeedingMethod,
} from "../domain/care-types";
import { VACCINES_2026 } from "../data/vaccines-2026";
import { mediaKindOf, prepareMediaFile, type PreparedMedia } from "../lib/media";
import { clipAction } from "../domain/clip";
import {
  ENTRY_TAGS,
  MAX_ENTRY_MEDIA,
  type Candidate,
  type EntryDraft,
  type GrowthEntry,
  type MediaAsset,
  type MediaSlotInput,
} from "../types";

const props = defineProps<{
  candidate?: Candidate;
  entry?: GrowthEntry;
  /** P7.1：按 mediaIds 顺序传入，第一张是封面。 */
  media?: MediaAsset[];
  busy: boolean;
  saveError?: string;
  initialDraft?: EntryDraft;
}>();
const emit = defineEmits<{
  close: [];
  save: [draft: EntryDraft, slots: MediaSlotInput[]];
}>();
const source = props.entry || props.candidate || props.initialDraft;
const draft = reactive<EntryDraft>({
  title: source?.title || "",
  note: source?.note || "",
  capturedAt: source?.capturedAt || localDateTime(),
  tag: props.entry?.tag || props.initialDraft?.tag || "日常片刻",
  milestone: props.entry?.milestone || false,
  start: source?.start,
  end: source?.end,
  care: props.entry?.care
    ? { ...props.entry.care }
    : props.initialDraft?.care
      ? { ...props.initialDraft.care }
      : undefined,
  activityId: props.entry?.activityId || props.initialDraft?.activityId,
});
const error = ref("");
/** 手动新建的记录没有照护原话，照护字段由「放进哪一类」驱动。 */
const tagDrivesCare = ref(!props.entry?.care && !props.initialDraft?.care);
const video = ref<HTMLVideoElement>();
const addInput = ref<HTMLInputElement>();
const replaceInput = ref<HTMLInputElement>();
const preparing = ref(false);
const blocked = computed(() => props.busy || preparing.value);

/** 弹窗里的一格素材：已有 id、本机新选文件，或两者都有（补回 / 换图）。 */
interface Slot {
  key: string;
  mediaId?: string;
  asset?: MediaAsset;
  upload?: PreparedMedia;
  preview?: MediaAsset;
}
let selection = 0;
let disposed = false;
const slots = ref<Slot[]>(
  (props.media ?? []).map((asset, index) => ({
    key: `slot-${index}-${asset.id}`,
    mediaId: asset.id,
    asset,
  })),
);
const replaceTarget = shallowRef<Slot>();
const previousClip = { start: draft.start, end: draft.end };

const slotKind = (slot: Slot) => (slot.preview ?? slot.asset)?.kind;
const videoSlot = computed(() =>
  slots.value.find((slot) => slotKind(slot) === "video"),
);
const currentVideo = computed(() =>
  videoSlot.value ? videoSlot.value.preview ?? videoSlot.value.asset : undefined,
);
const hasVideo = computed(
  () =>
    Boolean(currentVideo.value?.url) && Boolean(currentVideo.value?.previewable),
);
const canAddPhotos = computed(
  () => !videoSlot.value && slots.value.length < MAX_ENTRY_MEDIA,
);
const hasUpload = computed(() => slots.value.some((slot) => slot.upload));
const missingCount = computed(
  () =>
    slots.value.filter(
      (slot) =>
        !slot.upload &&
        slot.asset &&
        !slot.asset.demo &&
        // 只有缩略图也算可见：原片在服务器上，点开大图会按需取回，
        // 不能把家人设备上的每张照片都提示成「原片不在本机」。
        !slot.asset.url &&
        !slot.asset.thumbnailUrl,
    ).length,
);
const uploadLabel = computed(() =>
  missingCount.value
    ? "补回照片"
    : slots.value.length
      ? "继续加照片"
      : "添加照片或视频",
);

function releaseSlot(slot: Slot) {
  if (slot.preview?.url) URL.revokeObjectURL(slot.preview.url);
  if (slot.preview?.thumbnailUrl)
    URL.revokeObjectURL(slot.preview.thumbnailUrl);
}

function makePreview(file: File, prepared: PreparedMedia): MediaAsset {
  const asset: MediaAsset = {
    id: `editor-upload-${++selection}`,
    name: file.name,
    kind: prepared.kind,
    mime: file.type,
    size: file.size,
    capturedAt: draft.capturedAt,
    duration: prepared.duration,
    previewable: prepared.previewable,
    theme: props.media?.[0]?.theme || "sand",
    url: URL.createObjectURL(file),
  };
  if (prepared.thumbnail)
    asset.thumbnailUrl = URL.createObjectURL(prepared.thumbnail);
  return asset;
}

/** 片段起止只对单个视频有意义；没有视频时清掉，避免多图记录带着旧片段值。 */
function syncClip() {
  const target = videoSlot.value;
  if (!target) {
    const unchanged = !slots.value.some((slot) => slot.upload);
    draft.start = unchanged ? previousClip.start : undefined;
    draft.end = unchanged ? previousClip.end : undefined;
    return;
  }
  if (target.upload?.kind === "video") {
    draft.start = target.upload.duration ? 0 : undefined;
    draft.end = target.upload.duration || undefined;
  }
}

async function addMedia(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length || blocked.value) return;
  preparing.value = true;
  error.value = "";
  try {
    // 视频仍是一条记录一个素材；混选或已有照片时提示单独导入。
    if (files.some((file) => mediaKindOf(file) === "video")) {
      if (slots.value.length || files.length > 1) {
        error.value = "含视频的记录只能保留一个素材，请先移除其它照片，或单独选择视频。";
        return;
      }
    }
    const remaining = MAX_ENTRY_MEDIA - slots.value.length;
    const picked: Slot[] = [];
    let truncated = false;
    for (const file of files) {
      if (picked.length >= remaining) {
        truncated = true;
        break;
      }
      const prepared = await prepareMediaFile(file);
      if (disposed) return;
      picked.push({
        key: `new-${++selection}`,
        upload: prepared,
        preview: makePreview(file, prepared),
      });
    }
    slots.value = [...slots.value, ...picked];
    syncClip();
    if (truncated)
      error.value = `一条记录最多 ${MAX_ENTRY_MEDIA} 张照片，超出的没有加入。`;
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : "素材暂时无法读取，请重新选择。";
  } finally {
    preparing.value = false;
  }
}

function pickReplace(slot: Slot) {
  if (blocked.value) return;
  replaceTarget.value = slot;
  replaceInput.value?.click();
}

async function replaceSlot(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const slot = replaceTarget.value;
  input.value = "";
  replaceTarget.value = undefined;
  if (!file || !slot || blocked.value) return;
  preparing.value = true;
  error.value = "";
  let preview: MediaAsset | undefined;
  try {
    const prepared = await prepareMediaFile(file);
    if (disposed) return;
    if (prepared.kind === "video" && slots.value.length > 1) {
      error.value = "含视频的记录只能保留一个素材，请先移除其它照片。";
      return;
    }
    preview = makePreview(file, prepared);
    releaseSlot(slot);
    slot.upload = prepared;
    slot.preview = preview;
    syncClip();
  } catch (cause) {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    if (preview?.thumbnailUrl) URL.revokeObjectURL(preview.thumbnailUrl);
    error.value =
      cause instanceof Error ? cause.message : "素材暂时无法读取，请重新选择。";
  } finally {
    preparing.value = false;
  }
}

function undoSlot(slot: Slot) {
  if (blocked.value) return;
  releaseSlot(slot);
  if (slot.mediaId) {
    slot.upload = undefined;
    slot.preview = undefined;
  } else slots.value = slots.value.filter((item) => item !== slot);
  syncClip();
  error.value = "";
}

function undoAll() {
  if (blocked.value) return;
  const kept: Slot[] = [];
  for (const slot of slots.value) {
    if (!slot.upload) {
      kept.push(slot);
      continue;
    }
    releaseSlot(slot);
    if (slot.mediaId)
      kept.push({ key: slot.key, mediaId: slot.mediaId, asset: slot.asset });
  }
  slots.value = kept;
  syncClip();
  error.value = "";
}

function removeSlot(slot: Slot) {
  if (blocked.value) return;
  releaseSlot(slot);
  slots.value = slots.value.filter((item) => item !== slot);
  syncClip();
}

function moveSlot(slot: Slot, direction: -1 | 1) {
  if (blocked.value) return;
  const index = slots.value.indexOf(slot);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= slots.value.length) return;
  const copy = [...slots.value];
  [copy[index], copy[next]] = [copy[next], copy[index]];
  slots.value = copy;
}

onBeforeUnmount(() => {
  disposed = true;
  slots.value.forEach(releaseSlot);
});

function save() {
  if (blocked.value) return;
  const finalDraft: EntryDraft = { ...draft };
  if (!videoSlot.value) {
    finalDraft.start = undefined;
    finalDraft.end = undefined;
  }
  error.value = validateEntry(finalDraft, currentVideo.value?.duration) || "";
  if (!error.value)
    emit(
      "save",
      finalDraft,
      slots.value.map((slot) => ({
        ...(slot.mediaId ? { mediaId: slot.mediaId } : {}),
        ...(slot.upload ? { upload: slot.upload } : {}),
      })),
    );
}
function onTagChange(event: Event) {
  const tag = (event.target as HTMLSelectElement).value;
  draft.tag = tag;
  if (!tagDrivesCare.value) return;
  // 选到照护标签时补出 care（展开奶量等字段），改回普通标签时撤销；
  // 同类切换保留已填数值，避免用户刚输入的内容被清掉。
  const next = careFromTag(tag);
  draft.care = draft.care && draft.care.kind === next?.kind ? draft.care : next;
}

function updateCareKind(event: Event) {
  if (!draft.care) return;
  const kind = (event.target as HTMLSelectElement).value as CareKind;
  draft.care = {
    kind,
    sourceText: draft.care.sourceText,
    inputId: draft.care.inputId,
  };
  draft.tag = CARE_LABELS[kind];
}
function numberInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  return value === "" ? undefined : Number(value);
}
/** 换喂养方式时清掉不属于新方式的字段，避免摘要里混进旧数值。 */
function setFeedingMethod(value: string) {
  if (!draft.care) return;
  const { kind, sourceText, inputId, amountMl, feedingMinutes } = draft.care;
  const method = (value || undefined) as FeedingMethod | undefined;
  draft.care = { kind, sourceText, inputId, feedingMethod: method };
  if (method !== "breast" && method !== "solid") draft.care.amountMl = amountMl;
  if (method !== "solid" && method !== "pump") draft.care.feedingMinutes = feedingMinutes;
}
function setBreastMinutes(side: "left" | "right", event: Event) {
  if (!draft.care) return;
  draft.care[side === "left" ? "leftMinutes" : "rightMinutes"] = numberInput(event);
  const { leftMinutes, rightMinutes } = draft.care;
  draft.care.breastSide =
    leftMinutes && rightMinutes ? "both" : leftMinutes ? "left" : rightMinutes ? "right" : undefined;
}
function textInput(event: Event) {
  return (event.target as HTMLInputElement).value.trim() || undefined;
}
function pickVaccine(code: string) {
  if (!draft.care) return;
  const spec = VACCINES_2026.find((item) => item.code === code);
  draft.care.vaccineCode = spec?.code;
  draft.care.vaccineName = spec?.name;
}
/** 片段边界与记录详情共用同一套判断，避免两处播放行为不一致。 */
function handleClip(event: "play" | "timeupdate") {
  const player = video.value;
  if (!player) return;
  const action = clipAction(
    player.currentTime,
    { start: draft.start, end: draft.end },
    event,
  );
  if (!action) return;
  if ("seekTo" in action) player.currentTime = action.seekTo;
  else player.pause();
}
</script>

<template>
  <ModalDialog
    :title="
      entry ? '编辑这段时光' : candidate ? '留下这个瞬间' : '写下这段时光'
    "
    subtitle="A MEMORY TO KEEP"
    :busy="blocked"
    @close="emit('close')"
  >
    <p v-if="candidate?.origin === 'demo'" class="sample-note">
      示例建议 · {{ candidate.suggestion }}。识别标签仅用于演示，由你确认内容。
    </p>
    <p v-else-if="candidate?.suggestion" class="sample-note">
      AI 建议 · {{ candidate.suggestion }}。标题和文字都可以改，确认后才会存档。
    </p>
    <video
      v-if="hasVideo"
      ref="video"
      class="full-media editor-media"
      :src="currentVideo!.url"
      controls
      playsinline
      preload="metadata"
      @play="handleClip('play')"
      @timeupdate="handleClip('timeupdate')"
    />
    <div v-else-if="slots.length" class="photo-grid">
      <div v-for="(slot, index) in slots" :key="slot.key" class="photo-slot">
        <MediaTile
          :key="slot.preview?.id ?? slot.asset?.id"
          :media="slot.preview || slot.asset"
          variant="cover"
          :label="source?.title"
          zoomable
          class="slot-media"
        />
        <div class="slot-actions">
          <button
            v-if="slots.length > 1"
            class="icon-button slot-action"
            type="button"
            :disabled="index === 0 || blocked"
            :aria-label="`把第 ${index + 1} 张移到左边`"
            @click="moveSlot(slot, -1)"
          >
            <ChevronLeft :size="18" />
          </button>
          <button
            v-if="slots.length > 1"
            class="icon-button slot-action"
            type="button"
            :disabled="index === slots.length - 1 || blocked"
            :aria-label="`把第 ${index + 1} 张移到右边`"
            @click="moveSlot(slot, 1)"
          >
            <ChevronRight :size="18" />
          </button>
          <button
            class="icon-button slot-action"
            type="button"
            :disabled="blocked"
            :aria-label="slot.asset && !slot.asset.url && !slot.upload ? `补回第 ${index + 1} 张原片` : `更换第 ${index + 1} 张照片`"
            @click="pickReplace(slot)"
          >
            <ImagePlus :size="17" />
          </button>
          <button
            v-if="slot.upload"
            class="icon-button slot-action"
            type="button"
            :disabled="blocked"
            :aria-label="`撤销第 ${index + 1} 张的本次选择`"
            @click="undoSlot(slot)"
          >
            撤销
          </button>
          <button
            class="icon-button slot-action danger-text"
            type="button"
            :disabled="blocked"
            :aria-label="`删除第 ${index + 1} 张照片`"
            @click="removeSlot(slot)"
          >
            <Trash2 :size="17" />
          </button>
        </div>
      </div>
    </div>
    <div class="media-choice">
      <p v-if="missingCount" class="media-choice-note" role="status">
        这条记录有 {{ missingCount }} 张原片不在当前浏览器中，可以逐张补回，原有文字会保留。
      </p>
      <p v-if="hasUpload" class="media-choice-note">
        新选的素材要点击保存后才会写进记录。
      </p>
      <p v-if="slots.some((slot) => slot.upload && !slot.upload.previewable)" class="media-choice-note">
        当前浏览器无法预览其中某个格式，保存后仍会保留原片。
      </p>
      <div class="media-choice-actions">
        <button
          class="button button-secondary"
          type="button"
          :disabled="blocked || !canAddPhotos"
          @click="addInput?.click()"
        >
          <ImagePlus :size="16" />{{ preparing ? "正在准备素材…" : uploadLabel }}
        </button>
        <button
          v-if="hasUpload"
          class="button button-ghost"
          type="button"
          :disabled="blocked"
          @click="undoAll"
        >
          撤销本次选择
        </button>
      </div>
      <input
        ref="addInput"
        class="visually-hidden"
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.mov"
        aria-label="为记录选择照片或视频"
        :disabled="blocked"
        @change="addMedia"
      />
      <input
        ref="replaceInput"
        class="visually-hidden"
        type="file"
        accept="image/*,video/*,.heic,.heif,.mov"
        aria-label="补回或更换这一张照片"
        :disabled="blocked"
        @change="replaceSlot"
      />
      <p class="fine-print left">
        照片最多 {{ MAX_ENTRY_MEDIA }} 张，第一张作封面，可左右移动改顺序；含视频时只保留一个素材。
      </p>
    </div>
    <form class="entry-form" @submit.prevent="save">
      <label class="field"
        ><span>给它一个名字</span
        ><input
          v-model="draft.title"
          maxlength="48"
          placeholder="例如：和你一起醒来的早晨"
          required
          autofocus
      /></label>
      <div class="two-fields">
        <label class="field"
          ><span>记录时间</span
          ><input v-model="draft.capturedAt" type="datetime-local" required
        /></label>
        <label class="field"
          ><span>放进哪一类</span
          ><select :value="draft.tag" @change="onTagChange">
            <option v-for="tag in ENTRY_TAGS" :key="tag">{{ tag }}</option>
          </select></label
        >
      </div>
      <div v-if="draft.care" class="care-fields">
        <label class="field"
          ><span>照护类别</span
          ><select :value="draft.care.kind" @change="updateCareKind">
            <option
              v-for="(label, kind) in CARE_LABELS"
              :key="kind"
              :value="kind"
            >
              {{ label }}
            </option>
          </select></label
        >
        <label v-if="draft.care.kind === 'feeding'" class="field"
          ><span>喂养方式（可选）</span
          ><select
            :value="draft.care.feedingMethod ?? ''"
            @change="setFeedingMethod(($event.target as HTMLSelectElement).value)"
          >
            <option value="">未细分</option>
            <option
              v-for="(label, method) in FEEDING_METHOD_LABELS"
              :key="method"
              :value="method"
            >
              {{ label }}
            </option>
          </select></label
        >
        <template v-if="draft.care.kind === 'feeding' && draft.care.feedingMethod === 'breast'">
          <label class="field"
            ><span>左侧（分钟，可选）</span
            ><input
              :value="draft.care.leftMinutes ?? ''"
              type="number"
              min="1"
              max="600"
              inputmode="numeric"
              @input="setBreastMinutes('left', $event)"
          /></label>
          <label class="field"
            ><span>右侧（分钟，可选）</span
            ><input
              :value="draft.care.rightMinutes ?? ''"
              type="number"
              min="1"
              max="600"
              inputmode="numeric"
              @input="setBreastMinutes('right', $event)"
          /></label>
        </template>
        <template v-if="draft.care.kind === 'feeding' && draft.care.feedingMethod === 'solid'">
          <label class="field"
            ><span>吃了什么（可选）</span
            ><input
              :value="draft.care.food ?? ''"
              maxlength="30"
              placeholder="例如：南瓜泥"
              @input="draft.care.food = textInput($event)"
          /></label>
          <label class="field"
            ><span>不适或过敏（可选）</span
            ><input
              :value="draft.care.reaction ?? ''"
              maxlength="60"
              placeholder="只记看到的情况"
              @input="draft.care.reaction = textInput($event)"
          /></label>
        </template>
        <label
          v-if="
            draft.care.kind === 'feeding' &&
            draft.care.feedingMethod !== 'breast' &&
            draft.care.feedingMethod !== 'solid'
          "
          class="field"
          ><span>{{ draft.care.feedingMethod === "pump" ? "吸出量" : "奶量" }}（毫升，可选）</span
          ><input
            :value="draft.care.amountMl ?? ''"
            type="number"
            min="0.1"
            max="400"
            step="0.1"
            @input="draft.care.amountMl = numberInput($event)"
        /></label>
        <label
          v-if="
            draft.care.kind === 'feeding' &&
            draft.care.feedingMethod !== 'solid' &&
            draft.care.feedingMethod !== 'pump'
          "
          class="field"
          ><span>喂奶时长（分钟，可选）</span
          ><input
            :value="draft.care.feedingMinutes ?? ''"
            type="number"
            min="1"
            max="600"
            inputmode="numeric"
            @input="draft.care.feedingMinutes = numberInput($event)"
        /></label>
        <label v-if="draft.care.kind === 'sleep'" class="field"
          ><span>睡眠时长（分钟，可选）</span
          ><input
            :value="draft.care.durationMinutes ?? ''"
            type="number"
            min="0.1"
            step="0.1"
            @input="draft.care.durationMinutes = numberInput($event)"
        /></label>
        <label v-if="draft.care.kind === 'sleep'" class="field"
          ><span>睡眠状态</span
          ><select v-model="draft.care.sleepState">
            <option :value="undefined">仅记录睡眠</option>
            <option value="asleep">睡着了</option>
            <option value="awake">醒来了</option>
            <option value="duration">记录睡眠时长</option>
          </select></label
        >
        <label v-if="draft.care.kind === 'diaper'" class="field"
          ><span>尿布记录</span
          ><select v-model="draft.care.diaper">
            <option :value="undefined">只记录更换</option>
            <option value="wet">尿湿</option>
            <option value="dirty">便便</option>
            <option value="mixed">尿湿和便便</option>
          </select></label
        >
        <label v-if="draft.care.kind === 'temperature'" class="field"
          ><span>体温（℃）</span
          ><input
            :value="draft.care.temperatureC ?? ''"
            type="number"
            min="34"
            max="43"
            step="0.1"
            inputmode="decimal"
            @input="draft.care.temperatureC = numberInput($event)"
        /></label>
        <label v-if="draft.care.kind === 'temperature'" class="field"
          ><span>测温部位（可选）</span
          ><select
            :value="draft.care.site ?? ''"
            @change="
              draft.care.site =
                (($event.target as HTMLSelectElement)
                  .value as keyof typeof SITE_LABELS) || undefined
            "
          >
            <option value="">未选择</option>
            <option v-for="(label, site) in SITE_LABELS" :key="site" :value="site">
              {{ label }}
            </option>
          </select></label
        >
        <label v-if="draft.care.kind === 'medicine'" class="field"
          ><span>药名</span
          ><input
            :value="draft.care.medicineName ?? ''"
            maxlength="30"
            placeholder="例如：美林"
            @input="
              draft.care.medicineName =
                ($event.target as HTMLInputElement).value || undefined
            "
        /></label>
        <label v-if="draft.care.kind === 'medicine'" class="field"
          ><span>剂量（保留原文，如 2.5ml）</span
          ><input
            :value="draft.care.dose ?? ''"
            maxlength="20"
            placeholder="例如：2.5ml"
            @input="
              draft.care.dose =
                ($event.target as HTMLInputElement).value || undefined
            "
        /></label>
        <label v-if="draft.care.kind === 'vaccination'" class="field"
          ><span>疫苗</span
          ><select
            :value="draft.care.vaccineCode ?? ''"
            @change="
              pickVaccine(($event.target as HTMLSelectElement).value)
            "
          >
            <option value="">请选择</option>
            <option
              v-for="spec in VACCINES_2026"
              :key="spec.code"
              :value="spec.code"
            >
              {{ spec.name }}
            </option>
          </select></label
        >
        <label v-if="draft.care.kind === 'measurement'" class="field"
          ><span>体重（kg）</span
          ><input
            :value="draft.care.weightKg ?? ''"
            type="number"
            min="0.5"
            max="40"
            step="0.01"
            inputmode="decimal"
            @input="draft.care.weightKg = numberInput($event)"
        /></label>
        <label v-if="draft.care.kind === 'measurement'" class="field"
          ><span>身高 / 身长（cm）</span
          ><input
            :value="draft.care.heightCm ?? ''"
            type="number"
            min="20"
            max="130"
            step="0.01"
            inputmode="decimal"
            @input="draft.care.heightCm = numberInput($event)"
        /></label>
        <label v-if="draft.care.kind === 'measurement'" class="field"
          ><span>头围（cm）</span
          ><input
            :value="draft.care.headCm ?? ''"
            type="number"
            min="20"
            max="60"
            step="0.01"
            inputmode="decimal"
            @input="draft.care.headCm = numberInput($event)"
        /></label>
      </div>
      <div
        v-if="currentVideo?.kind === 'video' && currentVideo.duration"
        class="two-fields clip-fields"
      >
        <label class="field"
          ><span>片段开始（秒）</span
          ><input
            v-model.number="draft.start"
            type="number"
            min="0"
            :max="currentVideo.duration"
            step="any"
            required
        /></label>
        <label class="field"
          ><span>片段结束（秒）</span
          ><input
            v-model.number="draft.end"
            type="number"
            min="0"
            :max="currentVideo.duration"
            step="any"
            required
        /></label>
      </div>
      <label class="field"
        ><span>写给以后的你 <small>可选</small></span
        ><textarea
          v-model="draft.note"
          rows="3"
          maxlength="500"
          placeholder="记下当时的声音、心情，或一个小小的细节。"
        />
      </label>
      <label class="check-field"
        ><input v-model="draft.milestone" type="checkbox" /><span
          >由我标记为成长里程碑</span
        ></label
      >
      <p class="fine-print left">里程碑由家长记录，不代表健康或发育评估。</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
      <button
        class="button button-primary full-width"
        type="submit"
        :disabled="blocked"
      >
        <component :is="entry ? Save : BookmarkPlus" :size="17" />{{
          preparing
            ? "正在准备素材…"
            : busy
              ? "正在保存…"
              : entry
                ? "保存修改"
                : "收进成长时光"
        }}
      </button>
    </form>
  </ModalDialog>
</template>

<style scoped>
.entry-form {
  display: grid;
  gap: 18px;
  margin-top: 23px;
}
.care-fields {
  display: grid;
  gap: 14px;
  padding: 15px;
  background: var(--tint);
  border-radius: 13px;
}
.editor-media {
  margin-top: 20px;
}
.media-choice {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}
.media-choice-note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.media-choice-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sample-note {
  margin-top: 12px;
  background: var(--sage);
  border-radius: 11px;
  color: var(--sage-ink);
  font-size: 12px;
  padding: 11px 13px;
}
.clip-fields {
  padding: 14px;
  border-radius: 13px;
  background: var(--bg);
}
.fine-print.left {
  text-align: left;
  margin-top: -10px;
}
.check-field {
  margin-top: 2px;
}
.entry-form > .button {
  margin-top: 3px;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 10px;
  margin-top: 20px;
}
.photo-slot {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.photo-slot .slot-media {
  aspect-ratio: 1 / 1;
}
.photo-slot :deep(.media-cover) {
  aspect-ratio: 1 / 1;
}
.slot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.slot-action {
  min-width: 44px;
  min-height: 44px;
  padding: 0 8px;
  font-size: 12px;
}
.slot-action:disabled {
  opacity: 0.4;
}
</style>
