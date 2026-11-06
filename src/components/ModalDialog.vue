<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from "vue";
import { X } from "@lucide/vue";

defineProps<{
  title: string;
  subtitle?: string;
  wide?: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const headingId = useId();
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog
    ref="dialog"
    :class="['modal', { 'modal-wide': wide }]"
    :aria-labelledby="headingId"
    @close="emit('close')"
    @cancel="busy && $event.preventDefault()"
  >
    <header class="modal-heading">
      <div>
        <p v-if="subtitle" class="eyebrow">{{ subtitle }}</p>
        <h2 :id="headingId">{{ title }}</h2>
      </div>
      <button
        class="icon-button"
        type="button"
        :disabled="busy"
        aria-label="关闭弹窗"
        @click="dialog?.close()"
      >
        <X :size="20" />
      </button>
    </header>
    <slot />
  </dialog>
</template>
