<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, Copy, Share2, Sparkles } from "@lucide/vue";
import {
  HANDOFF_SYSTEM_PROMPT,
  guardMedicalOutput,
  maskBabyName,
} from "../domain/ai";
import { numbersConsistent } from "../domain/handoff";
import { aiChat, aiErrorMessage } from "../lib/ai-service";

const props = defineProps<{
  summary: string;
  aiReady: boolean;
  /** 发送给模型前把摘要里的宝宝姓名替换成「宝宝」。 */
  babyName?: string;
}>();

const text = ref(props.summary);
const copied = ref(false);
const busy = ref(false);
const error = ref("");
const rewritten = computed(() => text.value !== props.summary);
const canShare = computed(
  () => typeof navigator !== "undefined" && Boolean(navigator.share),
);

watch(
  () => props.summary,
  (value) => {
    text.value = value;
    copied.value = false;
  },
);

async function copy() {
  error.value = "";
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2500);
  } catch {
    error.value = "当前浏览器不允许直接写剪贴板，请长按上面的文字复制。";
  }
}

async function share() {
  error.value = "";
  try {
    await navigator.share({ text: text.value });
  } catch {
    // 用户取消分享不算错误。
  }
}

async function polish() {
  if (busy.value || !props.aiReady) return;
  busy.value = true;
  error.value = "";
  try {
    const raw = await aiChat(
      HANDOFF_SYSTEM_PROMPT,
      maskBabyName(props.summary, props.babyName),
    );
    const guarded = guardMedicalOutput(raw).text.trim();
    // 数字对不上就整段丢弃，改用本机版本。
    if (!guarded || !numbersConsistent(guarded, props.summary)) {
      error.value = "AI 改写里出现了摘要里没有的数字，已保留本机版本。";
      return;
    }
    text.value = guarded.slice(0, 400);
  } catch (cause) {
    error.value = aiErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function restore() {
  text.value = props.summary;
  error.value = "";
}
</script>

<template>
  <section class="handoff" aria-labelledby="handoff-title">
    <div class="handoff-head">
      <div>
        <p class="eyebrow">HANDOFF</p>
        <h2 id="handoff-title">今日交接</h2>
        <p class="handoff-hint">
          一句话转给家人。只包含今天的记录，复制后可以自己再改。
        </p>
      </div>
    </div>
    <p class="handoff-text">{{ text }}</p>
    <div class="handoff-actions">
      <button class="button button-primary" type="button" @click="copy">
        <Check v-if="copied" :size="15" aria-hidden="true" />
        <Copy v-else :size="15" aria-hidden="true" />{{
          copied ? "已复制" : "复制摘要"
        }}
      </button>
      <button
        v-if="canShare"
        class="button button-secondary"
        type="button"
        @click="share"
      >
        <Share2 :size="15" aria-hidden="true" />分享
      </button>
      <button
        v-if="aiReady && !rewritten"
        class="button button-ghost"
        type="button"
        :disabled="busy"
        @click="polish"
      >
        <Sparkles :size="14" aria-hidden="true" />{{
          busy ? "正在改写…" : "让 AI 说得顺口些"
        }}
      </button>
      <button
        v-if="rewritten"
        class="button button-ghost"
        type="button"
        @click="restore"
      >
        恢复本机版本
      </button>
    </div>
    <p v-if="error" class="handoff-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.handoff {
  display: grid;
  gap: 10px;
  padding: 16px 15px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.handoff h2 {
  margin: 2px 0 4px;
  font-size: 15px;
  font-weight: 500;
}
.handoff-hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1.6;
}
.handoff-text {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.handoff-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.handoff-actions .button {
  min-height: 40px;
  font-size: 13px;
}
.handoff-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.6;
}
</style>
