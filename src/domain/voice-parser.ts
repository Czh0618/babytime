import { localDateTime } from "./date.ts";
import {
  CARE_LABELS,
  type CareFields,
  type CareKind,
  type VoiceDraft,
} from "./care-types.ts";
import type { EntryDraft } from "../types.ts";

const NEGATIVE = /(?:没(?:有)?|没有|还没|尚未|未|不曾|不用|不要)/;
const TIME_PATTERN =
  /(?:(今天|昨天|前天)\s*)?(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?([0-9零〇一二两三四五六七八九十百]+)\s*(?:(?:点|时)(?:(半|一刻|三刻)|\s*([0-9零〇一二两三四五六七八九十百]+)\s*分?)?|[:：]\s*([0-9]{1,2}))/;
const RELATIVE_PATTERN =
  /(刚刚|刚才|现在|此刻|半小时前|一小时前|两小时前|[0-9零〇一二两三四五六七八九十百]+小时前)/;

function chineseNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === "半") return 0.5;
  if (value.length === 1) {
    if (value === "十") return 10;
    if (value === "百") return 100;
    return digits[value];
  }
  let section = 0;
  let number = 0;
  for (const char of value) {
    const digit = digits[char];
    if (digit !== undefined) {
      number = digit;
      continue;
    }
    const unit = char === "十" ? 10 : char === "百" ? 100 : undefined;
    if (!unit) return undefined;
    section += (number || 1) * unit;
    number = 0;
  }
  return section + number || undefined;
}

function numberAfter(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  return match?.[1] ? chineseNumber(match[1]) : undefined;
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

interface ParsedTime {
  value: string;
  ambiguous: boolean;
  hint?: string;
  period?: string;
}

function parseTime(
  text: string,
  now: Date,
  inheritedPeriod?: string,
): ParsedTime | undefined {
  const relative = text.match(RELATIVE_PATTERN)?.[1];
  if (relative) {
    const date = cloneDate(now);
    if (relative.includes("小时前")) {
      const hoursText = relative.replace("小时前", "");
      const hours = hoursText === "半" ? 0.5 : (chineseNumber(hoursText) ?? 1);
      date.setMinutes(date.getMinutes() - hours * 60);
    }
    return { value: localDateTime(date), ambiguous: false, hint: relative };
  }
  const match = text.match(TIME_PATTERN);
  if (!match) return undefined;
  const [, dayWord, period, hourText, minuteWord, minuteText, colonMinute] =
    match;
  const hour = chineseNumber(hourText!);
  const minute =
    minuteWord === "半"
      ? 30
      : minuteWord === "一刻"
        ? 15
        : minuteWord === "三刻"
          ? 45
          : (minuteText ?? colonMinute)
            ? chineseNumber(minuteText ?? colonMinute!)
            : 0;
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) {
    return { value: "", ambiguous: true, hint: match[0] };
  }
  const effectivePeriod = period || inheritedPeriod;
  const vagueTime =
    /(?:点|时)\s*(?:多|左右|来?钟头?)/.test(match[0] ?? "") ||
    /(?:点|时)(?:多|左右)/.test(
      text.slice(
        match.index! + match[0].length - 1,
        match.index! + match[0].length + 2,
      ),
    );
  if (vagueTime) return { value: "", ambiguous: true, hint: match[0] };
  if (!effectivePeriod && hour <= 12)
    return { value: "", ambiguous: true, hint: match[0] };
  const date = cloneDate(now);
  if (dayWord === "昨天") date.setDate(date.getDate() - 1);
  if (dayWord === "前天") date.setDate(date.getDate() - 2);
  let normalizedHour = hour;
  if (effectivePeriod === "凌晨" && normalizedHour === 12) normalizedHour = 0;
  if (
    (effectivePeriod === "下午" ||
      effectivePeriod === "傍晚" ||
      effectivePeriod === "晚上") &&
    normalizedHour < 12
  )
    normalizedHour += 12;
  if (effectivePeriod === "中午" && normalizedHour < 11) normalizedHour += 12;
  if (normalizedHour > 23)
    return { value: "", ambiguous: true, hint: match[0] };
  date.setHours(normalizedHour, minute, 0, 0);
  return {
    value: localDateTime(date),
    ambiguous: false,
    period: period || inheritedPeriod,
    hint: match[0],
  };
}

