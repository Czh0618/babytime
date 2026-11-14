<script setup lang="ts">
import { computed, nextTick, reactive, ref } from "vue";
import { CalendarPlus, Check, FileDown, Plus, Stethoscope, Trash2 } from "@lucide/vue";
import type {
  BabyProfile,
  GrowthEntry,
  HealthCheckRecord,
  VaccinationRecord,
  VaccinePlan,
} from "../types";
import {
  STATUS_LABELS,
  pendingVaccinesOn,
  summarizeVaccines,
  vaccineTasks,
  type VaccineStatus,
  type VaccineTask,
} from "../domain/vaccines";
import { VACCINE_SOURCE } from "../data/vaccines-2026";
import {
  PAID_VACCINES,
  PAID_VACCINE_DISCLAIMER,
  PAID_VACCINE_PRICE_HINT,
  PAID_VACCINE_SOURCE,
  type PaidVaccine,
} from "../data/vaccines-paid";
import {
  VACCINE_CAUTIONS,
  VACCINE_CAUTIONS_DISCLAIMER,
  VACCINE_CAUTIONS_SOURCE,
} from "../data/vaccine-cautions";
import { localDate } from "../domain/date";
import {
  GROWTH_METRICS,
  correctedBirthDate,
  growthSeries,
  latestMeasurement,
  type GrowthMetric,
} from "../domain/growth";
import { achievedMilestones } from "../domain/milestones";
import { CHILD_HEALTH_CHECKS } from "../data/child-health-checks";
import { healthCheckTasks } from "../domain/health-checks";
import { warningCheckpointForBaby } from "../domain/warning-signs";
import { firstFoodIntroductions } from "../domain/feeding-new-food";
import GrowthChart from "../components/GrowthChart.vue";
import HealthFold from "../components/HealthFold.vue";
import AskRecordsCard from "../components/AskRecordsCard.vue";
import HealthChecksCard from "../components/HealthChecksCard.vue";
import WarningSignsCard from "../components/WarningSignsCard.vue";
import FeedingNotesCard from "../components/FeedingNotesCard.vue";
import SchoolCheckCard from "../components/SchoolCheckCard.vue";

const props = defineProps<{
  baby: BabyProfile;
  plan: VaccinePlan;
  records: VaccinationRecord[];
  entries: GrowthEntry[];
  milestones: Record<string, string>;
  healthChecks: Record<string, HealthCheckRecord>;
  warningSigns: Record<string, string>;
  busy: boolean;
  aiReady: boolean;
}>();
const emit = defineEmits<{
  savePlan: [plan: VaccinePlan];
  addRecord: [record: Omit<VaccinationRecord, "id" | "createdAt">];
  removeRecord: [id: string];
  calendar: [task: VaccineTask];
  measure: [values: { weightKg?: number; heightCm?: number; headCm?: number }];
  visit: [];
  csv: [];
  saveHealthChecks: [records: Record<string, HealthCheckRecord>];
  saveWarningSigns: [signs: Record<string, string>];
}>();

const today = localDate();
const filter = ref<"todo" | "all" | "done">("todo");
const editing = ref("");
const form = reactive({ date: today, clinic: "", lot: "" });
const custom = reactive({
  name: "",
  dose: "1",
  date: today,
  clinic: "",
  lot: "",
  cost: "",
});
const customForm = ref<HTMLFormElement | null>(null);

const tasks = computed(() =>
  vaccineTasks(props.baby, props.plan, props.records, today),
);
const summary = computed(() => summarizeVaccines(tasks.value));
const visible = computed(() => {
  if (filter.value === "done")
    return tasks.value.filter((item) => item.status === "done");
  if (filter.value === "all") return tasks.value;
  return tasks.value.filter(
    (item) => item.status === "overdue" || item.status === "due-soon",
  );
});
const customRecords = computed(() =>
  props.records
    .filter((item) => item.code === "custom")
    .sort((a, b) => b.date.localeCompare(a.date)),
);

const metric = ref<GrowthMetric>("weightKg");
const metricSpec = computed(
  () => GROWTH_METRICS.find((item) => item.id === metric.value)!,
);
const points = computed(() =>
  growthSeries(props.entries, props.baby, metric.value),
);
const corrected = computed(() => correctedBirthDate(props.baby).corrected);
const latest = computed(() => latestMeasurement(props.entries));
const achieved = computed(() => achievedMilestones(props.milestones));
const measure = reactive({ weightKg: "", heightCm: "", headCm: "" });

