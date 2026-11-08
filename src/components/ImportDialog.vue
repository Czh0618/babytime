<script setup lang="ts">
import { ref } from "vue";
import { ImagePlus, NotebookPen, ShieldCheck, Upload } from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";

defineProps<{ busy: boolean; progress: string; errors: string[]; warnings?: string[] }>();
const emit = defineEmits<{ close: []; import: [files: File[]]; manual: [] }>();
const input = ref<HTMLInputElement>();
const dragging = ref(false);
function choose(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || []);
  if (files.length) emit("import", files);
  if (input.value) input.value.value = "";
}
function drop(event: DragEvent) {
  dragging.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) emit("import", files);
}
</script>

<template>
  <ModalDialog
    title="记录今天的你"
    subtitle="KEEP A LITTLE TODAY"
    :busy="busy"
    @close="emit('close')"
  >
    <p class="modal-lead">从手机相册开始，留下想记住的平常日子。</p>
    <div
      :class="['upload-zone', { dragging }]"
      @dragover.prevent="!busy && (dragging = true)"
      @dragleave="dragging = false"
      @drop.prevent="!busy && drop($event)"
    >
      <div class="upload-symbol">
        <ImagePlus :size="27" :stroke-width="1.4" />
      </div>
      <h3>照片、视频，都可以</h3>
      <p class="muted">
        照片最多 9 张合为一条 · 视频各自成条<br />每次最多 20 个文件 · 单个不超过 100 MB · 短视频最长 2 分钟
      </p>
      <button
        class="button button-primary"
        type="button"
        :disabled="busy"
        @click="input?.click()"
      >
        <Upload :size="17" />{{ busy ? "正在保存素材…" : "选择手机素材" }}
      </button>
      <input
        ref="input"
        class="visually-hidden"
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.mov"
        aria-label="选择照片或视频"
        :disabled="busy"
        @change="choose"
      />
    </div>
    <p v-if="progress" class="progress-message" role="status">{{ progress }}</p>
    <div v-if="warnings?.length" class="warning-box" role="status">
      <p v-for="warning in warnings" :key="warning">{{ warning }}</p>
    </div>
    <div v-if="errors.length" class="error-box" role="alert">
      <strong>这些素材暂时没能保存：</strong>
      <p v-for="error in errors" :key="error">{{ error }}</p>
    </div>
    <div class="import-privacy">
      <ShieldCheck :size="18" />
      <p>
        开启多设备同步后，照片与缩略图会存到你自己的服务器，视频只保存在这台设备；没开启时全部只留在本机。记录时间默认取文件时间，可以在整理时修改；AI
        辅助只接收你写下的文字。
      </p>
    </div>
    <button
      class="button button-secondary full-width"
      type="button"
      :disabled="busy"
      @click="emit('manual')"
    >
      <NotebookPen :size="17" />先写下一段时光
    </button>
    <p class="fine-print">
      AI 起名与文案在「待整理」里按需点击，不会自动分析你的照片和视频。
    </p>
  </ModalDialog>
</template>

<style scoped>
.upload-zone {
  display: grid;
  justify-items: center;
  gap: 15px;
  padding: 27px 16px;
  border: 1px dashed var(--line);
  border-radius: 20px;
  background: var(--bg);
  text-align: center;
  margin: 24px 0 16px;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.upload-zone.dragging {
  background: var(--sage);
  border-color: var(--sage-ink);
}
.upload-symbol {
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  border-radius: 20px;
  background: var(--tint);
  color: var(--accent);
}
.upload-zone h3 {
  font-size: 18px;
  font-weight: 500;
}
.upload-zone .button {
  margin-top: 4px;
}
.import-privacy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 19px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.import-privacy svg {
  flex: none;
  color: var(--sage-ink);
  margin-top: 2px;
}
.progress-message {
  color: var(--sage-ink);
  font-size: 13px;
}
.error-box p {
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.warning-box {
  padding: 10px 12px;
  margin: 12px 0;
  border-radius: 11px;
  background: var(--tint);
  color: var(--accent);
  font-size: 13px;
  line-height: 1.7;
}
.warning-box p {
  margin: 0;
}
</style>
