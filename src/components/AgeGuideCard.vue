<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, BookOpen, PauseCircle, Sparkles } from "@lucide/vue";
import {
  AGE_GUIDES,
  guideForBaby,
  type AgeGuide,
  type ParentActivity,
} from "../data/age-guides";
import type { BabyProfile } from "../types";

const props = defineProps<{ baby: BabyProfile }>();
const emit = defineEmits<{ record: [activity: ParentActivity] }>();
const selectedId = ref("auto");
const GUIDE_OPEN_KEY = "babytime.ageGuideOpen";
const guideOpen = localStorage.getItem(GUIDE_OPEN_KEY) === "1";
function rememberOpen(event: Event) {
  localStorage.setItem(
    GUIDE_OPEN_KEY,
    (event.target as HTMLDetailsElement).open ? "1" : "0",
  );
}
const automatic = computed(() => guideForBaby(props.baby));
const selectedGuide = computed<AgeGuide>(() =>
  selectedId.value === "auto"
    ? automatic.value.guide
    : (AGE_GUIDES.find((guide) => guide.id === selectedId.value) ??
      automatic.value.guide),
);
const isManual = computed(() => selectedId.value !== "auto");

function resetToCurrent() {
  selectedId.value = "auto";
}
</script>

<template>
  <section class="age-guide" aria-labelledby="age-guide-title">
    <div class="guide-heading">
      <div>
        <p class="eyebrow">GROW WITH THEM</p>
        <h2 id="age-guide-title" class="section-heading">
          {{
            isManual
              ? "参考这个月龄"
              : automatic.age.valid
                ? "这个月龄，可以一起看看"
                : "先完善宝宝生日"
          }}
        </h2>
        <p class="muted">
          {{
            automatic.age.valid
              ? `${baby.name} · ${automatic.age.months} 个月 ${automatic.age.days} 天`
              : "填写生日后自动推荐，也可以手动查看参考内容。"
          }}
        </p>
      </div>
      <span class="pill guide-pill">{{
        automatic.age.valid || isManual ? selectedGuide.label : "待填写生日"
      }}</span>
    </div>

    <a
      v-if="!automatic.age.valid && !isManual"
      class="button button-secondary"
      href="#family"
      >填写宝宝出生日期</a
    >
    <details class="guide-more" :open="guideOpen" @toggle="rememberOpen">
    <summary>查看本月关注点与亲子活动</summary>
    <div class="guide-body">
    <label class="age-select-label" for="age-guide-select"
      >查看哪个参考月龄</label
    >
    <select
      id="age-guide-select"
      class="age-select"
      v-model="selectedId"
      aria-label="选择参考月龄"
    >
      <option value="auto">
        {{
          automatic.age.valid
            ? `按宝宝生日自动推荐（${automatic.guide.label}）`
            : "按宝宝生日自动推荐（请先填写生日）"
        }}
      </option>
      <option v-for="guide in AGE_GUIDES" :key="guide.id" :value="guide.id">
        手动查看：{{ guide.label }}
      </option>
    </select>
    <button
      v-if="isManual"
      type="button"
      class="current-link"
      @click="resetToCurrent"
    >
      回到自动推荐（{{ automatic.guide.label }}，不修改宝宝生日）
    </button>

    <template v-if="automatic.age.valid || isManual">
      <div class="guide-note">
        <Sparkles :size="18" aria-hidden="true" />
        <p>
          跟着宝宝的兴趣和状态来，累了就休息。对发育有疑问时，可以咨询儿科专业人员。
        </p>
      </div>

      <div class="focus-block">
        <div class="block-title">
          <BookOpen :size="17" aria-hidden="true" />
          <h3>可以留意</h3>
        </div>
        <ul>
          <li v-for="item in selectedGuide.focus" :key="item">{{ item }}</li>
        </ul>
      </div>

      <div class="activity-block">
        <div class="block-title">
          <Sparkles :size="17" aria-hidden="true" />
          <h3>今天可以一起玩</h3>
        </div>
        <article
          v-for="activity in selectedGuide.activities"
          :key="activity.id"
          class="activity-card"
        >
          <div class="activity-topline">
            <h4>{{ activity.title }}</h4>
            <span class="pill">亲子活动</span>
          </div>
          <ol>
            <li v-for="step in activity.steps" :key="step">{{ step }}</li>
          </ol>
          <p v-if="activity.why" class="activity-why">{{ activity.why }}</p>
          <div class="activity-footer">
            <span
              ><PauseCircle :size="14" aria-hidden="true" />{{
                activity.pauseWhen
              }}</span
            ><button
              class="button button-secondary"
              type="button"
              @click="emit('record', activity)"
            >
              记下这次互动 <ArrowRight :size="15" aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>

      <p class="guide-source">
        参考：<a
          :href="selectedGuide.sourceUrl"
          target="_blank"
          rel="noreferrer"
          >CDC Learn the Signs. Act Early.</a
        >
        · 核对于 {{ selectedGuide.checkedAt }} ·
        早产宝宝可按儿科医生建议选择参考月龄。
      </p>
    </template>
    </div>
    </details>
  </section>
