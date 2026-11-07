<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check,
  Mic,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
} from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";
import {
  CARE_LABELS,
  SITE_LABELS,
  type CareKind,
  type VoiceDraft,
} from "../domain/care-types";
import { localDateTime } from "../domain/date";
import { describeCare } from "../domain/care-records";
import { VACCINES_2026 } from "../data/vaccines-2026";
import { createId } from "../domain/id";
import {
  getBrowserSpeechAvailability,
  createBrowserSpeech,
  type BrowserSpeechError,
} from "../lib/browser-speech";
import {
  parseVoiceTranscript,
  validateVoiceDraft,
} from "../domain/voice-parser";
import {
  VOICE_SYSTEM_PROMPT,
  buildVoiceUserPrompt,
  parseAIVoiceDrafts,
} from "../domain/ai";
import {
  aiAvailable,
  aiChat,
  aiErrorMessage,
  aiStatus,
} from "../lib/ai-service";

const props = defineProps<{ busy: boolean; error?: string }>();
const emit = defineEmits<{
  close: [];
  save: [drafts: VoiceDraft[], batchId: string];
}>();

const batchId = createId();
const transcript = ref("");
const interim = ref("");
const parsedSource = ref("");
const drafts = ref<VoiceDraft[]>([]);
const listening = ref(false);
const stopping = ref(false);
const starting = ref(false);
const elapsed = ref(0);
const status = ref<"idle" | "listening" | "stopped">("idle");
const feedback = ref("");
const textError = ref("");
const aiBusy = ref(false);
const aiError = ref("");
const aiUsed = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let speech: ReturnType<typeof createBrowserSpeech>;
let aiController: AbortController | undefined;

const availability = getBrowserSpeechAvailability();
const supported = availability === "available";
const aiReady = computed(() => aiAvailable());
const aiModel = computed(() => aiStatus.value.model);
const canParse = computed(
  () =>
    transcript.value.trim().length > 0 &&
    !listening.value &&
    !stopping.value &&
    !starting.value &&
    !aiBusy.value,
);
const canSave = computed(
  () =>
    drafts.value.length > 0 &&
    !props.busy &&
    !aiBusy.value &&
    !listening.value &&
    !stopping.value &&
    !starting.value &&
    drafts.value.every((draft) => !validateVoiceDraft(draft)),
);
const displayText = computed(() =>
  `${transcript.value}${interim.value}`.trim(),
);

function errorMessage(error: BrowserSpeechError): string {
  return (
    {
      "not-allowed": "浏览器没有授予麦克风权限，请在地址栏设置中允许后再试。",
      "service-not-allowed":
        "当前浏览器不允许使用语音服务，请改用 Safari 或 Chrome。",
      "no-speech": "没有听到清晰的人声，可以再说一次。",
      network: "语音服务连接失败；录音内容没有被 BabyTime 保存。",
      "audio-capture": "没有找到可用的麦克风，请检查系统权限和设备。",
      aborted: "语音输入已停止。",
      "language-not-supported": "当前浏览器暂不支持中文语音识别。",
      unknown: "语音识别暂时不可用，可以直接编辑下面的文字。",
    }[error] ?? "语音识别暂时不可用，可以直接编辑下面的文字。"
  );
}

