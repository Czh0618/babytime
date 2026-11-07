import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVoiceTranscript } from "../src/domain/voice-parser.ts";
import { addVoiceEntries } from "../src/domain/care-records.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { buildVaccineIcs, icsFileName } from "../src/lib/ics.ts";

const now = new Date(2026, 10, 7, 15, 30);

test("「下午三点打了百白破疫苗」生成接种草稿并映射到 DTaP", () => {
  const [draft] = parseVoiceTranscript("下午三点打了百白破疫苗", now);
  assert.equal(draft!.kind, "vaccination");
  assert.equal(draft!.vaccineCode, "DTaP");
  assert.equal(draft!.vaccineName, "百白破疫苗");
  assert.equal(draft!.capturedAt, "2026-11-07T15:00");
  assert.equal(draft!.title, "接种记录");
});

test("认不出程序的疫苗名降级为日常备注，不生成对不上的记录", () => {
  const [draft] = parseVoiceTranscript("打了13价肺炎疫苗", now);
  assert.equal(draft!.kind, "note");
  assert.equal(draft!.vaccineCode, undefined);
});

test("确认接种草稿时同时写进疫苗计划，并按下一剂关联", () => {
  const workspace = emptyWorkspace();
  const batch = parseVoiceTranscript("下午三点打了百白破疫苗", now);
  assert.equal(addVoiceEntries(workspace, batch, "v1"), 1);
  assert.equal(workspace.vaccinations?.length, 1);
  const first = workspace.vaccinations![0]!;
  assert.equal(first.code, "DTaP");
  assert.equal(first.dose, 1);
  assert.equal(first.date, "2026-11-07");
  assert.equal(first.name, "百白破疫苗");

  const second = parseVoiceTranscript("上午十点打了百白破疫苗", now);
  addVoiceEntries(workspace, second, "v2");
  assert.equal(workspace.vaccinations!.length, 2);
  assert.equal(workspace.vaccinations![1]!.dose, 2);
  // 重复保存同一批次不会重复写接种记录。
  addVoiceEntries(workspace, second, "v2");
  assert.equal(workspace.vaccinations!.length, 2);
});

test("多宝宝与乙肝特殊程序：语音录入疫苗只按当前宝宝的接种记录与特殊程序推算下一剂", () => {
  const workspace = emptyWorkspace();
  workspace.profiles = [
    { id: "b1", name: "姐姐", birthDate: "2024-01-01" },
    {
      id: "b2",
      name: "弟弟",
      birthDate: "2026-01-01",
      vaccinePlan: { specialProgram: true, choices: {} },
    },
  ];
  workspace.activeProfileId = "b2";
  workspace.vaccinations = [
    // 姐姐已经打过 2 剂百白破，不应影响弟弟。
    { id: "s1", babyId: "b1", code: "DTaP", dose: 1, date: "2024-03-01", createdAt: "x" },
    { id: "s2", babyId: "b1", code: "DTaP", dose: 2, date: "2024-05-01", createdAt: "x" },
    // 弟弟已打过 3 剂乙肝，因为开了特殊程序（4 剂），下一剂应为第 4 剂。
    { id: "y1", babyId: "b2", code: "HepB", dose: 1, date: "2026-01-01", createdAt: "x" },
    { id: "y2", babyId: "b2", code: "HepB", dose: 2, date: "2026-02-01", createdAt: "x" },
    { id: "y3", babyId: "b2", code: "HepB", dose: 3, date: "2026-03-01", createdAt: "x" },
  ];

  const dtapBatch = parseVoiceTranscript("下午三点打了百白破疫苗", now);
  addVoiceEntries(workspace, dtapBatch, "b2-dtap");
  const addedDtap = workspace.vaccinations.find((item) => item.inputId?.startsWith("b2-dtap:"))!;
  assert.equal(addedDtap.babyId, "b2");
  assert.equal(addedDtap.dose, 1);

  const hepbBatch = parseVoiceTranscript("上午十点打了乙肝疫苗", now);
  addVoiceEntries(workspace, hepbBatch, "b2-hepb");
  const addedHepb = workspace.vaccinations.find((item) => item.inputId?.startsWith("b2-hepb:"))!;
  assert.equal(addedHepb.babyId, "b2");
  assert.equal(addedHepb.dose, 4);
});

test("日历文件是标准 ics，包含整日事件与提前一天提醒", () => {
  const event = {
    code: "DTaP",
    name: "百白破疫苗",
    dose: 3,
    dueDate: "2026-12-01",
  };
  const ics = buildVaccineIcs(event, new Date("2026-11-07T08:00:00Z"));
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261201/);
  assert.match(ics, /DTEND;VALUE=DATE:20261202/);
  assert.match(ics, /SUMMARY:接种 百白破疫苗 第 3 剂/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /VALARM/);
  assert.ok(ics.includes("\r\n"), "使用 CRLF 换行");
  assert.equal(icsFileName(event), "疫苗-百白破疫苗-第3剂-2026-12-01.ics");
});

test("月末日期生成跨月的整日事件", () => {
  const ics = buildVaccineIcs(
    { code: "HepB", name: "乙肝疫苗", dose: 2, dueDate: "2026-02-28" },
    new Date("2026-02-01T00:00:00Z"),
  );
  assert.match(ics, /DTSTART;VALUE=DATE:20260228/);
  assert.match(ics, /DTEND;VALUE=DATE:20260301/);
});