function splitClauses(text: string): string[] {
  return text
    .replace(/(?:然后|接着|随后|之后)/g, "，")
    // 亲喂左右两侧属于同一次喂奶，逗号不能把它们拆成两条记录。
    .replace(/(左边[^，]{1,16})，(?=右边)/g, "$1 ")
    .replace(
      /(奶|尿布|尿不湿|便便|睡着了?|入睡)\s*(?=(?:(?:今天|昨天|前天)?(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?[0-9零〇一二两三四五六七八九十百]+\s*(?:点|时)))/g,
      "$1，",
    )
    .split(/[，,。；;！!？?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNegative(text: string, keyword: RegExp): boolean {
  const index = text.search(keyword);
  if (index < 0) return false;
  return NEGATIVE.test(text.slice(Math.max(0, index - 4), index + 2));
}

function kindFor(text: string): CareKind {
  if (
    /(?:喂|喝)(?:了|过|下)?[^，。；;]{0,12}(?:奶|奶粉|母乳)|奶量|奶瓶|配方奶|辅食|吸奶|挤奶|亲喂|米糊|果泥/.test(
      text,
    ) &&
    !/奶奶/.test(text)
  )
    return "feeding";
  if (/(?:睡着|入睡|睡了|睡的|醒(?:来|了|的)?|午睡|小睡)/.test(text))
    return "sleep";
  if (/(?:换|尿布|尿不湿|拉臭臭|便便)/.test(text)) return "diaper";
  return "note";
}

/** 从一句原话里抽取喂养细分字段；只识别确定的说法，含糊的留空交给家长。 */
function parseFeedingFields(clause: string): CareFields {
  const fields: CareFields = {};
  if (/吸奶|挤奶|泵奶/.test(clause)) fields.feedingMethod = "pump";
  else if (/配方奶|奶粉/.test(clause)) fields.feedingMethod = "bottle-formula";
  else if (/瓶喂母乳|母乳瓶/.test(clause))
    fields.feedingMethod = "bottle-breastmilk";
  else if (/辅食|米糊|果泥|菜泥|南瓜泥/.test(clause))
    fields.feedingMethod = "solid";
  else if (/亲喂|直接喂|母乳喂养/.test(clause)) fields.feedingMethod = "breast";

  const left = numberAfter(
    clause,
    /左边\s*([0-9零〇一二两三四五六七八九十百]+)\s*分钟?/,
  );
  const right = numberAfter(
    clause,
    /右边\s*([0-9零〇一二两三四五六七八九十百]+)\s*分钟?/,
  );
  if (left !== undefined || right !== undefined) {
    fields.feedingMethod = "breast";
    fields.breastSide =
      left !== undefined && right !== undefined
        ? "both"
        : left !== undefined
          ? "left"
          : "right";
    fields.leftMinutes = left;
    fields.rightMinutes = right;
  } else {
    const minutes = numberAfter(
      clause,
      /(?:喂奶|喝奶|吃奶|亲喂)\s*([0-9零〇一二两三四五六七八九十百]+)\s*分钟/,
    );
    if (minutes !== undefined) {
      fields.feedingMinutes = minutes;
      if (!fields.feedingMethod) fields.feedingMethod = "breast";
    }
  }

  if (fields.feedingMethod === "solid") {
    const food = clause.match(
      /辅食\s*([\u4e00-\u9fa5]{1,10}?)(?=半碗|一碗|几口|一点|，|。|；|$)/,
    )?.[1];
    if (food) fields.food = food;
  }
  const reaction = clause.match(/(?:过敏|起疹|湿疹|不适|吐了|拉肚子)/)?.[0];
  if (reaction) fields.reaction = reaction;
  return fields;
}

function isPlanned(text: string): boolean {
  return /(?:准备|打算|晚点|稍后|待会儿?|一会儿|明天|后天|等会儿?|计划)/.test(
    text,
  );
}

function titleFor(kind: CareKind, text: string): string {
  if (kind === "feeding") return "喂奶记录";
  if (kind === "sleep") return /醒/.test(text) ? "醒来记录" : "睡眠记录";
  if (kind === "diaper") return "换尿布记录";
  return "日常备注";
}

function parseClause(
  clause: string,
  now: Date,
  inheritedPeriod?: string,
): VoiceDraft {
  const kind = kindFor(clause);
  let parsedTime = parseTime(clause, now, inheritedPeriod);
  if (
    kind !== "note" &&
    /(?:今天|昨天|前天)/.test(clause) &&
    !TIME_PATTERN.test(clause) &&
    !RELATIVE_PATTERN.test(clause)
  ) {
    parsedTime = {
      value: "",
      ambiguous: true,
      hint: clause.match(/今天|昨天|前天/)?.[0],
    };
  }
  const durationMinutes =
    kind === "sleep"
      ? (numberAfter(
          clause,
          /睡了\s*(半|[0-9零〇一二两三四五六七八九十百]+)\s*(?:个)?小时/,
        ) ?? 0) *
          60 +
          (numberAfter(
            clause,
            /睡了\s*([0-9零〇一二两三四五六七八九十百]+)\s*分钟?/,
          ) ?? 0) || undefined
      : undefined;
  const amountMl =
    kind === "feeding"
      ? numberAfter(
          clause,
          /([0-9零〇一二两三四五六七八九十百]+)\s*(?:毫升|ml|ML)/,
        )
      : undefined;
  const feedingFields =
    kind === "feeding" ? parseFeedingFields(clause) : {};
  const diaper =
    kind === "diaper"
      ? /(?:便便|拉臭|脏)/.test(clause)
        ? "dirty"
        : /(?:尿湿|尿了|湿了|湿尿布)/.test(clause)
          ? "wet"
          : "changed"
      : undefined;
  const sleepState =
    kind === "sleep"
      ? /醒/.test(clause)
        ? "awake"
        : durationMinutes
          ? "duration"
          : "asleep"
      : undefined;
  const needsTimeConfirmation = Boolean(parsedTime?.ambiguous);
  const capturedAt = parsedTime?.value ?? localDateTime(now);
  const title = titleFor(kind, clause);
  return {
    id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title,
    note: clause,
    capturedAt: needsTimeConfirmation ? "" : capturedAt,
    needsTimeConfirmation,
    timeHint: parsedTime?.hint,
    amountMl,
    durationMinutes,
    sleepState,
    diaper,
    ...feedingFields,
    sourceText: clause,
  };
}

function parseNoteClause(clause: string, now: Date): VoiceDraft {
  const draft = parseClause(clause, now);
  return {
    ...draft,
    kind: "note",
    title: "日常备注",
    note: clause,
    capturedAt: localDateTime(now),
    needsTimeConfirmation: false,
    timeHint: undefined,
    amountMl: undefined,
    durationMinutes: undefined,
    sleepState: undefined,
    diaper: undefined,
    feedingMethod: undefined,
    breastSide: undefined,
    leftMinutes: undefined,
    rightMinutes: undefined,
    feedingMinutes: undefined,
    food: undefined,
    reaction: undefined,
  };
}

export function parseVoiceTranscript(
  text: string,
  now = new Date(),
): VoiceDraft[] {
  const source = text.trim();
  if (!source) return [];
  const clauses = splitClauses(source);
  const result: VoiceDraft[] = [];
  let inheritedPeriod: string | undefined;
  for (const clause of clauses) {
    const kind = kindFor(clause);
    if (isPlanned(clause)) {
      result.push(parseNoteClause(clause, now));
      continue;
    }
    const keyword =
      kind === "feeding"
        ? /喂|喝|奶量|奶瓶/
        : kind === "sleep"
          ? /睡|醒/
          : kind === "diaper"
            ? /尿布|尿不湿|便便|换/
            : /.+/;
    if (kind !== "note" && isNegative(clause, keyword)) continue;
    const draft = parseClause(clause, now, inheritedPeriod);
    const explicitPeriod =
      clause.match(/凌晨|早上|上午|中午|下午|傍晚|晚上/)?.[0];
    if (explicitPeriod) inheritedPeriod = explicitPeriod;
    result.push(draft);
  }
  if (!result.length) return [];
  if (result.length > 1 && result.every((draft) => draft.kind === "note")) {
    return [parseClause(source, now, inheritedPeriod)];
  }
  return result;
}

export function validateVoiceDraft(draft: VoiceDraft): string | null {
  if (!draft.title.trim()) return "请给这条记录取个名字。";
  if (!draft.sourceText.trim()) return "没有识别到可保存的原话。";
  if (draft.needsTimeConfirmation) return "请确认记录发生的时间后再保存。";
  if (!draft.capturedAt || Number.isNaN(new Date(draft.capturedAt).getTime()))
    return "记录时间无效。";
  for (const value of [
    draft.amountMl,
    draft.durationMinutes,
    draft.leftMinutes,
    draft.rightMinutes,
    draft.feedingMinutes,
  ]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
      return "数量和时长需要是大于 0 的数字，也可以留空。";
  }
  return null;
}

export function voiceDraftToEntry(
  draft: VoiceDraft,
  inputId: string,
): EntryDraft {
  // 未设置的可选字段不写进 care，保持旧记录结构与备份内容不变。
  const extras = Object.fromEntries(
    Object.entries({
      feedingMethod: draft.feedingMethod,
      breastSide: draft.breastSide,
      leftMinutes: draft.leftMinutes,
      rightMinutes: draft.rightMinutes,
      feedingMinutes: draft.feedingMinutes,
      food: draft.food,
      reaction: draft.reaction,
    }).filter(([, value]) => value !== undefined),
  ) as CareFields;
  return {
    title: draft.title,
    note:
      draft.kind === "note" || draft.note !== draft.sourceText
        ? draft.note
        : "",
    capturedAt: draft.capturedAt,
    tag: CARE_LABELS[draft.kind],
    milestone: false,
    care: {
      kind: draft.kind,
      amountMl: draft.amountMl,
      durationMinutes: draft.durationMinutes,
      sleepState: draft.sleepState,
      diaper: draft.diaper,
      ...extras,
      sourceText: draft.sourceText,
      inputId,
    },
  };
}
