import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correctedBirthDate,
  growthSeries,
  latestMeasurement,
  measurementDraft,
  monthsBetween,
} from "../src/domain/growth.ts";
import { parseVoiceTranscript, validateVoiceDraft } from "../src/domain/voice-parser.ts";
import { parseAIVoiceDrafts } from "../src/domain/ai.ts";
import { validateEntry } from "../src/domain/records.ts";
import type { BabyProfile, GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

function measurement(capturedAt: string, care: CareObservation): GrowthEntry {
  return {
    id: capturedAt,
    title: "测量",
    note: "",
    capturedAt,
    tag: "测量",
    favorite: false,
    milestone: false,
    care,
  };
}

const baby: BabyProfile = { name: "小满", birthDate: "2026-05-01" };
const now = new Date(2026, 10, 7, 10, 0);

test("语音一次说出体重与身高时合并成一条测量记录", () => {
  const drafts = parseVoiceTranscript("今天量了体重7.2公斤，身高65厘米", now);
  assert.equal(drafts.length, 1);
  const draft = drafts[0]!;
  assert.equal(draft.kind, "measurement");
  assert.equal(draft.weightKg, 7.2);
  assert.equal(draft.heightCm, 65);
  // 「今天」没说几点，按既有规则要求家长确认时间。
  assert.equal(draft.needsTimeConfirmation, true);
  draft.capturedAt = "2026-11-07T10:00";
  draft.needsTimeConfirmation = false;
  assert.equal(validateVoiceDraft(draft), null);
});

test("只报一项也能记，越界值要拦下来", () => {
  const [weightOnly] = parseVoiceTranscript("称了体重8.1公斤", now);
  assert.equal(weightOnly!.weightKg, 8.1);
  assert.equal(weightOnly!.heightCm, undefined);

  const [head] = parseVoiceTranscript("头围42厘米", now);
  assert.equal(head!.headCm, 42);

  const [bad] = parseVoiceTranscript("体重120公斤", now);
  assert.match(validateVoiceDraft(bad)!, /体重需要在/);
});

test("手动测量草稿能通过记录校验，三项全空会被拦下", () => {
  const draft = measurementDraft({ weightKg: 7.2, heightCm: 65 }, now);
  assert.equal(draft.care?.kind, "measurement");
  assert.equal(draft.tag, "测量");
  assert.equal(validateEntry(draft), null);
  assert.match(
    validateEntry(measurementDraft({}, now))!,
    /至少要填/,
  );
});

test("体重、身高/身长、头围允许两位小数，超过两位要拦下", () => {
  const draft = measurementDraft(
    { weightKg: 7.25, heightCm: 65.25, headCm: 42.35 },
    now,
  );
  assert.equal(validateEntry(draft), null);

  const [voice] = parseVoiceTranscript("身长65.25厘米，头围42.35厘米", now);
  assert.equal(voice!.heightCm, 65.25);
  assert.equal(voice!.headCm, 42.35);
  assert.equal(validateVoiceDraft(voice!), null);

  assert.match(
    validateEntry(measurementDraft({ heightCm: 65.255 }, now))!,
    /最多保留 2 位小数/,
  );
  // 语音里的更多位小数收敛到两位，草稿不会卡在校验上。
  const [precise] = parseVoiceTranscript("体重7.257公斤", now);
  assert.equal(precise!.weightKg, 7.26);
  assert.equal(validateVoiceDraft(precise!), null);
});

test("早产按矫正月龄画：预产期晚于生日时用预产期做起点", () => {
  const preterm: BabyProfile = {
    name: "小满",
    birthDate: "2026-05-01",
    dueDate: "2026-07-01",
  };
  assert.deepEqual(correctedBirthDate(preterm), {
    date: "2026-07-01",
    corrected: true,
  });
  assert.deepEqual(correctedBirthDate(baby), {
    date: "2026-05-01",
    corrected: false,
  });

  const series = growthSeries(
    [
      measurement("2026-09-01T10:00", {
        kind: "measurement",
        weightKg: 5.2,
        sourceText: "",
      }),
      measurement("2026-11-01T10:00", {
        kind: "measurement",
        weightKg: 7.2,
        sourceText: "",
      }),
    ],
    preterm,
    "weightKg",
  );
  assert.equal(series.length, 2);
  assert.equal(series[0]!.value, 5.2);
  assert.equal(series[1]!.value, 7.2);
  // 9-01 距预产期 7-01 约 2 个月
  assert.ok(Math.abs(series[0]!.months - monthsBetween("2026-07-01", "2026-09-01")) < 0.01);
});

test("曲线只取有值的测量点，并按时间排序", () => {
  const series = growthSeries(
    [
      measurement("2026-10-01T10:00", {
        kind: "measurement",
        heightCm: 66,
        sourceText: "",
      }),
      measurement("2026-08-01T10:00", {
        kind: "measurement",
        heightCm: 62,
        sourceText: "",
      }),
      measurement("2026-09-01T10:00", {
        kind: "feeding",
        amountMl: 120,
        sourceText: "喂奶",
      }),
    ],
    baby,
    "heightCm",
  );
  assert.deepEqual(
    series.map((point) => point.value),
    [62, 66],
  );
  assert.equal(latestMeasurement([
    measurement("2026-08-01T10:00", {
      kind: "measurement",
      weightKg: 6.1,
      sourceText: "",
    }),
    measurement("2026-10-01T10:00", {
      kind: "measurement",
      weightKg: 7.2,
      heightCm: 65,
      sourceText: "",
    }),
  ])?.weightKg, 7.2);
});

test("AI 输出的测量值按区间收敛，越界丢弃并提示核对", () => {
  const [ok] = parseAIVoiceDrafts(
    JSON.stringify({
      items: [
        {
          kind: "measurement",
          capturedAt: "2026-11-07T10:00",
          weightKg: 7.2,
          heightCm: 65,
          headCm: 42,
          sourceText: "体重7.2公斤，身高65厘米",
        },
      ],
    }),
    "体重7.2公斤，身高65厘米",
  );
  assert.equal(ok!.weightKg, 7.2);
  assert.equal(ok!.heightCm, 65);
  assert.equal(ok!.headCm, 42);

  const [bad] = parseAIVoiceDrafts(
    JSON.stringify({
      items: [
        {
          kind: "measurement",
          capturedAt: "2026-11-07T10:00",
          weightKg: 120,
          heightCm: 65,
          sourceText: "体重120公斤",
        },
      ],
    }),
    "体重120公斤",
  );
  assert.equal(bad!.weightKg, undefined);
  assert.match(bad!.reviewNote ?? "", /体重/);
});
