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