function beginTimer() {
  elapsed.value = 0;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    elapsed.value += 1;
    if (elapsed.value >= 60) stopListening();
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function startListening() {
  if (stopping.value || starting.value) return;
  feedback.value = "";
  textError.value = "";
  interim.value = "";
  starting.value = true;
  stopTimer();
  elapsed.value = 0;
  speech?.destroy();
  speech = createBrowserSpeech({
    onText: (text, isFinal) => {
      if (isFinal) {
        transcript.value += text;
        interim.value = "";
      } else interim.value = text;
    },
    onState: (next) => {
      status.value = next === "listening" ? "listening" : "stopped";
      listening.value = next === "listening";
      if (next === "listening") {
        starting.value = false;
        // Start the 60-second window only after the browser grants the
        // microphone and emits `start`; an automatic continuation keeps it.
        if (!timer) beginTimer();
      }
      if (next === "stopped") {
        starting.value = false;
        stopping.value = false;
        stopTimer();
        interim.value = "";
      }
    },
    onError: (error) => {
      starting.value = false;
      feedback.value = errorMessage(error);
      if (error !== "aborted") abortListening();
    },
  });
  if (!speech) {
    starting.value = false;
    feedback.value =
      "这个浏览器没有可用的中文语音识别，可以使用手机键盘语音后编辑文字。";
    return;
  }
  try {
    speech.start();
  } catch {
    starting.value = false;
    feedback.value = "无法开始语音识别，可以直接编辑下面的文字。";
  }
}

function stopListening() {
  if (!speech || stopping.value || !listening.value) return;
  stopping.value = true;
  feedback.value = "正在收尾最后一句…";
  stopTimer();
  speech.stop();
  window.setTimeout(() => {
    if (stopping.value) speech?.abort();
  }, 1200);
}

function abortListening() {
  if (!speech) return;
  starting.value = false;
  stopping.value = true;
  listening.value = false;
  stopTimer();
  speech.abort();
}

function stopWhenHidden() {
  if (!document.hidden || (!listening.value && !starting.value)) return;
  // Keep transcript and interim final text; only terminate the browser service.
  speech?.abort();
  listening.value = false;
  stopping.value = true;
  starting.value = false;
  status.value = "stopped";
  stopTimer();
  interim.value = "";
  feedback.value = "页面已隐藏，语音输入已停止；已识别文字仍保留。";
}

function parseText() {
  if (!canParse.value) return;
  textError.value = "";
  aiError.value = "";
  aiUsed.value = false;
  const next = parseVoiceTranscript(transcript.value);
  drafts.value = next;
  parsedSource.value = transcript.value;
  if (!next.length)
    textError.value =
      "没有整理出明确事件，可以继续编辑原话，或保存为日常备注。";
}

/** AI 只负责把原话拆成草稿，落库前仍要家长逐条确认。 */
async function parseWithAI() {
  if (!canParse.value || aiBusy.value || !aiReady.value) return;
  textError.value = "";
  aiError.value = "";
  const source = transcript.value;
  aiBusy.value = true;
  aiController = new AbortController();
  try {
    const raw = await aiChat(
      VOICE_SYSTEM_PROMPT,
      buildVoiceUserPrompt(source),
      aiController.signal,
    );
    const next = parseAIVoiceDrafts(raw, source);
    drafts.value = next;
    parsedSource.value = source;
    aiUsed.value = true;
  } catch (error) {
    aiError.value = aiErrorMessage(error);
  } finally {
    aiController = undefined;
    aiBusy.value = false;
  }
}

/** 把识别出的细分字段用与记录详情一致的措辞展示，方便家长核对。 */
function draftExtras(draft: VoiceDraft): string {
  if (
    !draft.feedingMethod &&
    !draft.food &&
    !draft.reaction &&
    !draft.feedingMinutes &&
    !draft.leftMinutes &&
    !draft.rightMinutes &&
    draft.temperatureC === undefined &&
    !draft.medicineName &&
    !draft.vaccineName
  )
    return "";
  return describeCare({
    kind: draft.kind,
    amountMl: draft.amountMl,
    sourceText: draft.sourceText,
    feedingMethod: draft.feedingMethod,
    breastSide: draft.breastSide,
    leftMinutes: draft.leftMinutes,
    rightMinutes: draft.rightMinutes,
    feedingMinutes: draft.feedingMinutes,
    food: draft.food,
    reaction: draft.reaction,
    temperatureC: draft.temperatureC,
    site: draft.site,
    medicineName: draft.medicineName,
    dose: draft.dose,
    vaccineCode: draft.vaccineCode,
    vaccineName: draft.vaccineName,
  });
}

function updateDraft(index: number, change: Partial<VoiceDraft>) {
  const current = drafts.value[index];
  if (!current) return;
  drafts.value[index] = { ...current, ...change };
}

function numberInput(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

function changeKind(index: number, value: CareKind) {
  updateDraft(index, {
    kind: value,
    amountMl: undefined,
    durationMinutes: undefined,
    sleepState: undefined,
    diaper: undefined,
    temperatureC: undefined,
    site: undefined,
    medicineName: undefined,
    dose: undefined,
    vaccineCode: undefined,
    vaccineName: undefined,
  });
}

function pickVaccine(index: number, code: string) {
  const spec = VACCINES_2026.find((item) => item.code === code);
  updateDraft(index, {
    vaccineCode: spec?.code,
    vaccineName: spec?.name,
    title: spec ? "接种记录" : "日常备注",
  });
}

function fillNow(index: number) {
  updateDraft(index, {
    capturedAt: localDateTime(),
    needsTimeConfirmation: false,
    timeHint: undefined,
  });
}

function removeDraft(index: number) {
  drafts.value = drafts.value.filter((_, itemIndex) => itemIndex !== index);
}

function save() {
  textError.value = "";
  const invalid = drafts.value.find((draft) => validateVoiceDraft(draft));
  if (invalid) {
    textError.value = validateVoiceDraft(invalid) ?? "请先检查每条记录。";
    return;
  }
  emit(
    "save",
    drafts.value.map((draft) => ({ ...draft })),
    batchId,
  );
}

watch(transcript, (next) => {
  if (parsedSource.value && next !== parsedSource.value) {
    drafts.value = [];
    aiUsed.value = false;
    aiError.value = "";
  }
});

onMounted(() => document.addEventListener("visibilitychange", stopWhenHidden));
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", stopWhenHidden);
  aiController?.abort();
  starting.value = false;
  stopListening();
  speech?.destroy();
  stopTimer();
});
</script>

