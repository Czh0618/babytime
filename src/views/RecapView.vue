<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Clapperboard,
  Download,
  Eye,
  FileText,
  Plus,
  Trash2,
  X,
} from "@lucide/vue";
import MediaTile from "../components/MediaTile.vue";
import TrendChart from "../components/TrendChart.vue";
import { formatDate, formatTime } from "../domain/date";
import { suggestMonthlyRecap } from "../domain/recap-draft";
import {
  RECAP_SYSTEM_PROMPT,
  buildRecapUserPrompt,
  parseRecapCopy,
} from "../domain/ai";
import { aiChat, aiErrorMessage } from "../lib/ai-service";
import type { GrowthEntry, MediaAsset, Recap, RecapDraft } from "../types";

const props = withDefaults(
  defineProps<{
    entries: GrowthEntry[];
    media: MediaAsset[];
    recaps: Recap[];
    busy?: boolean;
    error?: string;
    ageMonths?: number;
    aiReady?: boolean;
  }>(),
  { busy: false, error: "", aiReady: false },
);

const emit = defineEmits<{
  create: [draft: RecapDraft];
  open: [recap: Recap];
  download: [recap: Recap];
  remove: [id: string];
}>();

const creating = ref(false);
const title = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const selected = ref<string[]>([]);
const notice = ref("");
const pendingCreate = ref<string | null>(null);
const draftDismissed = ref(false);
/** 上个月的回顾草稿：按收藏与里程碑预选，确认后才保存。 */
const monthlyDraft = computed(() => suggestMonthlyRecap(props.entries));

const aiBusy = ref(false);
const aiError = ref("");
/** AI 建议只停在草稿卡片上，点「用它生成」才带进新建表单。 */
const aiTitleText = ref("");
const aiNote = ref("");
let aiController: AbortController | null = null;

const draftTitle = computed(
  () => aiTitleText.value || monthlyDraft.value?.title || "",
);

async function useMonthlyDraft() {
  const draft = monthlyDraft.value;
  if (!draft) return;
  title.value = draftTitle.value;
  dateFrom.value = draft.dateFrom;
  dateTo.value = draft.dateTo;
  creating.value = true;
  // 等日期 watch 完成筛选后再设置选中的条目。
  await nextTick();
  selected.value = draft.entryIds;
  notice.value = aiTitleText.value
    ? "已带上 AI 建议的标题，可以按收藏和里程碑预选的瞬间再增减。"
    : "已按收藏和里程碑预选上个月的瞬间，可以增减后再保存。";
}

/** 用 AI 给这份草稿起标题与一句短文；只发标题列表，不发图片。 */
async function aiTitle() {
  const draft = monthlyDraft.value;
  if (!draft || aiBusy.value || !props.aiReady) return;
  aiBusy.value = true;
  aiError.value = "";
  // 请求留在卡片里完成：卡片一卸载，状态和失败原因就都看不见了。
  const controller = new AbortController();
  aiController = controller;
  try {
    const items = draft.entryIds
      .map((id) => props.entries.find((entry) => entry.id === id)?.title ?? "")
      .filter(Boolean);
    const raw = await aiChat(
      RECAP_SYSTEM_PROMPT,
      buildRecapUserPrompt({
        month: `${draft.dateFrom} 至 ${draft.dateTo}`,
        items,
      }),
      controller.signal,
    );
    if (controller.signal.aborted) return;
    const copy = parseRecapCopy(raw);
    aiTitleText.value = copy.title;
    aiNote.value = copy.note;
  } catch (cause) {
    if (controller.signal.aborted) return;
    aiError.value = `${aiErrorMessage(cause)} 可以重试，或直接点「用它生成」用默认标题。`;
  } finally {
    // 取消后立刻又发起一次时，别让上一次请求的收尾改掉新请求的状态。
    if (aiController === controller) {
      aiController = null;
      aiBusy.value = false;
    }
  }
}

function cancelAiTitle() {
  aiController?.abort();
  aiController = null;
  aiBusy.value = false;
  aiError.value = "";
}

