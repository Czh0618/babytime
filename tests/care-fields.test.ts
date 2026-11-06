import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCare, summarizeMilk } from "../src/domain/care-records.ts";
import { isWorkspace, parseBackupContent } from "../src/domain/workspace-schema.ts";
import { localDate } from "../src/domain/date.ts";
import type { CareObservation } from "../src/domain/care-types.ts";
import type { GrowthEntry } from "../src/types.ts";

function makeEntry(care: CareObservation, date = localDate()): GrowthEntry {
  return {
    id: `entry-${date}-${care.kind}-${care.amountMl ?? "x"}-${care.feedingMethod ?? "x"}`,
    title: "照护记录",
    note: "",
    capturedAt: `${date}T10:00`,
    tag: "喂奶",
    favorite: false,
    milestone: false,
    care,
  };
}

test("今日奶量：吸出量单独统计，不计入宝宝摄入", () => {
  const entries = [
    makeEntry({ kind: "feeding", amountMl: 90, sourceText: "喂奶90ml" }),
    makeEntry({
      kind: "feeding",
      amountMl: 60,
      feedingMethod: "bottle-formula",
      sourceText: "配方奶60ml",
    }),
    makeEntry({
      kind: "feeding",
      amountMl: 120,
      feedingMethod: "pump",
      sourceText: "吸奶120ml",
    }),
  ];
  assert.deepEqual(summarizeMilk(entries), { intakeMl: 150, pumpedMl: 120 });
});

test("聚合忽略其他日期、没有奶量的记录和非照护记录", () => {
  const entries = [
    makeEntry({ kind: "feeding", amountMl: 90, sourceText: "今天" }),
    makeEntry({ kind: "feeding", amountMl: 200, sourceText: "昨天" }, "2026-11-05"),
    makeEntry({ kind: "feeding", sourceText: "亲喂" }),
    makeEntry({ kind: "sleep", amountMl: 999, sourceText: "睡眠" }),
  ];
  assert.deepEqual(summarizeMilk(entries, localDate()), {
    intakeMl: 90,
    pumpedMl: 0,
  });
  assert.deepEqual(summarizeMilk([], localDate()), { intakeMl: 0, pumpedMl: 0 });
});

test("记录描述区分亲喂、配方奶、辅食与吸奶", () => {
  assert.equal(
    describeCare({
      kind: "feeding",
      feedingMethod: "breast",
      breastSide: "both",
      leftMinutes: 15,
      rightMinutes: 10,
      sourceText: "亲喂",
    }),
    "亲喂 左 15 分 / 右 10 分",
  );
  assert.equal(
    describeCare({
      kind: "feeding",
      feedingMethod: "bottle-formula",
      amountMl: 90,
      sourceText: "配方奶",
    }),
    "配方奶 90 ml",
  );
  assert.equal(
    describeCare({
      kind: "feeding",
      feedingMethod: "solid",
      food: "南瓜泥",
      sourceText: "辅食",
    }),
    "辅食 · 南瓜泥",
  );
  assert.equal(
    describeCare({
      kind: "feeding",
      feedingMethod: "pump",
      amountMl: 120,
      sourceText: "吸奶",
    }),
    "吸奶 120 ml",
  );
  assert.equal(
    describeCare({ kind: "feeding", amountMl: 90, sourceText: "喂奶" }),
    "90 ml",
  );
});

const workspaceWith = (care: CareObservation | Record<string, unknown>) => ({
  schemaVersion: 1,
  baby: { name: "宝宝", birthDate: "" },
  media: [],
  candidates: [],
  entries: [
    {
      id: "e1",
      title: "喂奶",
      note: "",
      capturedAt: "2026-11-06T10:00",
      tag: "喂奶",
      favorite: false,
      milestone: false,
      care,
    },
  ],
  recaps: [],
});

test("旧备份（care 没有新字段）仍能导入", () => {
  const legacy = workspaceWith({
    kind: "feeding",
    amountMl: 90,
    sourceText: "喂奶90ml",
  });
  assert.equal(isWorkspace(legacy), true);
  const parsed = parseBackupContent(JSON.stringify(legacy));
  assert.equal(parsed.workspace.entries[0]!.care?.amountMl, 90);
  assert.equal(parsed.workspace.entries[0]!.care?.feedingMethod, undefined);
});

test("带合法新字段的备份可以导入", () => {
  const modern = workspaceWith({
    kind: "feeding",
    amountMl: 120,
    feedingMethod: "pump",
    breastSide: undefined,
    food: undefined,
    reaction: undefined,
    sourceText: "吸奶120ml",
  });
  const parsed = parseBackupContent(JSON.stringify(modern));
  assert.equal(parsed.workspace.entries[0]!.care?.feedingMethod, "pump");
});

test("非法枚举与非数值的新字段会被备份校验拒绝", () => {
  const bad = workspaceWith({
    kind: "feeding",
    feedingMethod: "unknown-method",
    leftMinutes: "15",
    sourceText: "喂奶",
  });
  assert.throws(() => parseBackupContent(JSON.stringify(bad)));
});