<template>
  <ModalDialog
    title="说下刚刚发生的事"
    subtitle="QUICK CARE LOG"
    :busy="busy || aiBusy"
    @close="emit('close')"
  >
    <p class="voice-lead">
      例如：“下午三点十分喂了九十毫升奶，四点换了尿布，五点睡着了。”
    </p>
    <div class="voice-controls">
      <button
        v-if="!listening && !stopping && !starting"
        class="voice-button"
        type="button"
        :disabled="busy || !supported"
        @click="startListening"
      >
        <Mic :size="21" />开始说
      </button>
      <button
        v-else-if="listening"
        class="voice-button is-listening"
        type="button"
        :disabled="stopping"
        @click="stopListening"
      >
        <Square :size="17" fill="currentColor" />停止聆听
      </button>
      <span v-if="listening" class="listening-state"
        ><i />正在聆听 {{ elapsed }} / 60 秒</span
      >
      <span v-else-if="starting" class="listening-state"
        >正在等待麦克风权限…</span
      >
      <span v-else-if="stopping" class="listening-state"
        >正在整理最后一句…</span
      >
      <button
        v-if="starting"
        class="button button-ghost"
        type="button"
        @click="abortListening"
      >
        取消
      </button>
      <button
        v-if="!listening && !stopping && !starting && transcript"
        class="button button-ghost"
        type="button"
        :disabled="busy || !supported"
        @click="startListening"
      >
        <RotateCcw :size="16" />再说一次
      </button>
    </div>
    <p class="speech-privacy">
      浏览器语音服务可能联网处理，不由本站保存录音。你可以随时停止。
    </p>
    <p v-if="availability === 'needs-https'" class="compat-note">
      当前网址是 http，浏览器不允许网页使用麦克风，也不会弹出权限提示。请改用
      https 地址打开；或点下面的输入框，用输入法自带的语音输入说完，再点“整理成照护记录”。
    </p>
    <p v-else-if="!supported" class="compat-note">
      当前浏览器暂不支持直接语音识别。可以改用 Safari 或
      Chrome，或使用手机键盘语音把文字填在下面。
    </p>
    <label class="field voice-text-field"
      ><span>识别文字 <small>可以直接修改，修改后需重新整理</small></span
      ><textarea
        v-model="transcript"
        rows="4"
        maxlength="1000"
        placeholder="说完后，文字会出现在这里；也可以直接输入。"
        :disabled="listening || busy"
      />
    </label>
    <p v-if="interim" class="interim" aria-live="polite">
      正在听：{{ interim }}
    </p>
    <div class="parse-row">
      <div class="parse-buttons">
        <button
          class="button button-primary"
          type="button"
          :disabled="!canParse || busy"
          @click="parseText"
        >
          <WandSparkles :size="17" />本机整理
        </button>
        <button
          class="button button-secondary"
          type="button"
          :disabled="!canParse || busy || !aiReady"
          @click="parseWithAI"
        >
          <Sparkles :size="16" />{{
            aiBusy ? "AI 正在整理…" : "用 AI 整理"
          }}
        </button>
      </div>
      <span
        v-if="status === 'stopped' && transcript && !stopping"
        class="muted"
        >已停止，可以确认文字再整理</span
      >
    </div>
    <p v-if="!aiReady" class="ai-hint">
      想用 AI 拆长句，先到「家庭 → AI 辅助整理 → 设置」填入模型服务；没配置时语音一律用本机规则整理。
    </p>
    <p v-else class="ai-hint">
      当前使用 {{ aiModel }}。AI 只收到上面的文字，不会收到录音、照片或视频；时间不明确时会请你确认。
    </p>
    <p v-if="feedback" class="speech-feedback" role="status">{{ feedback }}</p>
    <p v-if="textError" class="form-error" role="alert">{{ textError }}</p>
    <div v-if="aiError" class="ai-error" role="alert">
      <p>{{ aiError }}</p>
      <button
        class="button button-secondary"
        type="button"
        :disabled="!canParse || busy"
        @click="parseText"
      >
        改用本机整理
      </button>
    </div>
    <div v-if="drafts.length" class="draft-list" aria-label="待确认的照护记录">
      <p v-if="aiUsed" class="ai-draft-note" role="status">
        <Sparkles :size="14" />AI 整理的草稿，请逐条核对时间、数量与原话后再保存。
      </p>
      <article
        v-for="(draft, index) in drafts"
        :key="draft.id"
        class="draft-card"
      >
        <header class="draft-heading">
          <span class="pill">{{ CARE_LABELS[draft.kind] }}</span
          ><button
            class="icon-button"
            type="button"
            aria-label="删除这条待确认记录"
            :disabled="busy"
            @click="removeDraft(index)"
          >
            <Trash2 :size="17" />
          </button>
        </header>
        <div class="two-fields">
          <label class="field"
            ><span>类别</span
            ><select
              :value="draft.kind"
              @change="
                changeKind(
                  index,
                  ($event.target as HTMLSelectElement).value as CareKind,
                )
              "
            >
              <option
                v-for="(_, kind) in CARE_LABELS"
                :key="kind"
                :value="kind"
              >
                {{ CARE_LABELS[kind as CareKind] }}
              </option>
            </select></label
          ><label class="field"
            ><span>标题</span
            ><input
              :value="draft.title"
              maxlength="48"
              @input="
                updateDraft(index, {
                  title: ($event.target as HTMLInputElement).value,
                })
              "
          /></label>
        </div>
        <label class="field"
          ><span
            >发生时间
            <small v-if="draft.timeHint">{{ draft.timeHint }}</small></span
          ><input
            :value="draft.capturedAt"
            type="datetime-local"
            @input="
              updateDraft(index, {
                capturedAt: ($event.target as HTMLInputElement).value,
                needsTimeConfirmation: false,
              })
            "
        /></label>
        <button
          v-if="draft.needsTimeConfirmation"
          class="button button-secondary full-width time-confirm"
          type="button"
          :disabled="busy"
          @click="fillNow(index)"
        >
          按现在记录（{{ localDateTime().slice(11) }}）
        </button>
        <label v-if="draft.kind === 'feeding'" class="field"
          ><span>奶量（毫升）<small>可选</small></span
          ><input
            :value="draft.amountMl ?? ''"
            type="number"
            min="0.1"
            step="0.1"
            inputmode="decimal"
            @input="
              updateDraft(index, {
                amountMl: numberInput(
                  ($event.target as HTMLInputElement).value,
                ),
              })
            "
        /></label>
        <label v-if="draft.kind === 'sleep'" class="field"
          ><span>睡眠状态</span
          ><select
            :value="draft.sleepState || ''"
            @change="
              updateDraft(index, {
                sleepState: (($event.target as HTMLSelectElement).value ||
                  undefined) as VoiceDraft['sleepState'],
              })
            "
          >
            <option value="">仅记录睡眠</option>
            <option value="asleep">睡着了</option>
            <option value="awake">醒来了</option>
            <option value="duration">记录睡眠时长</option>
          </select></label
        >
        <label v-if="draft.kind === 'sleep'" class="field"
          ><span>睡了多久（分钟）<small>可选</small></span
          ><input
            :value="draft.durationMinutes ?? ''"
            type="number"
            min="0.1"
            step="0.1"
            inputmode="decimal"
            @input="
              updateDraft(index, {
                durationMinutes: numberInput(
                  ($event.target as HTMLInputElement).value,
                ),
              })
            "
        /></label>
        <label v-if="draft.kind === 'diaper'" class="field"
          ><span>尿布记录</span
          ><select
            :value="draft.diaper || 'changed'"
            @change="
              updateDraft(index, {
                diaper: ($event.target as HTMLSelectElement)
                  .value as VoiceDraft['diaper'],
              })
            "
          >
            <option value="changed">只记录更换</option>
            <option value="wet">尿湿</option>
            <option value="dirty">便便</option>
            <option value="mixed">尿湿和便便</option>
          </select></label
        >
        <label v-if="draft.kind === 'temperature'" class="field"
          ><span>体温（℃）<small>34–43</small></span
          ><input
            :value="draft.temperatureC ?? ''"
            type="number"
            min="34"
            max="43"
            step="0.1"
            inputmode="decimal"
            @input="
              updateDraft(index, {
                temperatureC: numberInput(
                  ($event.target as HTMLInputElement).value,
                ),
              })
            "
        /></label>
        <label v-if="draft.kind === 'temperature'" class="field"
          ><span>测温部位 <small>可选</small></span
          ><select
            :value="draft.site ?? ''"
            @change="
              updateDraft(index, {
                site: (($event.target as HTMLSelectElement).value ||
                  undefined) as VoiceDraft['site'],
              })
            "
          >
            <option value="">未选择</option>
            <option v-for="(label, site) in SITE_LABELS" :key="site" :value="site">
              {{ label }}
            </option>
          </select></label
        >
        <label v-if="draft.kind === 'vaccination'" class="field"
          ><span>疫苗 <small>对应免疫程序</small></span
          ><select
            :value="draft.vaccineCode ?? ''"
            @change="
              pickVaccine(index, ($event.target as HTMLSelectElement).value)
            "
          >
            <option value="">请选择</option>
            <option
              v-for="spec in VACCINES_2026"
              :key="spec.code"
              :value="spec.code"
            >
              {{ spec.name }}
            </option>
          </select></label
        >
        <label v-if="draft.kind === 'medicine'" class="field"
          ><span>药名</span
          ><input
            :value="draft.medicineName ?? ''"
            maxlength="30"
            placeholder="例如：美林"
            @input="
              updateDraft(index, {
                medicineName:
                  ($event.target as HTMLInputElement).value || undefined,
              })
            "
        /></label>
        <label v-if="draft.kind === 'medicine'" class="field"
          ><span>剂量 <small>保留原文，如 2.5ml</small></span
          ><input
            :value="draft.dose ?? ''"
            maxlength="20"
            placeholder="例如：2.5ml"
            @input="
              updateDraft(index, {
                dose: ($event.target as HTMLInputElement).value || undefined,
              })
            "
        /></label>
        <label class="field"
          ><span>备注 <small>可选</small></span
          ><textarea
            :value="
              draft.kind === 'note' || draft.note !== draft.sourceText
                ? draft.note
                : ''
            "
            rows="2"
            maxlength="500"
            @input="
              updateDraft(index, {
                note: ($event.target as HTMLTextAreaElement).value,
              })
            "
          />
        </label>
        <details class="draft-source">
          <summary>查看录入原话</summary>
          <p>{{ draft.sourceText }}</p>
        </details>
        <p v-if="draft.reviewNote" class="draft-warning" role="alert">
          {{ draft.reviewNote }}
        </p>
        <p v-if="draftExtras(draft)" class="draft-extras muted">
          识别到：{{ draftExtras(draft) }}
        </p>
        <p v-if="validateVoiceDraft(draft)" class="draft-warning" role="alert">
          {{ validateVoiceDraft(draft) }}
        </p>
      </article>
      <button
        class="button button-primary full-width"
        type="button"
        :disabled="!canSave"
        @click="save"
      >
        <Check :size="17" />确认保存 {{ drafts.length }} 条记录
      </button>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p class="fine-print left">
      保存前请检查时间和数量。BabyTime
      只整理你说出的事实，不判断健康或发育情况；AI 结果同样只是草稿。
    </p>
  </ModalDialog>
