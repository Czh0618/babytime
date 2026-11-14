<script setup lang="ts">
import { computed, ref } from "vue";
import type { BabyProfile } from "../types";
import {
  REGRESSION_KEY,
  REGRESSION_LABEL,
  WARNING_SIGNS_COPY,
  WARNING_SIGNS_SOURCE,
  WARNING_SIGNS_SOURCE_URL,
  WARNING_SIGN_CHECKPOINTS,
} from "../data/warning-signs-cn";
import {
  hasObservedWarning,
  toggleWarningSign,
  warningCheckpointForBaby,
  warningSignKey,
} from "../domain/warning-signs";

const props = defineProps<{
  baby: BabyProfile;
  signs: Record<string, string>;
  busy: boolean;
  /** 折进健康页的统一卡片时隐藏自己的标题行。 */
  embedded?: boolean;
}>();
const emit = defineEmits<{ save: [signs: Record<string, string>] }>();

const selectedId = ref("auto");
const automatic = computed(() => warningCheckpointForBaby(props.baby));
const checkpoint = computed(() =>
  selectedId.value === "auto"
    ? automatic.value.checkpoint
    : WARNING_SIGN_CHECKPOINTS.find((item) => item.id === selectedId.value),
);
const adviceVisible = computed(() => hasObservedWarning(props.signs));

function toggle(key: string) {
  emit("save", toggleWarningSign(props.signs, key));
}
</script>

<template>
  <section class="warning-card surface" aria-labelledby="warning-signs-heading">
    <h2 v-if="embedded" id="warning-signs-heading" class="visually-hidden">
      {{ WARNING_SIGNS_COPY.title }}
    </h2>
    <header v-else class="warning-head">
      <div>
        <h2 id="warning-signs-heading" class="section-heading">
          {{ WARNING_SIGNS_COPY.title }}
        </h2>
        <p class="muted">{{ WARNING_SIGNS_COPY.intro }}</p>
      </div>
      <span class="warning-pill">建议评估</span>
    </header>

    <label class="field warning-select">
      <span>查看哪个检查点</span>
      <select v-model="selectedId" aria-label="选择发育观察检查点">
        <option value="auto">
          按宝宝月龄自动（{{
            automatic.checkpoint ? automatic.checkpoint.label : "未满 3 月龄"
          }}）
        </option>
        <option v-for="item in WARNING_SIGN_CHECKPOINTS" :key="item.id" :value="item.id">
          {{ item.label }}
        </option>
      </select>
    </label>
    <p class="muted warning-hint">{{ WARNING_SIGNS_COPY.checkpointHint }}</p>

    <p v-if="!checkpoint" class="empty-hint">{{ WARNING_SIGNS_COPY.belowFirst }}</p>
    <ul v-else class="warning-list">
      <li v-for="(text, index) in checkpoint.signs" :key="warningSignKey(checkpoint.id, index)">
        <label class="warning-check">
          <input
            type="checkbox"
            :checked="Boolean(signs[warningSignKey(checkpoint.id, index)])"
            :disabled="busy"
            @change="toggle(warningSignKey(checkpoint.id, index))"
          />
          <span>{{ text }}</span>
        </label>
      </li>
    </ul>

    <div class="warning-regression">
      <label class="warning-check">
        <input
          type="checkbox"
          :checked="Boolean(signs[REGRESSION_KEY])"
          :disabled="busy"
          @change="toggle(REGRESSION_KEY)"
        />
        <span>{{ REGRESSION_LABEL }}</span>
      </label>
      <p class="muted warning-hint">{{ WARNING_SIGNS_COPY.regressionNote }}</p>
    </div>

    <p v-if="adviceVisible" class="warning-advice" role="status">
      {{ WARNING_SIGNS_COPY.advice }}
    </p>
    <p class="warning-note">{{ WARNING_SIGNS_COPY.footnote }}</p>
    <p class="warning-note">
      来源：<a :href="WARNING_SIGNS_SOURCE_URL" target="_blank" rel="noreferrer">{{
        WARNING_SIGNS_SOURCE
      }}</a>
    </p>
  </section>
</template>

<style scoped>
.warning-card {
  display: grid;
  gap: 12px;
  padding: 18px 16px;
}
.warning-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.warning-head h2 {
  margin: 0 0 4px;
}
.warning-pill {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--tint);
  color: var(--muted);
  font-size: var(--font-xs);
  white-space: nowrap;
}
.warning-select {
  max-width: 100%;
}
.warning-select select {
  width: 100%;
  min-width: 0;
}
.warning-hint,
.warning-note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.warning-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.warning-list li {
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.warning-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  font-size: 13px;
  line-height: 1.7;
  cursor: pointer;
}
.warning-check input {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 3px;
}
.warning-check span {
  min-width: 0;
}
.warning-regression {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--tint);
}
.warning-advice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.7;
}
.empty-hint {
  margin: 0;
  padding: 10px 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
</style>
