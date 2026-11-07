import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  defaultVaccinePlan,
  doseDates,
  nextDose,
  statusFor,
  summarizeVaccines,
  vaccineTasks,
  visibleVaccines,
} from "../src/domain/vaccines.ts";
import { VACCINE_BY_CODE, matchVaccine } from "../src/data/vaccines-2026.ts";
import type { BabyProfile, VaccinationRecord } from "../src/types.ts";

const profile: BabyProfile = { name: "小满", birthDate: "2026-01-31" };

test("自然月加法：月末顺延到当月最后一天", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonths("2026-05-31", 3), "2026-08-31");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
});

test("闰年 2 月 29 日出生，加 12 个月落到 2 月 28 日", () => {
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
  assert.equal(addMonths("2024-02-29", 1), "2024-03-29");
});

test("按程序算每剂应种日期：乙肝 0/1/6、百白破 5 剂", () => {
  const hepb = doseDates(VACCINE_BY_CODE.HepB!, "2026-01-31");
  assert.deepEqual(
    hepb.map((item) => item.dueDate),
    ["2026-01-31", "2026-02-28", "2026-07-31"],
  );
  const dtap = doseDates(VACCINE_BY_CODE.DTaP!, "2026-01-31");
  assert.deepEqual(
    dtap.map((item) => item.dueDate),
    ["2026-03-31", "2026-05-31", "2026-07-31", "2027-07-31", "2032-01-31"],
  );
  assert.equal(dtap.length, 5);
});

test("乙脑灭活第 2 剂与第 1 剂间隔 10 天；HPV 第 2 剂间隔 6 个月", () => {
  const je = doseDates(VACCINE_BY_CODE["JE-I"]!, "2026-01-01");
  assert.equal(je[0]!.dueDate, "2026-09-01");
  assert.equal(je[1]!.dueDate, "2026-09-11");
  const hpv = doseDates(VACCINE_BY_CODE["2vHPV"]!, "2013-03-05");
  assert.equal(hpv[0]!.dueDate, "2026-03-05");
  assert.equal(hpv[1]!.dueDate, "2026-09-05");
});

test("乙肝特殊程序改为 0/1/2/7 月龄", () => {
  const special = doseDates(VACCINE_BY_CODE.HepB!, "2026-01-31", true);
  assert.deepEqual(
    special.map((item) => item.dueDate),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-08-31"],
  );
});

test("状态：已接种 / 即将到期（30 天内）/ 已过期 / 未到时间", () => {
  const record: VaccinationRecord = {
    id: "r1",
    code: "HepB",
    dose: 1,
    date: "2026-01-31",
    createdAt: "2026-01-31T10:00:00Z",
  };
  assert.equal(statusFor("2026-01-31", record, "2026-11-07"), "done");
  assert.equal(statusFor("2026-11-07", undefined, "2026-11-07"), "due-soon");
  assert.equal(statusFor("2026-12-07", undefined, "2026-11-07"), "due-soon");
  assert.equal(statusFor("2026-12-08", undefined, "2026-11-07"), "upcoming");
  assert.equal(statusFor("2026-11-06", undefined, "2026-11-07"), "overdue");
});

test("按生日生成任务，已接种的剂次会被标记", () => {
  const plan = defaultVaccinePlan();
  const tasks = vaccineTasks(
    profile,
    plan,
    [
      {
        id: "r1",
        code: "HepB",
        dose: 1,
        date: "2026-01-31",
        createdAt: "2026-01-31T10:00:00Z",
      },
    ],
    "2026-01-20",
  );
  const hepb1 = tasks.find((item) => item.code === "HepB" && item.dose === 1);
  assert.equal(hepb1?.status, "done");
  // 卡介苗出生时接种，生日 1-31，今天 1-20 落在 30 天窗口内。
  assert.equal(
    tasks.find((item) => item.code === "BCG")?.status,
    "due-soon",
  );
  const summary = summarizeVaccines(tasks);
  assert.equal(summary.done, 1);
  assert.equal(summary.total, tasks.length);
});

test("二选一未选时两支都显示并标记待定，选中后只留一支", () => {
  const plan = defaultVaccinePlan();
  const both = visibleVaccines({ ...profile, sex: "female" }, plan);
  assert.equal(both.some((item) => item.code === "JE-L"), true);
  assert.equal(both.some((item) => item.code === "JE-I"), true);

  const tasks = vaccineTasks(profile, plan, []);
  assert.equal(tasks.find((item) => item.code === "JE-L")?.pendingChoice, true);

  const chosen = visibleVaccines(
    { ...profile, sex: "female" },
    { specialProgram: false, choices: { je: "JE-I", hepa: "HepA-I" } },
  );
  assert.equal(chosen.some((item) => item.code === "JE-L"), false);
  assert.equal(chosen.some((item) => item.code === "HepA-L"), false);
  assert.equal(chosen.some((item) => item.code === "JE-I"), true);
  assert.equal(chosen.some((item) => item.code === "HepA-I"), true);
});

test("HPV 只在性别为女孩时出现", () => {
  const plan = defaultVaccinePlan();
  const boy = visibleVaccines({ ...profile, sex: "male" }, plan);
  assert.equal(boy.some((item) => item.code === "2vHPV"), false);
  const unknown = visibleVaccines(profile, plan);
  assert.equal(unknown.some((item) => item.code === "2vHPV"), false);
  const girl = visibleVaccines({ ...profile, sex: "female" }, plan);
  assert.equal(girl.some((item) => item.code === "2vHPV"), true);
});

test("语音里的疫苗说法能映射到缩写，下一剂取最早未种的一剂", () => {
  assert.equal(matchVaccine("下午打了百白破疫苗")?.code, "DTaP");
  assert.equal(matchVaccine("打了乙肝第二针")?.code, "HepB");
  assert.equal(matchVaccine("打了13价肺炎")?.code, undefined);

  const records: VaccinationRecord[] = [
    { id: "a", code: "DTaP", dose: 1, date: "2026-03-31", createdAt: "x" },
    { id: "b", code: "DTaP", dose: 2, date: "2026-05-31", createdAt: "x" },
  ];
  assert.equal(nextDose(records, "DTaP"), 3);
  assert.equal(nextDose(records, "BCG"), 1);
  assert.equal(nextDose(records, "unknown"), undefined);
});