</template>

<style scoped>
.draft-source {
  color: var(--muted);
  font-size: 12px;
}
.draft-source summary {
  min-height: 44px;
  padding-block: 12px;
  cursor: pointer;
}
.draft-source p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.voice-lead {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.8;
  margin: 12px 0 18px;
}
.voice-controls {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.voice-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  padding: 12px 18px;
  border: 0;
  border-radius: 15px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.voice-button.is-listening {
  background: var(--danger);
}
.listening-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--danger);
  font-size: 12px;
}
.listening-state i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.speech-privacy,
.compat-note,
.speech-feedback {
  font-size: var(--font-xs);
  line-height: 1.7;
  color: var(--muted);
  margin: 11px 0;
}
.compat-note {
  background: var(--tint);
  padding: 10px 12px;
  border-radius: 10px;
}
.voice-text-field {
  margin-top: 18px;
}
.interim {
  color: var(--accent);
  font-size: 12px;
  background: var(--tint);
  border-radius: 9px;
  padding: 7px 10px;
}
.parse-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.parse-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ai-hint,
.ai-draft-note {
  font-size: var(--font-xs);
  line-height: 1.7;
  color: var(--muted);
  margin: 10px 0 0;
}
.ai-draft-note {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--sage);
  color: var(--sage-ink);
}
.ai-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 11px 13px;
  border-radius: 11px;
  background: #f7e5df;
  color: #8d3f31;
  font-size: 13px;
  line-height: 1.6;
}
.ai-error p {
  flex: 1;
  min-width: 180px;
}
.draft-list {
  display: grid;
  gap: 12px;
  margin-top: 20px;
}
.draft-card {
  display: grid;
  gap: 13px;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--bg);
}
.draft-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.time-confirm {
  font-size: 12px;
}
.draft-extras {
  font-size: 12px;
  line-height: 1.7;
}
.draft-warning {
  color: var(--danger);
  font-size: 12px;
  line-height: 1.7;
}
.fine-print.left {
  text-align: left;
}
.field input,
.field textarea,
.field select {
  font-size: 16px;
}
@keyframes voice-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .listening-state i {
    animation: voice-pulse 1.2s infinite;
  }
}
@media (max-width: 430px) {
  .voice-controls {
    align-items: stretch;
  }
  .voice-button {
    width: 100%;
  }
  .parse-row {
    align-items: stretch;
  }
  .parse-row .button {
    width: 100%;
  }
  .parse-buttons {
    width: 100%;
  }
  .two-fields {
    grid-template-columns: 1fr;
  }
}
</style>
