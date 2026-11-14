import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHILD_HEALTH_CHECKS,
  HEALTH_CHECK_SOURCE,
} from "../src/data/child-health-checks.ts";
import {
  cancelHealthCheck,
  completeHealthCheck,
  healthCheckDueDate,
  healthCheckTasks,
} from "../src/domain/health-checks.ts";
import {
  buildHealthCheckIcs,
  healthCheckIcsFileName,
} from "../src/lib/ics.ts";
import type { BabyProfile } from "../src/types.ts";

const node = (id: string) => {
  const found = CHILD_HEALTH_CHECKS.find((item) => item.id === id);
  if (!found) throw new Error(`缺少节点 ${id}`);
  return found;
};

test("P8.1.1 十三个节点来自第三版规范原文，出处与文号齐全", () => {
  assert.equal(CHILD_HEALTH_CHECKS.length, 13);
  assert.deepEqual(
    CHILD_HEALTH_CHECKS.map((item) => item.id),
    [
      "newborn-visit", "full-month", "m3", "m6", "m8", "m12", "m18",
      "m24", "m30", "m36", "y4", "y5", "y6",
    ],
  );
  assert.match(HEALTH_CHECK_SOURCE, /第三版/);
  assert.match(HEALTH_CHECK_SOURCE, /2017〕13 号/);
  assert.equal(node("newborn-visit").anytime, true);
  assert.equal(node("newborn-visit").timing, "出院后 1 周内");
  assert.deepEqual(node("full-month").dayRange, { min: 28, max: 30 });
  assert.equal(node("m6").teethCount, true);
  assert.equal(node("m8").teethCount, true);
});

test("P8.1.1 项目月龄：血常规、听力、视力、口腔、出牙数", () => {
  const itemsOf = (id: string) => node(id).items.map((item) => item.id);
  assert.deepEqual(itemsOf("m3"), ["oral"], "3 月龄查口腔");
  assert.deepEqual(itemsOf("m6"), ["blood", "hearing", "oral"]);
  assert.deepEqual(itemsOf("m8"), ["blood", "oral"]);
  assert.deepEqual(itemsOf("m12"), ["hearing"]);
  assert.deepEqual(itemsOf("m18"), ["blood"]);
  assert.deepEqual(itemsOf("m24"), ["hearing"]);
  assert.deepEqual(itemsOf("m30"), ["blood"]);
  assert.deepEqual(itemsOf("m36"), ["hearing"]);
  for (const id of ["y4", "y5", "y6"])
    assert.deepEqual(itemsOf(id), ["blood", "vision"], "4～6 岁每年血常规与视力筛查");
  assert.match(CHILD_HEALTH_CHECKS.map((n) => n.id).join(","), /^(?!.*m7)/);
  assert.match(node("m6").items[1]!.label, /行为测听法/);
  assert.match(node("m6").items[0]!.note!, /6～8 月龄期间 1 次/);
});

test("P8.1.2 参考日期：月末顺延、闰年、满月按天数、访视无日期", () => {
  assert.equal(healthCheckDueDate(node("newborn-visit"), "2026-01-31"), undefined);
  assert.equal(healthCheckDueDate(node("full-month"), "2026-01-31"), "2026-02-28");
  assert.equal(healthCheckDueDate(node("m3"), "2026-01-31"), "2026-04-30");
  assert.equal(healthCheckDueDate(node("m6"), "2026-08-31"), "2027-02-28");
  assert.equal(healthCheckDueDate(node("m12"), "2024-02-29"), "2025-02-28");
  assert.equal(healthCheckDueDate(node("y6"), "2024-02-29"), "2030-02-28");
  assert.equal(healthCheckDueDate(node("m3"), ""), undefined);
});

test("P8.1.2 状态与疫苗同口径：已完成 / 30 天内 / 已过 / 未到", () => {
  const baby: BabyProfile = { name: "小满", birthDate: "2026-01-31" };
  const today = "2026-04-30";
  const tasks = healthCheckTasks(baby, {}, today);
  assert.equal(tasks.length, 13);
  assert.equal(tasks.find((item) => item.node.id === "m3")!.dueDate, "2026-04-30");
  assert.equal(tasks.find((item) => item.node.id === "m3")!.status, "due-soon");
  assert.equal(tasks.find((item) => item.node.id === "m6")!.status, "upcoming");
  assert.equal(tasks.find((item) => item.node.id === "newborn-visit")!.status, "upcoming");
  assert.equal(tasks.find((item) => item.node.id === "newborn-visit")!.dueDate, undefined);
  const late = healthCheckTasks(baby, {}, "2026-05-01");
  assert.equal(late.find((item) => item.node.id === "m3")!.status, "overdue");
  const done = healthCheckTasks(
    baby,
    completeHealthCheck({}, "m3", { date: "2026-04-29", place: "社区卫生服务中心" }),
    today,
  );
  assert.equal(done.find((item) => item.node.id === "m3")!.status, "done");
  assert.equal(healthCheckTasks({ name: "未填", birthDate: "" }, {}, today).length, 0);
});

test("P8.1.3 完成 / 撤销记录不改写原对象，6～8 月区间不生成额外日期", () => {
  const empty = {};
  const record = { date: "2026-08-01", teethCount: 2, note: "按实际出牙数" };
  const filled = completeHealthCheck(empty, "m6", record);
  assert.equal(Object.keys(empty).length, 0);
  assert.deepEqual(filled["m6"], record);
  assert.deepEqual(cancelHealthCheck(filled, "m6"), {});
  const dates = healthCheckTasks(
    { name: "小满", birthDate: "2026-01-01" },
    {},
  ).map((item) => item.dueDate);
  assert.equal(
    dates.filter((date) => date === "2026-08-01").length,
    0,
    "6～8 月龄血常规写成区间，不另设 7 月龄（2026-08-01）节点",
  );
  assert.ok(dates.includes("2026-07-01"), "6 月龄节点");
  assert.ok(dates.includes("2026-09-01"), "8 月龄节点");
  assert.ok(!CHILD_HEALTH_CHECKS.some((item) => item.id === "m7"));
});

test("P8.1.5 体检节点可导出 .ics，整日事件与提前一天提醒齐全", () => {
  const event = { id: "m6", name: "6 月龄", dueDate: "2026-07-31" };
  const ics = buildHealthCheckIcs(event, new Date("2026-11-07T08:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0"));
  assert.match(ics, /UID:babytime-check-m6-20260731@local/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260731/);
  assert.match(ics, /DTEND;VALUE=DATE:20260801/);
  assert.match(ics, /SUMMARY:儿保体检 6 月龄/);
  assert.match(ics, /社区卫生服务中心通知/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.equal(healthCheckIcsFileName(event), "儿保-6 月龄-2026-07-31.ics");
});
