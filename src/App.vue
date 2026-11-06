<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import {
  Clapperboard,
  HardDrive,
  House,
  LockKeyhole,
  NotebookPen,
  Mic,
  Plus,
  Sparkles,
} from "@lucide/vue";
import TimeView from "./views/TimeView.vue";
import InboxView from "./views/InboxView.vue";
import RecapView from "./views/RecapView.vue";
import FamilyView from "./views/FamilyView.vue";
import ImportDialog from "./components/ImportDialog.vue";
import EntryEditor from "./components/EntryEditor.vue";
import EntryDetail from "./components/EntryDetail.vue";
import RecapPreview from "./components/RecapPreview.vue";
import ModalDialog from "./components/ModalDialog.vue";
import VoiceEntryDialog from "./components/VoiceEntryDialog.vue";
import VoiceEntryCard from "./components/VoiceEntryCard.vue";
import AiSettingsDialog from "./components/AiSettingsDialog.vue";
import TodayCareSummary from "./components/TodayCareSummary.vue";
import AgeGuideCard from "./components/AgeGuideCard.vue";
import type { ParentActivity } from "./data/age-guides";
import type { VoiceDraft } from "./domain/care-types";
import { localDateTime } from "./domain/date";
import { useWorkspace } from "./lib/workspace";
import {
  aiAvailable,
  aiChat,
  aiErrorMessage,
  refreshAIStatus,
} from "./lib/ai-service";
import {
  CAPTION_SYSTEM_PROMPT,
  buildCaptionUserPrompt,
  parseAICaption,
} from "./domain/ai";
import { exportRecap, exportRecords } from "./lib/export";
import type { PreparedMedia } from "./lib/media";
import type {
  Candidate,
  EntryDraft,
  GrowthEntry,
  MediaAsset,
  Recap,
  RecapDraft,
  Tab,
} from "./types";

type Overlay =
  | { kind: "import" }
  | { kind: "voice" }
  | {
      kind: "editor";
      candidate?: Candidate;
      entry?: GrowthEntry;
      initialDraft?: EntryDraft;
    }
  | { kind: "detail"; id: string }
  | { kind: "recap"; id: string }
  | { kind: "aiSettings" }
  | {
      kind: "confirm";
      title: string;
      description: string;
      originalOption?: boolean;
      confirmLabel?: string;
      success?: string;
      action: () => Promise<void>;
    };

const model = useWorkspace();
const {
  workspace,
  loading,
  storageError,
  importing,
  importProgress,
  pending,
  hasDemo,
  stats,
} = model;
const tabs = [
  { id: "time", name: "今天", icon: NotebookPen },
  { id: "inbox", name: "待整理", icon: Sparkles },
  { id: "recap", name: "回顾", icon: Clapperboard },
  { id: "family", name: "家庭", icon: House },
] as const;
const currentTab = () =>
  tabs.some((tab) => tab.id === location.hash.slice(1))
    ? (location.hash.slice(1) as Tab)
    : "time";
const tab = ref<Tab>(currentTab());
const overlay = shallowRef<Overlay | null>(null);
const operations = ref(0);
const busy = computed(() => operations.value > 0 || importing.value);
const notice = ref("");
const failed = ref(false);
const formError = ref("");
const importErrors = ref<string[]>([]);
const originalChoice = ref(false);
const suggestingId = ref("");
const aiReady = computed(() => aiAvailable());
const detail = computed(() => {
  const current = overlay.value;
  return current?.kind === "detail"
    ? workspace.value.entries.find((entry) => entry.id === current.id)
    : undefined;
});
const recap = computed(() => {
  const current = overlay.value;
  return current?.kind === "recap"
    ? workspace.value.recaps.find((item) => item.id === current.id)
    : undefined;
});
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function say(message: string, error = false) {
  notice.value = message;
  failed.value = error;
  clearTimeout(toastTimer);
  if (!error)
    toastTimer = setTimeout(() => {
      notice.value = "";
    }, 5500);
}

async function perform(action: () => Promise<unknown>, success = "") {
  operations.value++;
  formError.value = "";
  try {
    await action();
    if (success) say(success);
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "这次没能保存，请再试一次。";
    formError.value = message;
    say(message, true);
    return false;
  } finally {
    operations.value--;
  }
}