/** 折叠状态下的一行概要：不用展开就知道该看哪张卡。 */
const checkTasks = computed(() =>
  healthCheckTasks(props.baby, props.healthChecks, today),
);
const checkDone = computed(
  () => checkTasks.value.filter((item) => item.status === "done").length,
);
const checkSoon = computed(
  () => checkTasks.value.filter((item) => item.status === "due-soon").length,
);
const schoolPending = computed(
  () => pendingVaccinesOn(props.baby, props.plan, props.records, today).length,
);
const signCount = computed(() => Object.keys(props.warningSigns).length);
const vaccineHint = computed(
  () => `已记录 ${summary.value.done} / ${summary.value.total} 剂`,
);
const vaccineBadge = computed(() => {
  const todo = summary.value.overdue + summary.value.dueSoon;
  return todo ? `${todo} 剂待办` : "";
});
const checkHint = computed(
  () => `已完成 ${checkDone.value} / ${CHILD_HEALTH_CHECKS.length} 次`,
);
const checkBadge = computed(() =>
  checkSoon.value ? `30 天内 ${checkSoon.value} 次` : "",
);
const growthHint = computed(() =>
  latest.value
    ? `最近一次测量 ${latest.value.date.slice(0, 10)}`
    : "还没有测量记录",
);
const milestoneHint = computed(() =>
  achieved.value.length
    ? `已勾选 ${achieved.value.length} 项`
    : "还没有勾选过里程碑",
);
const signHint = computed(() => {
  const checkpoint = warningCheckpointForBaby(props.baby).checkpoint;
  return checkpoint
    ? `当前检查点 ${checkpoint.label} · 4 条观察条目`
    : "满 3 月龄后显示对应条目";
});
const signBadge = computed(() =>
  signCount.value ? `已观察 ${signCount.value} 条` : "",
);
const foodHint = computed(() => {
  const count = firstFoodIntroductions(props.entries).length;
  return count ? `已记录 ${count} 种新食物` : "按已有照护记录自动汇总";
});
const schoolHint = computed(() =>
  schoolPending.value
    ? `按今天核对，${schoolPending.value} 剂待核对`
    : "按今天核对，没有发现缺剂次",
);
const customHint = computed(() => {
  const paid = customRecords.value.length;
  return paid ? `已记录 ${paid} 剂` : `目录 ${PAID_VACCINES.length} 支可参考`;
});
const focusText = computed(() => {
  const parts: string[] = [];
  if (summary.value.overdue)
    parts.push(`疫苗已过应种日期 ${summary.value.overdue} 剂`);
  if (summary.value.dueSoon)
    parts.push(`30 天内应种 ${summary.value.dueSoon} 剂`);
  if (checkSoon.value) parts.push(`体检 30 天内 ${checkSoon.value} 次`);
  return parts.length ? parts.join(" · ") : "近期没有待接种或待体检的事项。";
});

function addMeasure() {
  const values = {
    weightKg: measure.weightKg ? Number(measure.weightKg) : undefined,
    heightCm: measure.heightCm ? Number(measure.heightCm) : undefined,
    headCm: measure.headCm ? Number(measure.headCm) : undefined,
  };
  if (
    values.weightKg === undefined &&
    values.heightCm === undefined &&
    values.headCm === undefined
  )
    return;
  emit("measure", values);
  measure.weightKg = "";
  measure.heightCm = "";
  measure.headCm = "";
}

function key(task: VaccineTask) {
  return `${task.code}-${task.dose}`;
}

function fullDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function statusClass(status: VaccineStatus) {
  return `pill-${status}`;
}

function startRecord(task: VaccineTask) {
  editing.value = key(task);
  form.date = today;
  form.clinic = "";
  form.lot = "";
}

function save(task: VaccineTask) {
  if (!form.date) return;
  emit("addRecord", {
    code: task.code,
    name: task.name,
    dose: task.dose,
    date: form.date,
    clinic: form.clinic.trim() || undefined,
    lot: form.lot.trim() || undefined,
  });
  editing.value = "";
}

function remove(record?: VaccinationRecord) {
  if (record) emit("removeRecord", record.id);
}

function addToCalendar(task: VaccineTask) {
  emit("calendar", task);
}

