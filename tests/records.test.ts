import { test } from "node:test";
import assert from "node:assert/strict";
import { dayAge } from "../src/domain/date.ts";
import { demoWorkspace, emptyWorkspace } from "../src/domain/seed.ts";
import {
  addDemo,
  confirmCandidate,
  removeDemo,
  removeEntry,
  validateEntry,
  validateRecap,
} from "../src/domain/records.ts";

test("日龄跨闰日计算，出生当天记为第一天", () => {
  assert.equal(dayAge("2024-02-28", "2024-03-01"), 3);
  assert.equal(dayAge("2026-11-04", "2026-11-04"), 1);
});

test("重复确认不覆盖家长已经保存的内容，也不生成重复记录", () => {
  const workspace = demoWorkspace();
  const candidate = workspace.candidates[0]!;
  const draft = {
    title: "我改过的标题",
    note: "家长备注",
    capturedAt: candidate.capturedAt,
    tag: "亲子互动",
    milestone: false,
    start: 8,
    end: 16,
  };
  const first = confirmCandidate(workspace, candidate, draft, "confirmed-1");
  const second = confirmCandidate(
    workspace,
    candidate,
    { ...draft, title: "算法重跑后的标题" },
    "confirmed-2",
  );
  assert.equal(workspace.entries.length, 4);
  assert.equal(second, first);
  assert.equal(second.title, "我改过的标题");
});

test("片段边界非法时不能确认", () => {
  const draft = {
    title: "瞬间",
    note: "",
    capturedAt: "2026-11-04T12:00",
    tag: "日常片刻",
    milestone: false,
    start: 10,
    end: 30,
  };
  assert.ok(validateEntry(draft, 20));
  assert.ok(validateEntry({ ...draft, end: Number.NaN }, 20));
  assert.equal(validateEntry({ ...draft, end: 15 }, 20), null);
});

test("删除记录后回顾不保留悬空引用，原片不被连带删除", () => {
  const workspace = demoWorkspace();
  workspace.recaps.push({
    id: "r",
    title: "一周",
    entryIds: ["demo-entry-0", "demo-entry-1"],
    dateFrom: "2020-01-01",
    dateTo: "2030-01-01",
    createdAt: "2026-11-04",
  });
  removeEntry(workspace, "demo-entry-0");
  assert.deepEqual(workspace.recaps[0]!.entryIds, ["demo-entry-1"]);
  assert.ok(workspace.media.some((media) => media.id === "demo-media-0"));
});

test("清除示例不会删除真实导入或手动记录", () => {
  const workspace = demoWorkspace();
  workspace.entries.push({
    id: "real",
    title: "真实记录",
    note: "",
    capturedAt: "2026-11-04T10:00",
    tag: "日常片刻",
    milestone: false,
    favorite: false,
  });
  removeDemo(workspace);
  assert.deepEqual(
    workspace.entries.map((entry) => entry.id),
    ["real"],
  );
  assert.equal(workspace.candidates.length, 0);
});

test("回顾不能引用日期范围外或尚不存在的记录", () => {
  const workspace = demoWorkspace();
  assert.ok(
    validateRecap(
      {
        title: "回顾",
        entryIds: ["missing"],
        dateFrom: "2020-01-01",
        dateTo: "2030-01-01",
      },
      workspace.entries,
    ),
  );
});

test("示例按需加载：不覆盖已有宝宝资料，清除后回到原状", () => {
  const workspace = emptyWorkspace();
  workspace.baby = { name: "豆豆", birthDate: "2026-10-01" };
  const before = JSON.parse(JSON.stringify(workspace));
  addDemo(workspace);
  addDemo(workspace); // 重复加载不叠加
  assert.equal(workspace.baby.name, "豆豆");
  assert.equal(
    workspace.entries.length,
    demoWorkspace().entries.length,
  );
  removeDemo(workspace);
  assert.deepEqual(workspace, before);

  const blank = emptyWorkspace();
  const blankBefore = JSON.parse(JSON.stringify(blank));
  addDemo(blank);
  addDemo(blank);
  assert.equal(blank.baby.name, demoWorkspace().baby.name);
  removeDemo(blank);
  assert.deepEqual(blank, blankBefore);
});

test("示例加载后保存的宝宝资料不会在清除示例时被覆盖", () => {
  const workspace = emptyWorkspace();
  addDemo(workspace);
  workspace.baby = { name: "豆豆", birthDate: "2026-10-01" };

  removeDemo(workspace);

  assert.deepEqual(workspace.baby, {
    name: "豆豆",
    birthDate: "2026-10-01",
  });
  assert.equal(workspace.demoProfileRestorePoint, undefined);
});