function navigate(destination: Tab) {
  if (tab.value !== destination) location.hash = destination;
  tab.value = destination;
}
function onHashChange() {
  tab.value = currentTab();
  overlay.value = null;
  formError.value = "";
}
function openImport() {
  importErrors.value = [];
  formError.value = "";
  overlay.value = { kind: "import" };
}
function openVoice() {
  formError.value = "";
  overlay.value = { kind: "voice" };
}
function openActivity(activity: ParentActivity) {
  formError.value = "";
  overlay.value = {
    kind: "editor",
    initialDraft: {
      title: activity.title,
      note: "",
      capturedAt: localDateTime(),
      tag: "亲子互动",
      milestone: false,
      activityId: activity.id,
    },
  };
}
function openReview(candidate: Candidate) {
  formError.value = "";
  overlay.value = { kind: "editor", candidate };
}
function mediaFor(id?: string): MediaAsset | undefined {
  return workspace.value.media.find((media) => media.id === id);
}

function openAiSettings() {
  formError.value = "";
  overlay.value = { kind: "aiSettings" };
}

/** 给待整理候选生成文案建议：只发送文字元信息，结果仍等家长确认。 */
async function suggestCaption(candidate: Candidate, hint: string) {
  if (suggestingId.value) return;
  const media = mediaFor(candidate.mediaId);
  suggestingId.value = candidate.id;
  operations.value++;
  try {
    const raw = await aiChat(
      CAPTION_SYSTEM_PROMPT,
      buildCaptionUserPrompt({
        fileName: media?.name ?? "原始素材",
        kind: media?.kind ?? "image",
        capturedAt: candidate.capturedAt,
        duration: media?.duration,
        hint,
      }),
    );
    const caption = parseAICaption(raw);
    await model.applyCandidateSuggestion(candidate.id, caption);
    say("AI 起好了名字，确认前还可以改。");
  } catch (error) {
    say(aiErrorMessage(error), true);
  } finally {
    operations.value--;
    suggestingId.value = "";
  }
}

async function importFiles(files: File[]) {
  importErrors.value = [];
  try {
    const result = await model.importFiles(files);
    importErrors.value = result.errors;
    if (result.count) {
      navigate("inbox");
      say(`已在本机保存 ${result.count} 个素材，等你来整理。`);
      if (!result.errors.length) overlay.value = null;
    }
  } catch (error) {
    importErrors.value = [
      error instanceof Error ? error.message : "素材暂时没能保存。",
    ];
  }
}

async function saveEntry(draft: EntryDraft, upload?: PreparedMedia) {
  const current = overlay.value;
  if (current?.kind !== "editor") return;
  if (
    await perform(
      () => model.saveEntry(draft, current.candidate, current.entry, upload),
      "已收进成长时光，你的修改已保留。",
    )
  ) {
    overlay.value = null;
    navigate("time");
  }
}

async function saveVoice(drafts: VoiceDraft[], batchId: string) {
  let count = 0;
  if (
    await perform(async () => {
      count = await model.saveVoiceEntries(drafts, batchId);
    })
  ) {
    overlay.value = null;
    navigate("time");
    say(count ? `已保存 ${count} 条照护记录。` : "这批照护记录已经保存。");
  }
}

async function createRecap(draft: RecapDraft) {
  let saved: Recap | undefined;
  if (
    await perform(async () => {
      saved = await model.createRecap(draft);
    }, "图文回顾已保存在本机。")
  )
    overlay.value = { kind: "recap", id: saved!.id };
}

function askDelete(entry: GrowthEntry) {
  originalChoice.value = false;
  overlay.value = {
    kind: "confirm",
    title: "删除这条成长记录？",
    description:
      "删除后会从时间轴和引用它的回顾中移除。默认保留原片；也可以一并删除这段素材及相关记录。",
    originalOption: Boolean(entry.mediaId),
    action: () => model.deleteEntry(entry, originalChoice.value),
  };
}

function askClear() {
  originalChoice.value = false;
  overlay.value = {
    kind: "confirm",
    title: "清空本机的全部时光？",
    description:
      "这会删除当前浏览器里的宝宝资料、原片、成长记录和回顾，无法撤销。建议先在上方导出备份 JSON。",
    action: async () => {
      await model.reset();
      navigate("time");
    },
  };
}

function askRestore(file: File) {
  overlay.value = {
    kind: "confirm",
    title: "用备份覆盖当前记录？",
    description:
      "当前的宝宝资料、成长记录和回顾会被备份内容替换，无法撤销。如需保留，请先导出。",
    confirmLabel: "确认恢复",
    success: "",
    action: async () => {
      const missing = await model.restore(file);
      say(
        missing
          ? `已恢复记录，有 ${missing} 个素材缺少原片。可在记录的“编辑记录”中补回照片或视频。`
          : "已从备份恢复记录和原片。",
      );
      navigate("time");
    },
  };
}