/** 换了月份或草稿消失，旧的 AI 建议不再适用。 */
watch(
  () => monthlyDraft.value?.title,
  () => {
    aiController?.abort();
    aiController = null;
    aiBusy.value = false;
    aiError.value = "";
    aiTitleText.value = "";
    aiNote.value = "";
  },
);

onBeforeUnmount(() => aiController?.abort());

const sortedEntries = computed(() =>
  [...props.entries].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
);
const inRangeEntries = computed(() =>
  sortedEntries.value.filter((entry) => {
    const date = entry.capturedAt.slice(0, 10);
    return (
      (!dateFrom.value || date >= dateFrom.value) &&
      (!dateTo.value || date <= dateTo.value)
    );
  }),
);
const chosenEntries = computed(
  () =>
    selected.value
      .map((id) => props.entries.find((entry) => entry.id === id))
      .filter(Boolean) as GrowthEntry[],
);
const canCreate = computed(
  () =>
    title.value.trim().length > 0 &&
    selected.value.length > 0 &&
    !!dateFrom.value &&
    !!dateTo.value &&
    dateFrom.value <= dateTo.value &&
    !props.busy,
);

watch([dateFrom, dateTo], () => {
  const idsInRange = new Set(inRangeEntries.value.map((entry) => entry.id));
  selected.value = selected.value.filter((id) => idsInRange.has(id));
});

watch(
  () => props.recaps,
  (recaps) => {
    if (!pendingCreate.value) return;
    const saved = recaps.some(
      (recap) =>
        `${recap.title}|${recap.entryIds.join(",")}` === pendingCreate.value,
    );
    if (!saved) return;
    pendingCreate.value = null;
    creating.value = false;
    title.value = "";
    dateFrom.value = "";
    dateTo.value = "";
    selected.value = [];
    aiTitleText.value = "";
    aiNote.value = "";
    aiError.value = "";
    notice.value = "回顾已保存，可以随时回来继续查看。";
  },
  { deep: true },
);

function mediaFor(entry?: GrowthEntry) {
  return entry?.mediaId
    ? props.media.find((asset) => asset.id === entry.mediaId)
    : undefined;
}

function toggleEntry(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id];
}

function move(id: string, direction: -1 | 1) {
  const index = selected.value.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= selected.value.length) return;
  const copy = [...selected.value];
  [copy[index], copy[next]] = [copy[next], copy[index]];
  selected.value = copy;
}

function startCreating() {
  creating.value = true;
  notice.value = "";
  if (!title.value) title.value = aiTitleText.value || "和你一起的这一周";
  if (!dateFrom.value && sortedEntries.value.length)
    dateFrom.value = sortedEntries.value.at(-1)?.capturedAt.slice(0, 10) ?? "";
  if (!dateTo.value && sortedEntries.value.length)
    dateTo.value = sortedEntries.value[0]?.capturedAt.slice(0, 10) ?? "";
}

function cancelCreating() {
  creating.value = false;
  notice.value = "";
}

function createRecap() {
  if (!canCreate.value) {
    notice.value =
      !dateFrom.value || !dateTo.value
        ? "请先选择完整的日期范围。"
        : dateFrom.value > dateTo.value
          ? "开始日期不能晚于结束日期。"
          : selected.value.length
            ? "请先填写回顾标题。"
            : "至少选择一个已确认的成长瞬间。";
    return;
  }
  const draft = {
    title: title.value.trim(),
    entryIds: [...selected.value],
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
  };
  pendingCreate.value = `${draft.title}|${draft.entryIds.join(",")}`;
  notice.value = "";
  emit("create", draft);
}
</script>

