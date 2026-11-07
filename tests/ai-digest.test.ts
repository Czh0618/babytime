import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatsDigest, guardMedicalOutput } from "../src/domain/ai.ts";
import type { DayStats } from "../src/domain/stats.ts";

function day(date: string, overrides: Partial<DayStats> = {}): DayStats {
  return {
    date,
    hasData: true,
    feedingCount: 4,
    intakeMl: 480,
    pumpedMl: 0,
    sleepMinutes: 720,
    diaperCount: 5,
    wetCount: 4,
    dirtyCount: 1,
    ...overrides,
  };
}

test("聚合输入只含数字与日期，不含姓名、生日和原话", () => {
  const digest = buildStatsDigest(
    [day("2026-11-05"), day("2026-11-06", { feedingCount: 3, intakeMl: 360 })],
    { ageMonths: 6, night: { wakeCount: 2, longestSleepMinutes: 330 } },
  );
  const payload = JSON.parse(digest);
  assert.equal(payload.ageMonths, 6);
  assert.equal(payload.days.length, 2);
  assert.equal(payload.days[1].date, "11-06");
  assert.equal(payload.days[1].feeding, 3);
  assert.equal(payload.days[0].sleepH, 12);
  assert.equal(payload.night.wakeCount, 2);
  assert.equal(payload.night.longestSleepH, 5.5);

  for (const forbidden of ["小满", "2026-01-31", "喂奶", "原话", "name"])
    assert.equal(digest.includes(forbidden), false, forbidden);
});

test("30 天的聚合仍然很小，可以直接发给模型", () => {
  const days = Array.from({ length: 30 }, (_, index) =>
    day(`2026-11-${String(index + 1).padStart(2, "0")}`),
  );
  const digest = buildStatsDigest(days);
  assert.ok(digest.length < 3000, `实际 ${digest.length} 字符`);
  assert.equal(digest.includes("ageMonths"), false, "没有月龄就不写这个字段");
});

test("守门：剂量 + 药名、诊断与用药建议会换成固定提示", () => {
  const hits = [
    "可以吃 2.5ml 美林。",
    "建议服用布洛芬 5 毫克试试。",
    "这可能是肺炎。",
    "需要尽快就医。",
    "确诊是感冒了。",
    "这种情况下应该吃点药。",
  ];
  for (const text of hits) {
    const result = guardMedicalOutput(text);
    assert.equal(result.guarded, true, text);
    assert.match(result.text, /请咨询医生/, text);
    assert.equal(result.text.includes("美林"), false, text);
  }
});

test("守门：纯数据描述与普通建议不误伤", () => {
  const safe = [
    "夜间喂奶从 3 次降到 2 次。",
    "这周睡眠总时长 12 小时，比上周多 1 小时。",
    "尿布次数比上周少了 4 次。",
    "今天喂奶 480 ml，共 4 次。",
    "最近三天数据不足，暂时看不出变化。",
    "白天小睡更集中在下午。",
  ];
  for (const text of safe) {
    const result = guardMedicalOutput(text);
    assert.equal(result.guarded, false, text);
    assert.equal(result.text, text.trim(), text);
  }
});

test("守门只替换命中的那一句", () => {
  const result = guardMedicalOutput(
    "夜间喂奶从 3 次降到 2 次。可以吃 2.5ml 美林。",
  );
  assert.equal(result.guarded, true);
  assert.ok(result.text.startsWith("夜间喂奶从 3 次降到 2 次。"));
  assert.match(result.text, /请咨询医生/);
});

test("空输出不会崩", () => {
  assert.deepEqual(guardMedicalOutput("   "), { text: "", guarded: false });
});
