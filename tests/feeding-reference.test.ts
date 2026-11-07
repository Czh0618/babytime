import { test } from "node:test";
import assert from "node:assert/strict";
import { nextFeedingReference } from "../src/domain/feeding.ts";
import type { GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

function feeding(
  capturedAt: string,
  care: CareObservation = { kind: "feeding", sourceText: "喂奶" },
  id = capturedAt,
): GrowthEntry {
  return {
    id,
    title: "喂奶",
    note: "",
    capturedAt,
    tag: "喂奶",
    favorite: false,
    milestone: false,
    care,
  };
}

const at = (iso: string) => new Date(iso);

test("按最近几次间隔的中位数给出参考时间", () => {
  const entries = [
    feeding("2026-11-07T08:00"),
    feeding("2026-11-07T11:00"),
    feeding("2026-11-07T14:00"),
    feeding("2026-11-07T17:00"),
  ];
  const reference = nextFeedingReference(entries, at("2026-11-07T18:00"));
  assert.deepEqual(reference, { time: "20:00", sampleSize: 3, passed: false });
});

test("只取最近 5 个间隔，样本数写在结果里", () => {
  const entries = ["02:00", "05:00", "08:00", "11:00", "14:00", "17:00", "20:00"].map(
    (time) => feeding(`2026-11-07T${time}`),
  );
  const reference = nextFeedingReference(entries, at("2026-11-07T21:00"));
  assert.equal(reference?.sampleSize, 5);
  assert.equal(reference?.time, "23:00");
});

test("偶数个间隔取中间两个的平均值", () => {
  const entries = [
    feeding("2026-11-07T06:00"),
    feeding("2026-11-07T08:00"), // 120
    feeding("2026-11-07T11:00"), // 180
    feeding("2026-11-07T15:00"), // 240
    feeding("2026-11-07T20:00"), // 300
  ];
  const reference = nextFeedingReference(entries, at("2026-11-07T20:30"));
  // 中位数 = (180 + 240) / 2 = 210 分钟
  assert.equal(reference?.time, "23:30");
});

test("少于 3 个间隔时不显示参考", () => {
  assert.equal(
    nextFeedingReference([feeding("2026-11-07T08:00")], at("2026-11-07T09:00")),
    null,
  );
  assert.equal(
    nextFeedingReference(
      [feeding("2026-11-07T08:00"), feeding("2026-11-07T11:00")],
      at("2026-11-07T12:00"),
    ),
    null,
  );
});

test("吸奶记录不参与喂奶间隔，未来的记录也不算", () => {
  const pump: CareObservation = {
    kind: "feeding",
    feedingMethod: "pump",
    amountMl: 120,
    sourceText: "吸奶 120ml",
  };
  const entries = [
    feeding("2026-11-07T08:00"),
    feeding("2026-11-07T11:00"),
    feeding("2026-11-07T14:00"),
    feeding("2026-11-07T16:00", pump, "pump"),
    feeding("2026-11-07T17:00"),
    feeding("2026-11-07T23:00"),
  ];
  const reference = nextFeedingReference(entries, at("2026-11-07T18:00"));
  assert.equal(reference?.sampleSize, 3);
  assert.equal(reference?.time, "20:00");
});

test("间隔异常或上一次喂奶超过一天时不显示", () => {
  const odd = [
    feeding("2026-11-07T08:00"),
    feeding("2026-11-07T08:05"),
    feeding("2026-11-07T08:10"),
    feeding("2026-11-07T17:00"),
  ];
  assert.equal(nextFeedingReference(odd, at("2026-11-07T17:30")), null);

  const stale = [
    feeding("2026-11-05T08:00"),
    feeding("2026-11-05T11:00"),
    feeding("2026-11-05T14:00"),
    feeding("2026-11-05T17:00"),
  ];
  assert.equal(nextFeedingReference(stale, at("2026-11-07T09:00")), null);
});

test("参考时间已过去时标记 passed", () => {
  const entries = [
    feeding("2026-11-07T08:00"),
    feeding("2026-11-07T11:00"),
    feeding("2026-11-07T14:00"),
    feeding("2026-11-07T17:00"),
  ];
  const reference = nextFeedingReference(entries, at("2026-11-07T21:30"));
  assert.equal(reference?.time, "20:00");
  assert.equal(reference?.passed, true);
});