</template>

<style scoped>
.guide-body {
  display: grid;
  gap: 19px;
}
.guide-more > summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--ink);
  font-size: 14px;
  list-style: none;
}
.guide-more > summary::-webkit-details-marker {
  display: none;
}
.guide-more > summary::after {
  content: "";
  width: 8px;
  height: 8px;
  margin: -3px 4px 0 auto;
  border-right: 1.6px solid var(--muted);
  border-bottom: 1.6px solid var(--muted);
  transform: rotate(45deg);
  transition: transform 0.2s;
}
.guide-more[open] > summary::after {
  margin-top: 3px;
  transform: rotate(-135deg);
}
.guide-more[open] > summary {
  margin-bottom: 19px;
}
.age-guide {
  display: grid;
  gap: 19px;
  margin-top: 28px;
  padding-top: 28px;
  border-top: 1px solid var(--line);
}
.guide-heading,
.activity-topline,
.activity-footer,
.block-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.guide-heading {
  align-items: flex-start;
}
.guide-pill {
  flex: none;
  width: fit-content;
  justify-self: start;
}
.age-select-label {
  color: var(--muted);
  font-size: 12px;
}
.age-select {
  width: 100%;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface);
  color: var(--ink);
  font-size: 16px;
}
.current-link {
  justify-self: start;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  padding: 0;
  min-height: 44px;
}
.guide-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px 13px;
  border-radius: 12px;
  background: var(--sage);
  color: var(--sage-ink);
  font-size: 12px;
  line-height: 1.7;
}
.guide-note svg {
  flex: none;
  margin-top: 2px;
}
.focus-block,
.activity-block {
  display: grid;
  gap: 11px;
}
.block-title {
  justify-content: flex-start;
  color: var(--accent);
}
.block-title h3 {
  font-size: 15px;
  font-weight: 600;
}
.focus-block ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 21px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.75;
}
.focus-block li::marker {
  color: var(--accent);
}
.activity-card {
  display: grid;
  gap: 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 15px;
  background: var(--surface);
}
.activity-topline {
  align-items: flex-start;
}
.activity-topline h4 {
  font-size: 15px;
  font-weight: 600;
}
.activity-topline .pill {
  font-size: var(--font-xs);
}
.activity-card ol {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.7;
}
.activity-card ol li::marker {
  color: var(--accent);
  font-weight: 600;
}
.activity-why {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.activity-footer {
  align-items: flex-end;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}
.activity-footer > span {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  max-width: 48%;
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.55;
}
.activity-footer > span svg {
  flex: none;
  margin-top: 2px;
}
.activity-footer .button {
  flex: none;
  min-height: 44px;
  padding-inline: 11px;
  font-size: 12px;
}
.guide-source {
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.7;
}
.guide-source a {
  color: var(--accent);
}
@media (max-width: 450px) {
  .guide-heading {
    display: grid;
    gap: 9px;
  }
  .activity-footer {
    align-items: stretch;
    display: grid;
  }
  .activity-footer > span {
    max-width: none;
  }
  .activity-footer .button {
    width: 100%;
  }
}
</style>