function addCustom() {
  const name = custom.name.trim();
  const dose = Math.max(1, Math.round(Number(custom.dose) || 1));
  if (!name || !custom.date) return;
  // type=number 的 v-model 会把输入转成数字，没填时是空字符串，不能当字符串处理。
  const cost = custom.cost === "" ? undefined : Number(custom.cost);
  emit("addRecord", {
    code: "custom",
    name,
    dose,
    date: custom.date,
    clinic: custom.clinic.trim() || undefined,
    lot: custom.lot.trim() || undefined,
    cost: cost !== undefined && Number.isFinite(cost) && cost >= 0 ? cost : undefined,
  });
  custom.name = "";
  custom.dose = "1";
  custom.date = today;
  custom.clinic = "";
  custom.lot = "";
  custom.cost = "";
}

/**
 * 点目录里的「记录」：把名称和下一剂预填进表单。
 * 目录里的程序只是文字参考，不推算日期，也不改疫苗计划。
 */
function pickPaid(item: PaidVaccine) {
  const used = props.records.filter(
    (record) => record.code === "custom" && record.name === item.name,
  ).length;
  custom.name = item.name;
  custom.dose = String(Math.min(item.doses, used + 1));
  custom.date = today;
  void nextTick(() =>
    customForm.value?.scrollIntoView({ block: "center", behavior: "smooth" }),
  );
}

function chooseSide(group: "je" | "hepa", code?: string) {
  const choices = { ...props.plan.choices };
  if (group === "je")
    choices.je = code as VaccinePlan["choices"]["je"];
  else choices.hepa = code as VaccinePlan["choices"]["hepa"];
  if (!code) delete choices[group === "je" ? "je" : "hepa"];
  emit("savePlan", { ...props.plan, choices });
}

function toggleSpecial(event: Event) {
  emit("savePlan", {
    ...props.plan,
    specialProgram: (event.target as HTMLInputElement).checked,
  });
}
</script>

