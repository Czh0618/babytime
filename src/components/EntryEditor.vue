<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from "vue";
import { BookmarkPlus, ImagePlus, Save } from "@lucide/vue";
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
import { prepareMediaFile, type PreparedMedia } from "../lib/media";
import { clipAction } from "../domain/clip";
import {
  ENTRY_TAGS,
  type Candidate,
  type EntryDraft,
  type GrowthEntry,
  type MediaAsset,
} from "../types";

const props = defineProps<{
  candidate?: Candidate;
  entry?: GrowthEntry;
  media?: MediaAsset;
  busy: boolean;
  saveError?: string;
  initialDraft?: EntryDraft;
}>();
const emit = defineEmits<{
  close: [];
  save: [draft: EntryDraft, upload?: PreparedMedia];
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
const mediaInput = ref<HTMLInputElement>();
const preparing = ref(false);
const upload = shallowRef<PreparedMedia>();
const uploadPreview = shallowRef<MediaAsset>();
const currentMedia = computed(() => uploadPreview.value || props.media);
const blocked = computed(() => props.busy || preparing.value);
const missingOriginal = computed(
  () =>
    !upload.value &&
    !props.media?.demo &&
    !props.media?.url &&
    Boolean(props.media || props.entry?.mediaId || props.candidate?.mediaId),
);
const uploadLabel = computed(() =>
  missingOriginal.value
    ? "补回照片或视频"
    : currentMedia.value
      ? "更换照片或视频"
      : "添加照片或视频",
);
const hasVideo = computed(
  () =>
    currentMedia.value?.kind === "video" &&
    currentMedia.value.url &&
    currentMedia.value.previewable,
);
let previousClip = { start: draft.start, end: draft.end };
let selection = 0;
let disposed = false;

function releaseUploadPreview() {
  if (uploadPreview.value?.url)
    URL.revokeObjectURL(uploadPreview.value.url);
  if (uploadPreview.value?.thumbnailUrl)
    URL.revokeObjectURL(uploadPreview.value.thumbnailUrl);
  uploadPreview.value = undefined;
}

async function chooseMedia(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || blocked.value) return;
  preparing.value = true;
  error.value = "";
  let preview: MediaAsset | undefined;
  try {
    const prepared = await prepareMediaFile(file);
    if (disposed) return;
    preview = {
      id: `editor-upload-${++selection}`,
      name: file.name,
      kind: prepared.kind,
      mime: file.type,
      size: file.size,
      capturedAt: draft.capturedAt,
      duration: prepared.duration,
      previewable: prepared.previewable,
      theme: props.media?.theme || "sand",
      url: URL.createObjectURL(file),
    };
    if (prepared.thumbnail)
      preview.thumbnailUrl = URL.createObjectURL(prepared.thumbnail);
    if (!upload.value)
      previousClip = { start: draft.start, end: draft.end };
    releaseUploadPreview();
    upload.value = prepared;
    uploadPreview.value = preview;
    draft.start = prepared.duration ? 0 : undefined;
    draft.end = prepared.duration || undefined;
  } catch (cause) {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    if (preview?.thumbnailUrl) URL.revokeObjectURL(preview.thumbnailUrl);
    error.value =
      cause instanceof Error ? cause.message : "素材暂时无法读取，请重新选择。";
  } finally {
    preparing.value = false;
  }
}

function undoUpload() {
  if (blocked.value) return;
  releaseUploadPreview();
  upload.value = undefined;
  draft.start = previousClip.start;
  draft.end = previousClip.end;
  error.value = "";
}

onBeforeUnmount(() => {
  disposed = true;
  releaseUploadPreview();
});

function save() {
  if (blocked.value) return;
  error.value = validateEntry(draft, currentMedia.value?.duration) || "";
  if (!error.value) emit("save", { ...draft }, upload.value);
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
      :src="currentMedia!.url"
      controls
      playsinline
      preload="metadata"
      @play="handleClip('play')"
      @timeupdate="handleClip('timeupdate')"
    />
    <MediaTile
      v-else-if="currentMedia"
      :key="currentMedia.id"
      :media="currentMedia"
      variant="cover"
      :label="source?.title"
      zoomable
      class="editor-media"
    />
    <div v-if="!draft.care && !candidate" class="media-choice">
      <p v-if="missingOriginal" class="media-choice-note" role="status">
        这条记录的原片不在当前浏览器中。可以从相册补回，原有文字会保留。
      </p>
      <p v-if="upload" class="media-choice-note">
        已选择 {{ upload.file.name }}，点击保存后才会更新记录。
      </p>
      <p v-if="upload && !upload.previewable" class="media-choice-note">
        当前浏览器无法预览此格式，保存后会保留原片。
      </p>
      <div class="media-choice-actions">
        <button
          class="button button-secondary"
          type="button"
          :disabled="blocked"
          @click="mediaInput?.click()"
        >
          <ImagePlus :size="16" />{{ preparing ? "正在准备素材…" : uploadLabel }}
        </button>
        <button
          v-if="upload"
          class="button button-ghost"
          type="button"
          :disabled="blocked"
          @click="undoUpload"
        >
          撤销本次选择
        </button>
      </div>
      <input
        ref="mediaInput"
        class="visually-hidden"
        type="file"
        accept="image/*,video/*,.heic,.heif,.mov"
        aria-label="为记录选择照片或视频"
        :disabled="blocked"
        @change="chooseMedia"
      />
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
            step="0.1"
            inputmode="decimal"
            @input="draft.care.weightKg = numberInput($event)"
        /></label>
        <label v-if="draft.care.kind === 'measurement'" class="field"
          ><span>身高（cm）</span
          ><input
            :value="draft.care.heightCm ?? ''"
            type="number"
            min="20"
            max="130"
            step="0.1"
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
            step="0.1"
            inputmode="decimal"
            @input="draft.care.headCm = numberInput($event)"
        /></label>
      </div>
      <div
        v-if="currentMedia?.kind === 'video' && currentMedia.duration"
        class="two-fields clip-fields"
      >
        <label class="field"
          ><span>片段开始（秒）</span
          ><input
            v-model.number="draft.start"
            type="number"
            min="0"
            :max="currentMedia.duration"
            step="any"
            required
        /></label>
        <label class="field"
          ><span>片段结束（秒）</span
          ><input
            v-model.number="draft.end"
            type="number"
            min="0"
            :max="currentMedia.duration"
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
</style>
