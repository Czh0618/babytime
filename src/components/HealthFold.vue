<script setup lang="ts">
/**
 * 健康页的统一折叠卡片：每张功能卡默认收起，只露标题 + 一句状态，
 * 点标题展开内容。不持久化展开状态，回到健康页时重新收起，避免页面越用越乱。
 */
withDefaults(
  defineProps<{
    title: string;
    /** 收起时显示的一行概要，让家长不用展开就知道该看哪张卡。 */
    hint?: string;
    /** 右侧的状态徽标，例如「8 剂待办」。 */
    badge?: string;
    /** 有待办时给一点视觉强调。 */
    attention?: boolean;
  }>(),
  { hint: "", badge: "", attention: false },
);
</script>

<template>
  <details class="health-fold" :class="{ attention }">
    <summary class="fold-summary">
      <span class="fold-title">{{ title }}</span>
      <span v-if="badge" class="fold-badge">{{ badge }}</span>
      <span class="fold-chevron" aria-hidden="true"></span>
      <span v-if="hint" class="fold-hint">{{ hint }}</span>
    </summary>
    <div class="fold-body"><slot /></div>
  </details>
</template>

<style scoped>
.health-fold {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(74, 52, 30, 0.045);
  overflow: hidden;
}
.health-fold.attention {
  border-color: color-mix(in srgb, var(--danger) 38%, var(--line));
}
.fold-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 12px;
  grid-template-areas:
    "title badge arrow"
    "hint hint hint";
  align-items: center;
  column-gap: 10px;
  row-gap: 3px;
  min-height: 56px;
  padding: 12px 16px;
  list-style: none;
  cursor: pointer;
  color: var(--ink);
}
.fold-summary::-webkit-details-marker {
  display: none;
}
.fold-summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.fold-title {
  grid-area: title;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.fold-badge {
  grid-area: badge;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--tint);
  color: var(--muted);
  white-space: nowrap;
  font-size: var(--font-xs);
}
.attention .fold-badge {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}
.fold-chevron {
  grid-area: arrow;
  width: 8px;
  height: 8px;
  border-right: 1.6px solid var(--muted);
  border-bottom: 1.6px solid var(--muted);
  transform: rotate(45deg);
  transition: transform 0.2s;
}
.health-fold[open] .fold-chevron {
  transform: rotate(-135deg);
}
.fold-hint {
  grid-area: hint;
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.fold-body {
  border-top: 1px solid var(--line);
  padding: 0 16px 16px;
}
/* 子组件自带卡片内边距，折进外层后统一压掉，避免双重留白。 */
:deep(.fold-body > section) {
  padding: 14px 0 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
@media print {
  .health-fold {
    break-inside: avoid;
  }
}
</style>