<template>
  <section class="page recap-page" aria-labelledby="recap-heading">
    <div class="page-heading-row">
      <div>
        <p class="eyebrow">A LITTLE FILM</p>
        <h1 id="recap-heading" class="page-heading">把几天，变成一份回忆</h1>
        <p class="muted page-lede">
          只用已确认的记录，做一份图文回顾。
        </p>
      </div>
      <button
        v-if="props.recaps.length"
        class="button button-primary header-action"
        type="button"
        @click="startCreating"
      >
        <Plus :size="17" aria-hidden="true" /> 新建
      </button>
    </div>

    <div
      v-if="monthlyDraft && !draftDismissed && !creating"
      class="monthly-draft"
      role="status"
    >
      <div>
        <strong>{{ draftTitle }}</strong>
        <p class="muted">
          已预选 {{ monthlyDraft.entryIds.length }}
          个瞬间（收藏与里程碑优先），确认后才会保存。
        </p>
        <p v-if="aiTitleText" class="muted ai-suggestion">
          AI 建议 · {{ aiNote || "点「用它生成」把这个标题带进回顾。" }}
        </p>
      </div>
      <div class="monthly-draft-actions">
        <button
          class="button button-secondary"
          type="button"
          @click="useMonthlyDraft"
        >
          用它生成
        </button>
        <button
          v-if="aiReady && !aiBusy"
          class="button button-ghost"
          type="button"
          @click="aiTitle"
        >
          AI 起个标题
        </button>
        <template v-else-if="aiBusy">
          <span class="ai-waiting">AI 正在写…（最多 30 秒）</span>
          <button
            class="button button-ghost"
            type="button"
            @click="cancelAiTitle"
          >
            取消
          </button>
        </template>
        <button
          class="button button-ghost"
          type="button"
          @click="draftDismissed = true"
        >
          这次不用
        </button>
      </div>
      <p v-if="aiError" class="monthly-draft-error" role="alert">{{ aiError }}</p>
    </div>

    <TrendChart :entries="props.entries" :age-months="props.ageMonths" />

    <div v-if="props.error" class="notice error" role="alert">
      {{ props.error }}
    </div>
    <div v-else-if="notice" class="notice" role="status">
      <Check :size="16" aria-hidden="true" />{{ notice }}
    </div>

    <form
      v-if="creating"
      class="recap-builder surface"
      @submit.prevent="createRecap"
    >
      <div class="builder-topline">
        <div>
          <p class="eyebrow">MAKE A MEMORY</p>
          <h2 class="section-heading">新建成长回顾</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="关闭新建回顾"
          @click="cancelCreating"
        >
          <X :size="18" />
        </button>
      </div>

      <div class="form-grid">
        <label class="field"
          ><span>回顾标题</span
          ><input
            v-model="title"
            class="input"
            maxlength="60"
            placeholder="例如：和你一起的这一周"
            required
        /></label>
        <div class="date-grid">
          <label class="field"
            ><span>开始日期</span
            ><input v-model="dateFrom" class="input" type="date" required
          /></label>
          <label class="field"
            ><span>结束日期</span
            ><input v-model="dateTo" class="input" type="date" required
          /></label>
        </div>
      </div>

      <div class="builder-section-heading">
        <div>
          <h3 class="section-heading small">选择成长瞬间</h3>
          <p class="muted">未勾选的记录不会出现在这份回顾里。</p>
        </div>
        <span class="pill">已选 {{ selected.length }} 条</span>
      </div>
      <div v-if="inRangeEntries.length" class="selection-list">
        <label
          v-for="entry in inRangeEntries"
          :key="entry.id"
          class="selection-row"
          :class="{ selected: selected.includes(entry.id) }"
        >
          <input
            :checked="selected.includes(entry.id)"
            type="checkbox"
            @change="toggleEntry(entry.id)"
          />
          <MediaTile
            :media="mediaFor(entry)"
            variant="thumb"
            :label="entry.title"
          />
          <span class="selection-copy"
            ><strong>{{ entry.title }}</strong
            ><small
              >{{ formatDate(entry.capturedAt) }} ·
              {{ formatTime(entry.capturedAt) }}</small
            ></span
          >
          <Check
            v-if="selected.includes(entry.id)"
            class="selection-check"
            :size="18"
            aria-hidden="true"
          />
        </label>
      </div>
      <div v-else class="empty-state compact">
        <CalendarDays :size="24" aria-hidden="true" />
        <p>这个日期范围里还没有已确认的成长记录。</p>
      </div>

      <div v-if="chosenEntries.length" class="order-section">
        <div class="builder-section-heading">
          <div>
            <h3 class="section-heading small">回顾顺序</h3>
            <p class="muted">用上下按钮调整图文出现的顺序。</p>
          </div>
        </div>
        <ol class="order-list">
          <li v-for="(entry, index) in chosenEntries" :key="entry.id">
            <span class="order-number">{{ index + 1 }}</span
            ><span>{{ entry.title }}</span
            ><span class="order-actions"
              ><button
                class="icon-button small"
                type="button"
                :disabled="index === 0"
                :aria-label="`将${entry.title}上移`"
                @click="move(entry.id, -1)"
              >
                <ArrowUp :size="16" /></button
              ><button
                class="icon-button small"
                type="button"
                :disabled="index === chosenEntries.length - 1"
                :aria-label="`将${entry.title}下移`"
                @click="move(entry.id, 1)"
              >
                <ArrowDown :size="16" /></button
            ></span>
          </li>
        </ol>
      </div>

      <div class="builder-footer">
        <p class="muted helper-text">当前版本保存为图文回顾。</p>
        <button
          class="button button-primary"
          type="submit"
          :disabled="!canCreate"
        >
          <FileText :size="17" aria-hidden="true" /> 保存回顾
        </button>
      </div>
    </form>

    <div v-if="!creating && !props.recaps.length" class="recap-empty surface">
      <div class="empty-icon">
        <Clapperboard :size="26" aria-hidden="true" />
      </div>
      <h2 class="section-heading">还没有成长回顾</h2>
      <p class="muted">
        从已确认的时光里挑几段，先做一份图文回顾。它不会改动原始照片或视频。
      </p>
      <button
        class="button button-primary"
        type="button"
        @click="startCreating"
      >
        <Plus :size="17" aria-hidden="true" /> 新建第一份回顾
      </button>
    </div>

    <section v-else class="recap-list" aria-labelledby="saved-recaps-heading">
      <div class="section-heading-row">
        <div>
          <p class="eyebrow">KEPT MEMORIES</p>
          <h2 id="saved-recaps-heading" class="section-heading">
            已经保存的回顾
          </h2>
        </div>
        <span class="muted">{{ props.recaps.length }} 份</span>
      </div>
      <article
        v-for="recap in props.recaps"
        :key="recap.id"
        class="recap-card surface"
      >
        <div class="recap-cover">
          <div class="eyebrow">
            {{ formatDate(recap.dateFrom) }} — {{ formatDate(recap.dateTo) }}
          </div>
          <h3>{{ recap.title }}</h3>
          <p>{{ recap.entryIds.length }} 个已确认瞬间 · 图文回顾</p>
        </div>
        <div class="recap-card-content">
          <div>
            <h3 class="section-heading small">{{ recap.title }}</h3>
            <p class="muted">创建于 {{ formatDate(recap.createdAt) }}</p>
          </div>
          <div class="card-actions">
            <button
              class="button button-secondary"
              type="button"
              @click="emit('open', recap)"
            >
              <Eye :size="16" aria-hidden="true" />预览</button
            ><button
              class="icon-button"
              type="button"
              :aria-label="`导出${recap.title}`"
              @click="emit('download', recap)"
            >
              <Download :size="17" /></button
            ><button
              class="icon-button danger"
              type="button"
              :aria-label="`删除${recap.title}`"
              @click="emit('remove', recap.id)"
            >
              <Trash2 :size="17" />
            </button>
          </div>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.recap-page {
  padding-bottom: 40px;
}
.page-heading-row,
.section-heading-row,
.builder-topline,
.builder-section-heading,
.builder-footer,
.card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.page-lede {
  max-width: 620px;
  margin-top: 8px;
}
.header-action {
  flex: none;
}
.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sage);
  color: var(--sage-ink);
  border-radius: 12px;
  padding: 12px 14px;
  margin: 18px 0;
}
.notice.error {
  background: var(--danger-bg);
  color: var(--danger-ink);
}
.surface {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(74, 52, 30, 0.045);
}
.recap-builder {
  padding: 22px;
  margin: 24px 0;
}
.section-heading.small {
  font-size: 16px;
}
.form-grid {
  display: grid;
  gap: 16px;
  margin: 22px 0;
}
.date-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field {
  display: grid;
  gap: 7px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}