async function downloadBackup() {
  await perform(async () => {
    const missing = await exportRecords(workspace.value);
    say(
      missing
        ? `已导出备份，但有 ${missing} 个素材缺少原片，未包含在文件中。请补回原片后重新备份。`
        : "已准备备份 JSON，包含记录和本机原片。",
      missing > 0,
    );
  });
}

function askDeleteRecap(id: string) {
  overlay.value = {
    kind: "confirm",
    title: "删除这份回顾？",
    description: "只删除这份回顾，成长记录和原片会保留。",
    action: () => model.deleteRecap(id),
  };
}

async function confirmAction() {
  const current = overlay.value;
  if (
    current?.kind === "confirm" &&
    (await perform(current.action, current.success ?? "已完成清理。"))
  )
    overlay.value = null;
}

onMounted(() => {
  window.addEventListener("hashchange", onHashChange);
  refreshAIStatus();
  void model.load();
});
onBeforeUnmount(() => {
  window.removeEventListener("hashchange", onHashChange);
  clearTimeout(toastTimer);
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <header class="brand">
        <a href="#time" class="wordmark" aria-label="BabyTime 宝宝时光首页"
          >babytime<span>宝宝时光</span></a
        ><button
          v-if="tab !== 'time'"
          class="button button-secondary mobile-record"
          type="button"
          :disabled="loading || busy || !!storageError"
          @click="openVoice"
        >
          <Mic :size="16" />语音记录
        </button>
        <button
          class="icon-button mobile-import"
          type="button"
          aria-label="导入照片或写文字"
          :disabled="loading || busy || !!storageError"
          @click="openImport"
        >
          <Plus :size="19" />
        </button>
      </header>
      <p class="desktop-subtitle">开口记下日常，<br />一起陪伴每一点长大。</p>
      <nav class="app-nav" aria-label="主导航">
        <a
          v-for="item in tabs"
          :key="item.id"
          :href="`#${item.id}`"
          :aria-current="tab === item.id ? 'page' : undefined"
          ><component :is="item.icon" :size="20" :stroke-width="1.6" /><span>{{
            item.name
          }}</span
          ><span
            v-if="item.id === 'inbox' && pending.length"
            class="nav-count"
            >{{ pending.length }}</span
          ></a
        >
      </nav>
      <button
        class="button button-primary sidebar-add"
        type="button"
        :disabled="loading || busy || !!storageError"
        @click="openVoice"
      >
        <Mic :size="17" />说一句记下来
      </button>
      <button
        class="button button-secondary sidebar-import"
        type="button"
        :disabled="loading || busy || !!storageError"
        @click="openImport"
      >
        <Plus :size="16" />照片或文字
      </button>
      <div class="sidebar-foot">
        <span><HardDrive :size="14" />仅保存在当前浏览器</span
        ><span><LockKeyhole :size="14" />素材不自动上传</span>
        <p>日子慢慢过，<br />你在悄悄长大。</p>
      </div>
    </aside>
    <main class="content" id="main-content">
      <div v-if="loading" class="loading-state">
        <span class="wordmark">babytime</span>
        <p>正在打开这本成长手记…</p>
      </div>
      <template v-else>
        <div v-if="storageError" class="error-box" role="alert">
          <strong>暂时无法使用本机存储</strong>
          <p>{{ storageError }}</p>
          <p>已有内容未被改动，请允许浏览器存储后刷新页面。</p>
        </div>
        <div v-if="hasDemo && tab !== 'family'" class="demo-banner">
          <span>当前包含示例记录，不是真实宝宝影像。</span
          ><button type="button" @click="navigate('family')">
            管理示例 <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div
          v-if="notice"
          :class="['toast', { error: failed }]"
          :role="failed ? 'alert' : 'status'"
        >
          {{ notice }}
        </div>
        <TimeView
          v-if="tab === 'time'"
          :baby="workspace.baby"
          :entries="workspace.entries"
          :media="workspace.media"
          :pending-count="pending.length"
          @add="openImport"
          @demo="perform(model.loadDemo, '已加载示例，可随时在家庭页清除。')"
          @review="navigate('inbox')"
          @favorite="(id) => perform(() => model.toggleFavorite(id))"
          @open="(entry) => (overlay = { kind: 'detail', id: entry.id })"
        >
          <template #today>
            <VoiceEntryCard @start="openVoice" />
            <TodayCareSummary
              :entries="workspace.entries"
              @voice="openVoice"
              @open="(entry) => (overlay = { kind: 'detail', id: entry.id })"
            />
            <AgeGuideCard :baby="workspace.baby" @record="openActivity" />
          </template>
        </TimeView>
        <InboxView
          v-else-if="tab === 'inbox'"
          :candidates="pending"
          :media="workspace.media"
          :ai-available="aiReady"
          :suggesting-id="suggestingId"
          @add="openImport"
          @review="openReview"
          @suggest="suggestCaption"
          @open-ai-settings="openAiSettings"
          @dismiss="
            (id) =>
              perform(() => model.dismiss(id), '这次不收录，原片仍保存在本机。')
          "
        />
        <RecapView
          v-else-if="tab === 'recap'"
          :entries="workspace.entries"
          :media="workspace.media"
          :recaps="workspace.recaps"
          :busy="busy"
          :error="formError"
          @create="createRecap"
          @open="(item) => (overlay = { kind: 'recap', id: item.id })"
          @download="
            (item) =>
              perform(
                () => exportRecap(item, workspace),
                '图文回顾已准备下载。',
              )
          "
          @remove="askDeleteRecap"
        />
        <FamilyView
          v-else
          :baby="workspace.baby"
          :stats="stats"
          :has-demo="hasDemo"
          :busy="busy"
          @save="
            (baby) => perform(() => model.saveProfile(baby), '宝宝资料已保存。')
          "
          @clear-demo="
            perform(model.clearDemo, '已移除示例，真实记录仍然保留。')
          "
          @clear-data="askClear"
          @restore-data="askRestore"
          @export-data="downloadBackup"
          @open-ai-settings="openAiSettings"
        />
      </template>
    </main>
    <ImportDialog
      v-if="overlay?.kind === 'import'"
      :busy="busy"
      :progress="importProgress"
      :errors="importErrors"
      @close="overlay = null"
      @import="importFiles"
      @manual="overlay = { kind: 'editor' }"
    />
    <VoiceEntryDialog
      v-if="overlay?.kind === 'voice'"
      :busy="busy"
      :error="formError"
      @close="overlay = null"
      @save="saveVoice"
    />
    <AiSettingsDialog
      v-if="overlay?.kind === 'aiSettings'"
      @close="overlay = null"
      @saved="say('AI 服务已保存在本机，可以开始使用了。')"
    />
    <EntryEditor
      v-if="overlay?.kind === 'editor'"
      :candidate="overlay.candidate"
      :entry="overlay.entry"
      :initial-draft="overlay.initialDraft"
      :media="mediaFor(overlay.candidate?.mediaId || overlay.entry?.mediaId)"
      :busy="busy"
      :save-error="formError"
      @close="overlay = null"
      @save="saveEntry"
    />
    <EntryDetail
      v-if="overlay?.kind === 'detail' && detail"
      :entry="detail"
      :media="mediaFor(detail.mediaId)"
      :busy="busy"
      @close="overlay = null"
      @edit="
        formError = '';
        overlay = { kind: 'editor', entry: detail };
      "
      @favorite="perform(() => model.toggleFavorite(detail!.id))"
      @remove="askDelete(detail)"
    />
    <RecapPreview
      v-if="overlay?.kind === 'recap' && recap"
      :recap="recap"
      :entries="workspace.entries"
      :media="workspace.media"
      :baby-name="workspace.baby.name"
      :busy="busy"
      :error="formError"
      @close="overlay = null"
      @download="
        perform(() => exportRecap(recap!, workspace), '图文回顾已准备下载。')
      "
    />
    <ModalDialog
      v-if="overlay?.kind === 'confirm'"
      :title="overlay.title"
      :busy="busy"
      @close="overlay = null"
      ><p class="confirm-copy">{{ overlay.description }}</p>
      <label v-if="overlay.originalOption" class="check-field"
        ><input
          v-model="originalChoice"
          type="checkbox"
        />同时删除原片与关联记录</label
      >
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="confirm-actions">
        <button
          class="button button-secondary"
          type="button"
          :disabled="busy"
          @click="overlay = null"
        >
          先保留</button
        ><button
          class="button button-danger"
          type="button"
          :disabled="busy"
          @click="confirmAction"
        >
          {{ busy ? "正在处理…" : (overlay.confirmLabel ?? "确认删除") }}
        </button>
      </div></ModalDialog
    >
  </div>
</template>
