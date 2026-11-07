<script setup lang="ts">
import { Mic } from "@lucide/vue";

const emit = defineEmits<{ voice: []; demo: []; dismiss: [] }>();
</script>

<template>
  <section class="first-run" aria-labelledby="first-run-heading">
    <p class="eyebrow">开始用</p>
    <h2 id="first-run-heading">先说一句，比打字快</h2>
    <p class="first-run-copy">
      像“下午三点喂了九十毫升奶，四点换了尿布”这样说一句，会整理成几条草稿，由你确认后保存。
    </p>
    <div class="first-run-actions">
      <button class="button button-primary" type="button" @click="emit('voice')">
        <Mic :size="16" aria-hidden="true" />说一句
      </button>
      <button class="button button-secondary" type="button" @click="emit('demo')">
        先看看示例
      </button>
    </div>
    <button class="first-run-dismiss" type="button" @click="emit('dismiss')">
      不用引导，我自己记
    </button>
    <p class="first-run-note">示例随时可以加载或清除，不会混进你的真实记录。</p>
  </section>
</template>

<style scoped>
.first-run {
  display: grid;
  gap: 10px;
  padding: 20px 18px;
  border-radius: var(--radius);
  background: var(--tint);
}
.first-run h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 500;
}
.first-run-copy,
.first-run-note {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.first-run-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.first-run-actions .button {
  flex: 1 1 auto;
  min-width: 118px;
}
.first-run-dismiss {
  justify-self: start;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--font-xs);
  text-decoration: underline;
  cursor: pointer;
}
.first-run-note {
  font-size: 12px;
}
</style>
