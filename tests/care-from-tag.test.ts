import { test } from "node:test";
import assert from "node:assert/strict";
import { careFromTag } from "../src/domain/care-types.ts";
import { describeCare } from "../src/domain/care-records.ts";
import { validateEntry } from "../src/domain/records.ts";
import { isWorkspace } from "../src/domain/workspace-schema.ts";
import { localDate } from "../src/domain/date.ts";
import type { EntryDraft } from "../src/types.ts";

test("照护标签映射成对应的 CareObservation", () => {
  assert.deepEqual(careFromTag("喂奶"), { kind: "feeding", sourceText: "" });
  assert.deepEqual(careFromTag("睡眠"), { kind: "sleep", sourceText: "" });
  assert.deepEqual(careFromTag("换尿布"), { kind: "diaper", sourceText: "" });
  assert.deepEqual(careFromTag("日常备注"), { kind: "note", sourceText: "" });
});

test("普通分类标签与未知标签不生成照护记录", () => {
  for (const tag of ["日常片刻", "亲子互动", "家庭合影", "成长瞬间", "未知"]) {
    assert.equal(careFromTag(tag), undefined, tag);
  }
});

test("传入的原话会保留，便于复用已有照护记录", () => {
  assert.deepEqual(careFromTag("喂奶", "三点喂了奶"), {
    kind: "feeding",
    sourceText: "三点喂了奶",
  });
});

test("手动新建一条喂奶 90ml：校验通过、今日卡片会计入并显示奶量", () => {
  const care = careFromTag("喂奶")!;
  care.amountMl = 90;
  const draft: EntryDraft = {
    title: "喂奶",
    note: "",
    capturedAt: `${localDate()}T10:30`,
    tag: "喂奶",
    milestone: false,
    care,
  };
  assert.equal(validateEntry(draft), null);
  // TodayCareSummary 的筛选条件：有 care 且发生日期为今天。
  assert.ok(draft.care);
  assert.equal(draft.capturedAt.slice(0, 10), localDate());
  assert.equal(describeCare(draft.care), "90 ml");
  assert.equal(describeCare(careFromTag("睡眠")!), "已记录睡眠");
});

test("改回普通标签等价于清除 care，旧记录结构不受影响", () => {
  assert.equal(careFromTag("成长瞬间"), undefined);
  const legacyWorkspace = {
    schemaVersion: 1,
    baby: { name: "宝宝", birthDate: "" },
    media: [],
    candidates: [],
    entries: [
      {
        id: "legacy-1",
        title: "一个瞬间",
        note: "",
        capturedAt: "2026-11-04T10:00",
        tag: "日常片刻",
        favorite: false,
        milestone: false,
      },
    ],
    recaps: [],
  };
  assert.equal(isWorkspace(legacyWorkspace), true);
});