<template>
  <section class="page health-page" aria-labelledby="health-heading">
    <div class="page-heading-row">
      <div>
        <p class="eyebrow">HEALTH RECORD</p>
        <h1 id="health-heading" class="page-heading">健康档案</h1>
        <p class="muted page-lede">
          接种计划按免疫程序推算，记录只存在本机，随备份一起走。下面每项默认收起，点标题展开。
        </p>
      </div>
      <div class="health-tools">
        <button
          class="button button-secondary"
          type="button"
          @click="emit('visit')"
        >
          <Stethoscope :size="16" aria-hidden="true" />就诊摘要
        </button>
        <button class="button button-ghost" type="button" @click="emit('csv')">
          <FileDown :size="16" aria-hidden="true" />导出 CSV
        </button>
      </div>
    </div>

    <div v-if="!baby.birthDate" class="notice" role="status">
      还没有填写出生日期，无法推算接种时间。<a href="#family">去家庭页填写</a>
    </div>

    <!-- 折叠后这一行就是页面重点：只列近期真正需要留意的事项。 -->
    <p class="health-focus" role="status">{{ focusText }}</p>

    <HealthFold
      title="疫苗计划"
      :hint="vaccineHint"
      :badge="vaccineBadge"
      :attention="summary.overdue > 0"
    >
      <div v-if="baby.birthDate" class="fold-content vaccine-card">
      <div class="plan-options">
        <label class="check-field">
          <input
            type="checkbox"
            :checked="plan.specialProgram"
            @change="toggleSpecial"
          />
          乙肝特殊程序（母亲 HBsAg 阳性且出生体重 &lt;2000g，按 0/1/2/7 月龄）
        </label>
        <div class="choice-row" role="group" aria-label="乙脑疫苗选择">
          <span>乙脑</span>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="!plan.choices.je"
            @click="chooseSide('je')"
          >
            待定
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.je === 'JE-L'"
            @click="chooseSide('je', 'JE-L')"
          >
            减毒活
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.je === 'JE-I'"
            @click="chooseSide('je', 'JE-I')"
          >
            灭活
          </button>
        </div>
        <div class="choice-row" role="group" aria-label="甲肝疫苗选择">
          <span>甲肝</span>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="!plan.choices.hepa"
            @click="chooseSide('hepa')"
          >
            待定
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.hepa === 'HepA-L'"
            @click="chooseSide('hepa', 'HepA-L')"
          >
            减毒活
          </button>
          <button
            type="button"
            class="choice-button"
            :aria-pressed="plan.choices.hepa === 'HepA-I'"
            @click="chooseSide('hepa', 'HepA-I')"
          >
            灭活
          </button>
        </div>
      </div>

      <div class="filter-tabs" aria-label="疫苗筛选">
        <button
          type="button"
          :class="['filter-tab', { active: filter === 'todo' }]"
          :aria-pressed="filter === 'todo'"
          @click="filter = 'todo'"
        >
          待办
        </button>
        <button
          type="button"
          :class="['filter-tab', { active: filter === 'all' }]"
          :aria-pressed="filter === 'all'"
          @click="filter = 'all'"
        >
          全部
        </button>
        <button
          type="button"
          :class="['filter-tab', { active: filter === 'done' }]"
          :aria-pressed="filter === 'done'"
          @click="filter = 'done'"
        >
          已接种
        </button>
      </div>

      <ul v-if="visible.length" class="dose-list">
        <li
          v-for="task in visible"
          :key="key(task)"
          class="dose-row"
          :data-status="task.status"
        >
          <div class="dose-main">
            <strong>{{ task.name }} · 第 {{ task.dose }} 剂</strong>
            <span class="muted"
              >应种 {{ fullDate(task.dueDate)
              }}<template v-if="task.note"> · {{ task.note }}</template></span
            >
            <span v-if="task.pendingChoice" class="choice-hint">
              二选一还没定：先在上面选乙脑 / 甲肝用哪一支
            </span>
            <span v-if="task.record" class="record-hint">
              已接种 {{ fullDate(task.record.date) }}<template
                v-if="task.record.clinic"
              >
                · {{ task.record.clinic }}</template
              ><template v-if="task.record.lot">
                · 批号 {{ task.record.lot }}</template
              >
            </span>
          </div>
          <span class="pill" :class="statusClass(task.status)">{{
            STATUS_LABELS[task.status]
          }}</span>
          <div class="dose-actions">
            <button
              v-if="!task.record"
              class="button button-secondary small"
              type="button"
              :disabled="busy"
              @click="startRecord(task)"
            >
              <Check :size="14" aria-hidden="true" />记一笔
            </button>
            <button
              v-else
              class="button button-ghost small"
              type="button"
              :disabled="busy"
              @click="remove(task.record)"
            >
              <Trash2 :size="14" aria-hidden="true" />撤销
            </button>
            <button
              class="button button-ghost small"
              type="button"
              :disabled="busy"
              @click="addToCalendar(task)"
            >
              <CalendarPlus :size="14" aria-hidden="true" />加到日历
            </button>
          </div>
          <div v-if="editing === key(task)" class="record-form">
            <label class="field"
              ><span>接种日期</span
              ><input v-model="form.date" type="date" :max="today"
            /></label>
            <label class="field"
              ><span>门诊 <small>可选</small></span
              ><input v-model="form.clinic" maxlength="30" placeholder="例如：社区接种门诊"
            /></label>
            <label class="field"
              ><span>批号 <small>可选</small></span
              ><input v-model="form.lot" maxlength="30"
            /></label>
            <div class="record-actions">
              <button
                class="button button-primary small"
                type="button"
                :disabled="busy || !form.date"
                @click="save(task)"
              >
                保存
              </button>
              <button
                class="button button-ghost small"
                type="button"
                @click="editing = ''"
              >
                取消
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="empty-hint">
        {{ filter === "todo" ? "近期没有待接种的剂次。" : "这一栏还没有记录。" }}
      </p>

      <p class="source-line">{{ VACCINE_SOURCE }}</p>
      </div>
      <p v-else class="empty-hint">还没有填写出生日期，无法推算接种时间。</p>

      <section class="caution-block" aria-labelledby="caution-heading">
        <h3 id="caution-heading">接种前后注意事项</h3>
        <p class="caution-label">去接种前</p>
        <ul class="caution-list">
          <li v-for="line in VACCINE_CAUTIONS.before" :key="line">{{ line }}</li>
        </ul>
        <p class="caution-label">接种后 1～2 天</p>
        <ul class="caution-list">
          <li v-for="line in VACCINE_CAUTIONS.after" :key="line">{{ line }}</li>
        </ul>
        <p class="caution-label">出现这些情况及时就医</p>
        <ul class="caution-list">
          <li v-for="line in VACCINE_CAUTIONS.seekCare" :key="line">
            {{ line }}
          </li>
        </ul>
        <p class="source-line">
          {{ VACCINE_CAUTIONS_SOURCE }}{{ VACCINE_CAUTIONS_DISCLAIMER }}
        </p>
      </section>
    </HealthFold>

    <!-- P8.1：儿保十三次只在健康页显示状态，今天页不加提示、不做推送。 -->
    <HealthFold title="体检日程" :hint="checkHint" :badge="checkBadge">
      <HealthChecksCard
        embedded
        :baby="baby"
        :records="healthChecks"
        :busy="busy"
        @save="(records) => emit('saveHealthChecks', records)"
      />
    </HealthFold>

    <HealthFold title="生长曲线" :hint="growthHint">
      <div class="fold-content growth-card">
      <p class="muted">
        实线是你记录的测量点；填写性别后叠加国标百分位参考线，并客观描述所处区间，不判断偏高或偏低。
      </p>
      <div class="metric-tabs" role="group" aria-label="成长指标">
        <button
          v-for="item in GROWTH_METRICS"
          :key="item.id"
          type="button"
          class="filter-tab"
          :class="{ active: metric === item.id }"
          :aria-pressed="metric === item.id"
          @click="metric = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <GrowthChart
        v-if="points.length"
        :points="points"
        :label="metricSpec.label"
        :unit="metricSpec.unit"
        :corrected="corrected"
        :sex="baby.sex"
        :metric="metric"
      />
      <p v-if="metric === 'bmi' && !points.length" class="empty-hint">
        BMI 由同一天记录的体重与身高自动算出（体重 kg ÷ 身高 m²，保留 1 位小数），
        不用单独填写；先在下面记一次体重和身高。
      </p>
      <p v-else-if="!points.length" class="empty-hint">
        还没有{{ metricSpec.label }}记录。
      </p>

      <form class="measure-form" @submit.prevent="addMeasure">
        <label class="field"
          ><span>体重（kg）</span
          ><input
            v-model="measure.weightKg"
            type="number"
            min="0.5"
            max="40"
            step="0.01"
            inputmode="decimal"
            placeholder="例如 7.25"
        /></label>
        <label class="field"
          ><span>身高 / 身长（cm）</span
          ><input
            v-model="measure.heightCm"
            type="number"
            min="20"
            max="130"
            step="0.01"
            inputmode="decimal"
            placeholder="例如 65.25"
        /></label>
        <label class="field"
          ><span>头围（cm）</span
          ><input
            v-model="measure.headCm"
            type="number"
            min="20"
            max="60"
            step="0.01"
            inputmode="decimal"
            placeholder="例如 42.35"
        /></label>
        <button class="button button-secondary" type="submit" :disabled="busy">
          <Plus :size="15" aria-hidden="true" />记一次测量
        </button>
      </form>
      <p v-if="latest" class="muted latest-line">
        最近一次：{{ fullDate(latest.date.slice(0, 10)) }} ·
        <template v-if="latest.weightKg !== undefined"
          >体重 {{ latest.weightKg }} kg </template
        ><template v-if="latest.heightCm !== undefined"
          >身高 {{ latest.heightCm }} cm </template
        ><template v-if="latest.headCm !== undefined"
          >头围 {{ latest.headCm }} cm</template
        >
      </p>
      <p class="source-line">
        参考线录入自《7 岁以下儿童生长标准》WS/T 423—2022 附录 A（国家卫生健康委员会）：
        体重、身长/身高、BMI（表 A.9 / A.10）为 0～6 岁 9 月龄，头围为 0～3 岁；
        原文百分位为 P3 / P10 / P25 / P50 / P75 / P90 / P97。BMI 不单独存储，
        由同一天的体重与身高派生（2 岁以下按身长、2 岁起按身高计算）。
        这里只描述区间，不做发育判断，也不写超重或肥胖，具体请以医生为准。
        早产宝宝把预产期填在家庭页后，横轴会用矫正月龄。
      </p>
      </div>
    </HealthFold>

    <HealthFold title="里程碑" :hint="milestoneHint">
      <div class="fold-content milestone-card">
      <p class="muted">
        在「今天」页的月龄指引里勾选，这里会按达成日期汇总。
      </p>
      <ul v-if="achieved.length" class="milestone-list">
        <li v-for="item in achieved" :key="item.key">
          <span class="milestone-date">{{ item.date }}</span>
          <span class="milestone-text">{{ item.text }}</span>
          <span class="pill">{{ item.guideLabel }}</span>
        </li>
      </ul>
      <p v-else class="empty-hint">还没有勾选过里程碑。</p>
      </div>
    </HealthFold>

    <!-- P8.4：与上面的 CDC 里程碑卡并列，两张卡分开写、语气不混用。 -->
    <HealthFold title="发育观察" :hint="signHint" :badge="signBadge">
      <WarningSignsCard
        embedded
        :baby="baby"
        :signs="warningSigns"
        :busy="busy"
        @save="(signs) => emit('saveWarningSigns', signs)"
      />
    </HealthFold>

    <!-- P8.5：新食物引入记录入口放健康页，不另开页面。 -->
    <HealthFold title="喂养与口腔" :hint="foodHint">
      <FeedingNotesCard embedded :entries="entries" :health-checks="healthChecks" />
    </HealthFold>

    <HealthFold title="问问记录" hint="只发送按天汇总的数字，不保存对话">
      <AskRecordsCard
        embedded
        :baby="props.baby"
        :entries="props.entries"
        :ai-ready="props.aiReady"
      />
    </HealthFold>

    <!-- P8.6：目标日期默认今天、可打印；只按国家免疫规划列缺剂次。 -->
    <HealthFold title="入托入学接种核对" :hint="schoolHint">
      <SchoolCheckCard embedded :baby="baby" :plan="plan" :records="records" />
    </HealthFold>

    <HealthFold title="自费疫苗" :hint="customHint">
      <div class="fold-content custom-card">
      <p class="muted custom-hint">
        13 价肺炎、轮状、水痘、流感等不在免疫规划里。下面列常见品类与参考程序，
        点「记录」把名称填进表单；目录只作参考，不推算接种日期。
      </p>

      <details class="paid-catalog">
        <summary>常见自费疫苗目录（{{ PAID_VACCINES.length }} 支）</summary>
        <ul class="paid-list">
          <li v-for="item in PAID_VACCINES" :key="item.id">
            <div class="paid-main">
              <strong>{{ item.name }}</strong>
              <span class="muted">{{ item.protects }}</span>
              <span class="muted"
                >{{ item.schedule }}<template v-if="item.note">
                  · {{ item.note }}</template
                ></span
              >
            </div>
            <button
              class="button button-ghost small"
              type="button"
              :disabled="busy"
              @click="pickPaid(item)"
            >
              记录
            </button>
          </li>
        </ul>
        <p class="source-line">
          {{ PAID_VACCINE_DISCLAIMER }} {{ PAID_VACCINE_SOURCE }}
        </p>
      </details>

      <p class="muted custom-hint">{{ PAID_VACCINE_PRICE_HINT }}</p>

      <form ref="customForm" class="custom-form" @submit.prevent="addCustom">
        <label class="field"
          ><span>疫苗名称</span
          ><input v-model="custom.name" maxlength="30" placeholder="例如：13 价肺炎"
        /></label>
        <div class="two-fields">
          <label class="field"
            ><span>第几剂</span
            ><input
              v-model="custom.dose"
              type="number"
              min="1"
              max="20"
              inputmode="numeric"
          /></label>
          <label class="field"
            ><span>接种日期</span
            ><input v-model="custom.date" type="date" :max="today"
          /></label>
        </div>
        <div class="two-fields">
          <label class="field"
            ><span>门诊 <small>可选</small></span
            ><input
              v-model="custom.clinic"
              maxlength="30"
              placeholder="例如：社区接种门诊"
          /></label>
          <label class="field"
            ><span>批号 <small>可选</small></span
            ><input v-model="custom.lot" maxlength="30"
          /></label>
        </div>
        <label class="field"
          ><span>花费（元）<small>可选</small></span
          ><input
            v-model="custom.cost"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            placeholder="例如 618"
        /></label>
        <button
          class="button button-secondary"
          type="submit"
          :disabled="busy || !custom.name.trim()"
        >
          <Plus :size="15" aria-hidden="true" />添加
        </button>
      </form>
      <ul v-if="customRecords.length" class="custom-list">
        <li v-for="item in customRecords" :key="item.id">
          <div class="custom-item-main">
            <strong>{{ item.name || "自费疫苗" }} · 第 {{ item.dose }} 剂</strong>
            <span class="muted"
              >{{ fullDate(item.date)
              }}<template v-if="item.clinic"> · {{ item.clinic }}</template
              ><template v-if="item.lot"> · 批号 {{ item.lot }}</template
              ><template v-if="item.cost !== undefined">
                · ¥{{ item.cost }}</template
              ></span
            >
          </div>
          <button
            class="button button-ghost small"
            type="button"
            :disabled="busy"
            @click="remove(item)"
          >
            删除
          </button>
        </li>
      </ul>
      <p v-else class="empty-hint">还没有自费疫苗记录。</p>
      </div>
    </HealthFold>
  </section>
