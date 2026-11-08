<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, Check, Sparkles, X } from "@lucide/vue";
import MediaTile from "../components/MediaTile.vue";
import type { Candidate, MediaAsset } from "../types";
import { durationLabel, formatDate, formatTime } from "../domain/date";

const props = defineProps<{
  candidates: Candidate[];
  media: MediaAsset[];
  aiAvailable: boolean;
  suggestingId?: string;
}>();

const emit = defineEmits<{
  review: [candidate: Candidate];
  dismiss: [id: string];
  add: [];
  suggest: [candidate: Candidate, hint: string];
  openAiSettings: [];
}>();

/** 家长写给 AI 的一句话，只在本次点击时发送，不写入工作区。 */
const hints = ref<Record<string, string>>({});

const pending = computed(() =>
  props.candidates.filter((candidate) => candidate.status === "pending"),
);
const mediaById = computed(
  () => new Map(props.media.map((asset) => [asset.id, asset])),
);
const hasDemo = computed(() =>
  pending.value.some((candidate) => candidate.origin === "demo"),
);

/** P7.1：列表只显示封面，多图用「+N」角标；视频候选只有一个素材。 */
function cover(candidate: Candidate): MediaAsset | undefined {
  return mediaById.value.get(candidate.mediaIds[0] ?? "");
}

function isDemo(candidate: Candidate) {
  return candidate.origin === "demo";
}

function suggestion(candidate: Candidate) {
  if (candidate.suggestion) return candidate.suggestion;
  if (isDemo(candidate)) return "示例建议 · 由你确认内容";
  return "待你整理 · 添加一个你想记住的名字";
}
</script>

<template>
  <section class="inbox-page" aria-labelledby="inbox-heading">
    <header>
      <p class="eyebrow">Little moments</p>
      <h1 id="inbox-heading" class="page-heading">值得停下来的瞬间</h1>
      <p class="page-lead">
        {{
          pending.length
            ? hasDemo
              ? "先体验示例建议，也可以整理自己的素材。"
              : "素材已经保存，给它们一个想记住的名字。"
            : "新的照片和视频，会在这里等你整理。"
        }}
      </p>
    </header>

    <div v-if="pending.length" class="privacy-note">
      <Sparkles :size="16" aria-hidden="true" />
      <span>未经你确认的内容，不会进入成长档案。</span>
    </div>

    <div v-if="pending.length" class="candidate-list">
      <article
        v-for="candidate in pending"
        :key="candidate.id"
        class="candidate-card"
      >
        <MediaTile
          :media="cover(candidate)"
          variant="cover"
          :label="candidate.title"
          :count="candidate.mediaIds.length"
          zoomable
        />
        <div class="candidate-meta">
          <div class="candidate-heading">
            <div>
              <h2>{{ candidate.title }}</h2>
              <p class="muted">
                {{ formatDate(candidate.capturedAt) }} ·
                {{ formatTime(candidate.capturedAt) }}
              </p>
            </div>
            <span class="pill">待你确认</span>
          </div>
          <p class="suggestion">
            <Sparkles :size="15" aria-hidden="true" />{{
              suggestion(candidate)
            }}
          </p>
          <p class="candidate-source">
            <span
              >来源：{{
                cover(candidate)?.name ?? "原始素材"
              }}<template v-if="candidate.mediaIds.length > 1">
                · 共 {{ candidate.mediaIds.length }} 张</template
              ></span
            >
            <template
              v-if="
                cover(candidate)?.kind === 'video' &&
                candidate.start !== undefined &&
                candidate.end !== undefined
              "
            >
              <span>
                · 片段 {{ durationLabel(candidate.start) }}–{{
                  durationLabel(candidate.end)
                }}</span
              >
            </template>
          </p>
          <p class="candidate-note">{{ candidate.note }}</p>
          <div class="candidate-actions">
            <button
              class="button button-primary"
              type="button"
              @click="emit('review', candidate)"
            >
              查看并确认
              <ArrowRight :size="16" aria-hidden="true" />
            </button>
            <button
              class="button button-ghost"
              type="button"
              @click="emit('dismiss', candidate.id)"
            >
              <X :size="15" aria-hidden="true" />
              这次不收录
            </button>
          </div>
          <div v-if="!isDemo(candidate)" class="ai-suggest">
            <label class="field"
              ><span>给 AI 一句话 <small>可选 · 只发送文字</small></span
              >              <input
                v-model="hints[candidate.id]"
                type="text"
                inputmode="text"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                maxlength="120"
                placeholder="例如：第一次一起晒太阳"
                :disabled="suggestingId === candidate.id"
              /></label>
            <div class="ai-suggest-actions">
              <button
                class="button button-secondary"
                type="button"
                :disabled="!aiAvailable || !!suggestingId"
                @click="emit('suggest', candidate, hints[candidate.id] ?? '')"
              >
                <Sparkles :size="15" aria-hidden="true" />{{
                  suggestingId === candidate.id ? "正在想…" : "AI 起个名字"
                }}
              </button>
              <span v-if="!aiAvailable" class="ai-off">
                还没配置 AI 服务，<button
                  class="link-button"
                  type="button"
                  @click="emit('openAiSettings')"
                >
                  去设置</button
                >
              </span>
            </div>
            <p class="fine-print left">
              只发送这一句话与文件名、拍摄时间；照片和视频原片不会上传。生成后仍是待确认草稿。
            </p>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><Check :size="27" aria-hidden="true" /></div>
      <h2>每个瞬间都有了归处</h2>
      <p>新的照片和视频，还会带来新的发现。</p>
      <button
        class="button button-secondary"
        type="button"
        @click="emit('add')"
      >
        继续记录
      </button>
    </div>
  </section>
</template>

<style scoped>
.inbox-page {
  display: grid;
  gap: 20px;
}
.page-lead {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 14px;
}
.privacy-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--sage);
  color: var(--sage-ink);
  font-size: 12px;
}
.candidate-list {
  display: grid;
  gap: 14px;
}
.candidate-card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.candidate-card :deep(.media-tile) {
  border-radius: 0;
}
.candidate-meta {
  display: grid;
  gap: 10px;
  padding: 15px;
}
.candidate-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.candidate-heading h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.candidate-heading .pill {
  flex: none;
}
.suggestion {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
}
.candidate-note {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
}
.candidate-source {
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.5;
}
.candidate-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.candidate-actions .button-primary {
  flex: 1;
  min-width: 132px;
}
.ai-suggest {
  display: grid;
  gap: 9px;
  margin-top: 3px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
}
.ai-suggest-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ai-off {
  color: var(--muted);
  font-size: var(--font-xs);
}
.link-button {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.fine-print.left {
  text-align: left;
}
.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 52px 20px;
  color: var(--muted);
  text-align: center;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 17px;
  background: var(--sage);
  color: var(--sage-ink);
}
.empty-state h2 {
  margin: 2px 0 0;
  color: var(--ink);
  font-size: 18px;
}
.empty-state p {
  margin: 0 0 9px;
  font-size: 13px;
}
@media (max-width: 380px) {
  .candidate-heading {
    display: grid;
    gap: 8px;
  }
  .candidate-heading .pill {
    justify-self: start;
  }
}
</style>