.input {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--bg);
  color: var(--ink);
  padding: 10px 12px;
  font: inherit;
  font-size: 16px;
}
.input:focus {
  outline: 3px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-color: var(--accent);
}
.builder-section-heading {
  align-items: flex-start;
  margin: 24px 0 12px;
}
.selection-list {
  display: grid;
  gap: 8px;
}
.selection-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 72px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 14px;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s;
}
.selection-row:hover,
.selection-row.selected {
  background: var(--tint);
  border-color: var(--line);
}
.selection-row input {
  width: 19px;
  height: 19px;
  accent-color: var(--accent);
  flex: none;
}
.selection-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.selection-copy strong {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selection-copy small {
  font-size: 12px;
  color: var(--muted);
}
.selection-check {
  color: var(--accent);
  flex: none;
}
.order-section {
  margin-top: 24px;
}
.order-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--line);
}
.order-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.order-number {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--accent);
  font-size: 12px;
  flex: none;
}
.order-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}
.icon-button.small {
  min-width: 44px;
  min-height: 44px;
}
.icon-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.builder-footer {
  align-items: flex-end;
  margin-top: 22px;
}
.helper-text {
  max-width: 510px;
}
.recap-empty {
  text-align: center;
  padding: 34px 20px;
  margin-top: 20px;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 17px;
  background: var(--tint);
  color: var(--accent);
  margin: 0 auto 12px;
}
.recap-empty p {
  max-width: 430px;
  margin: 8px auto 20px;
}
.recap-list {
  margin-top: 30px;
}
.recap-card {
  overflow: hidden;
  margin-top: 16px;
}
.recap-cover {
  padding: 24px;
  min-height: 158px;
  background: linear-gradient(135deg, var(--tint), var(--sage));
  display: grid;
  align-content: space-between;
  gap: 14px;
}
.recap-cover h3 {
  font:
    400 26px/1.4 Georgia,
    "Songti SC",
    serif;
  letter-spacing: 0.5px;
}
.recap-cover p {
  font-size: 12px;
  color: var(--muted);
}
.recap-card-content {
  padding: 15px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.danger {
  color: var(--danger);
}
@media (max-width: 600px) {
  .page-heading-row,
  .section-heading-row {
    align-items: flex-start;
  }
  .page-heading-row {
    display: grid;
  }
  .header-action {
    width: 100%;
  }
  .recap-builder {
    padding: 16px;
  }
  .builder-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .builder-footer .button {
    width: 100%;
  }
  .recap-card-content {
    align-items: flex-start;
    flex-direction: column;
  }
  .card-actions {
    width: 100%;
  }
  .card-actions .button-secondary {
    flex: 1;
  }
}
@media (max-width: 350px) {
  .date-grid {
    grid-template-columns: 1fr;
  }
  .selection-copy strong {
    white-space: normal;
  }
}
.monthly-draft {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 18px 0 0;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--tint);
}
.monthly-draft strong {
  font-size: 15px;
  font-weight: 600;
}
.monthly-draft p {
  margin: 4px 0 0;
  font-size: var(--font-xs);
  line-height: 1.6;
}
.monthly-draft-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.monthly-draft-actions .button {
  min-height: 40px;
  font-size: 13px;
}
.monthly-draft .ai-suggestion {
  color: var(--accent);
}
.ai-waiting {
  align-self: center;
  color: var(--muted);
  font-size: 13px;
}
.monthly-draft-error {
  flex-basis: 100%;
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