</template>

<style scoped>
.health-page {
  display: grid;
  gap: 14px;
}
/* 折叠后唯一始终可见的重点：只列近期真正要处理的事。 */
.health-focus {
  margin: 0;
  padding: 10px 14px;
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  background: var(--tint);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.6;
}
.health-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.page-heading-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
/* 外层 HealthFold 已经给了卡片留白，内层只负责栅格间距。 */
.fold-content.vaccine-card,
.fold-content.custom-card,
.fold-content.growth-card,
.fold-content.milestone-card {
  display: grid;
  gap: 14px;
  padding: 14px 0 0;
  min-width: 0;
}
.growth-head h2 {
  margin: 0 0 4px;
}
.metric-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.measure-form {
  display: grid;
  gap: 10px;
}
.latest-line {
  font-size: var(--font-xs);
  margin: 0;
}
.milestone-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.milestone-list li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.6;
}
.milestone-date {
  flex: none;
  color: var(--accent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.milestone-text {
  flex: 1;
  min-width: 0;
}
@media (min-width: 720px) {
  .measure-form {
    grid-template-columns: repeat(3, 1fr) auto;
    align-items: end;
  }
}
.vaccine-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.vaccine-head h2 {
  margin: 0 0 4px;
}
.plan-options {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  background: var(--tint);
}
.choice-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--font-xs);
  color: var(--muted);
}
.choice-button {
  min-height: 36px;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: var(--font-xs);
  cursor: pointer;
}
.choice-button[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--surface);
}
.filter-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.filter-tab {
  min-height: 40px;
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
}
.filter-tab.active {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--surface);
}
.dose-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dose-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.dose-row[data-status="overdue"] .dose-main strong {
  color: var(--danger);
}
.dose-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.dose-main strong {
  font-size: 14px;
  font-weight: 600;
}
.dose-main .muted,
.record-hint,
.choice-hint {
  font-size: var(--font-xs);
  line-height: 1.6;
}
.record-hint {
  color: var(--accent);
}
.choice-hint {
  color: var(--muted);
  font-style: italic;
}
.dose-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.button.small {
  min-height: 38px;
  padding: 6px 12px;
  font-size: var(--font-xs);
}
.record-form {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  background: var(--tint);
}
.record-actions {
  display: flex;
  gap: 8px;
}
.source-line {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
/* 接种前后注意事项：通用提示，不针对某一支疫苗，也不下医学结论。 */
.caution-block {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  padding: 14px 12px;
  border-radius: 14px;
  background: var(--tint);
}
.caution-block h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.caution-label {
  margin: 4px 0 0;
  color: var(--accent);
  font-size: var(--font-xs);
  font-weight: 600;
}
.caution-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  font-size: var(--font-xs);
  line-height: 1.7;
}
/* 自费疫苗目录：只读参考，点「记录」把名称预填进下面的表单。 */
.paid-catalog summary {
  display: flex;
  align-items: center;
  min-height: 40px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.paid-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.paid-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.paid-main {
  display: grid;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.paid-main strong {
  font-size: 14px;
  font-weight: 600;
}
.paid-main .muted {
  font-size: var(--font-xs);
  line-height: 1.6;
}
.custom-form {
  display: grid;
  gap: 10px;
}
.custom-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.custom-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.custom-list li span:first-child,
.custom-item-main {
  flex: 1;
  min-width: 0;
}
.custom-item-main {
  display: grid;
  gap: 2px;
}
.custom-item-main strong {
  font-size: 14px;
  font-weight: 600;
}
.custom-item-main .muted {
  font-size: var(--font-xs);
}
.empty-hint {
  margin: 0;
  padding: 10px 0;
  color: var(--muted);
  font-size: var(--font-xs);
}
.pill-done {
  background: var(--sage);
  color: var(--sage-ink);
}
.pill-overdue {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}
.pill-due-soon {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.pill-upcoming {
  background: var(--tint);
  color: var(--muted);
}
@media (min-width: 720px) {
  .custom-form {
    grid-template-columns: 1fr 180px auto;
    align-items: end;
  }
}
</style>
