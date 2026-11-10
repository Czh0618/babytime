import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVoiceTranscript,
  validateVoiceDraft,
  voiceDraftToEntry,
} from "../src/domain/voice-parser.ts";
import {
  describeCare,
  hoursSince,
  lastMedicineEntry,
  lastTemperatureOn,
  latestCareByKind,
  summarizeTemperature,
} from "../src/domain/care-records.ts";
import { isWorkspace, migrateMediaIds, parseBackup } from "../src/domain/workspace-schema.ts";
import { emptyWorkspace } from "../src/domain/seed.ts";
import type { GrowthEntry } from "../src/types.ts";
import type { CareObservation } from "../src/domain/care-types.ts";

const now = new Date(2026, 10, 7, 15, 30);

test("语音识别体温：38度5 / 38.5 / 三十八度五", () => {
  const cases: Array<[string, number]> = [
    ["发烧38度5", 38.5],
    ["体温38.5", 38.5],
    ["三十八度五", 38.5],
    ["测了体温38度", 38],
  ];
  for (const [text, expected] of cases) {
    const [draft] = parseVoiceTranscript(text, now);
    assert.equal(draft!.kind, "temperature", text);
    assert.equal(draft!.temperatureC, expected, text);
  }
});

test("语音识别测温部位", () => {
  const [ear] = parseVoiceTranscript("耳温38度2", now);
  assert.equal(ear!.site, "ear");
  const [armpit] = parseVoiceTranscript("腋下37度8", now);
  assert.equal(armpit!.site, "armpit");
});

test("语音识别用药：药名与剂量保留原文", () => {
  const [draft] = parseVoiceTranscript("喂了美林2.5毫升", now);
  assert.equal(draft!.kind, "medicine");
  assert.equal(draft!.medicineName, "美林");
  assert.equal(draft!.dose, "2.5毫升");
  assert.equal(validateVoiceDraft(draft!), null);
});

test("发烧与用药拆成两条", () => {
  const drafts = parseVoiceTranscript("发烧38度5，喂了美林", now);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]!.kind, "temperature");
  assert.equal(drafts[0]!.temperatureC, 38.5);
  assert.equal(drafts[1]!.kind, "medicine");
  assert.equal(drafts[1]!.medicineName, "美林");
});

test("体温超出 34–43 或药名为空时不允许保存", () => {
  const [low] = parseVoiceTranscript("体温30度", now);
  assert.equal(low!.kind, "temperature");
  assert.match(validateVoiceDraft(low!)!, /34–43/);

  const hot = parseVoiceTranscript("发烧45度", now)[0]!;
  assert.match(validateVoiceDraft(hot)!, /34–43/);

  const noName = parseVoiceTranscript("吃了药", now)[0]!;
  assert.equal(noName.kind, "medicine");
  assert.match(validateVoiceDraft(noName)!, /药名/);
});

test("体温与用药能写进记录，字段不丢", () => {
  const [temperature] = parseVoiceTranscript("耳温38度5", now);
  const entry = voiceDraftToEntry(temperature!, "batch:1");
  assert.equal(entry.care?.temperatureC, 38.5);
  assert.equal(entry.care?.site, "ear");
  assert.equal(entry.tag, "体温");

  const [medicine] = parseVoiceTranscript("喂了美林2.5毫升", now);
  const medEntry = voiceDraftToEntry(medicine!, "batch:2");
  assert.equal(medEntry.care?.medicineName, "美林");
  assert.equal(medEntry.care?.dose, "2.5毫升");
  assert.equal(medEntry.tag, "用药");
});

test("记录文案只陈述数值，不做判断", () => {
  assert.equal(
    describeCare({ kind: "temperature", temperatureC: 38.5, site: "ear", sourceText: "" }),
    "体温 38.5℃（耳温）",
  );
  assert.equal(
    describeCare({ kind: "medicine", medicineName: "美林", dose: "2.5ml", sourceText: "" }),
    "美林 2.5ml",
  );
  assert.equal(
    describeCare({ kind: "medicine", medicineName: "美林", sourceText: "" }),
    "美林",
  );
  assert.equal(describeCare({ kind: "temperature", sourceText: "" }), "已记录体温");
});

function entry(
  capturedAt: string,
  care: CareObservation,
): GrowthEntry {
  return {
    id: `${capturedAt}-${care.kind}`,
    title: "记录",
    note: "",
    capturedAt,
    tag: "体温",
    favorite: false,
    milestone: false,
    care,
  };
}

test("当天最高体温与次数", () => {
  const entries = [
    entry("2026-11-07T09:00", {
      kind: "temperature",
      temperatureC: 37.6,
      sourceText: "体温37.6",
    }),
    entry("2026-11-07T14:00", {
      kind: "temperature",
      temperatureC: 38.5,
      sourceText: "体温38.5",
    }),
    entry("2026-11-07T18:00", {
      kind: "temperature",
      temperatureC: 38.1,
      sourceText: "体温38.1",
    }),
    entry("2026-11-06T22:00", {
      kind: "temperature",
      temperatureC: 39.9,
      sourceText: "昨天的",
    }),
  ];
  assert.deepEqual(summarizeTemperature(entries, "2026-11-07"), {
    maxC: 38.5,
    at: "2026-11-07T14:00",
    count: 3,
  });
  assert.equal(summarizeTemperature([], "2026-11-07"), null);
});

test("距上次用药只取最近一条，未来记录不算", () => {
  const entries = [
    entry("2026-11-07T08:00", {
      kind: "medicine",
      medicineName: "美林",
      dose: "2.5ml",
      sourceText: "喂了美林",
    }),
    entry("2026-11-07T13:00", {
      kind: "medicine",
      medicineName: "美林",
      dose: "2.5ml",
      sourceText: "喂了美林",
    }),
    entry("2026-11-07T20:00", {
      kind: "medicine",
      medicineName: "美林",
      sourceText: "还没到的时间",
    }),
  ];
  const last = lastMedicineEntry(entries, new Date("2026-11-07T15:30"));
  assert.equal(last?.capturedAt, "2026-11-07T13:00");
  assert.equal(hoursSince("2026-11-07T13:00", new Date("2026-11-07T15:30")), "2.5 小时");
  assert.equal(hoursSince("2026-11-07T15:10", new Date("2026-11-07T15:30")), "20 分钟");
  assert.equal(hoursSince("2026-11-06T15:30", new Date("2026-11-07T15:30")), "24 小时");
});

test("备份校验接受体温与用药记录", () => {
  const workspace = emptyWorkspace();
  workspace.entries.push(
    entry("2026-11-07T09:00", {
      kind: "temperature",
      temperatureC: 38.5,
      site: "ear",
      sourceText: "耳温38.5",
    }),
    entry("2026-11-07T10:00", {
      kind: "medicine",
      medicineName: "美林",
      dose: "2.5ml",
      sourceText: "喂了美林",
    }),
  );
  assert.equal(isWorkspace(structuredClone(workspace)), true);
  assert.deepEqual(
    parseBackup(JSON.stringify(workspace)),
    migrateMediaIds(JSON.parse(JSON.stringify(workspace))),
  );

  const broken = structuredClone(workspace);
  broken.entries[0]!.care!.site = "mouth" as never;
  assert.throws(() => parseBackup(JSON.stringify(broken)), /字段缺失|类型错误/);
});

test("距上次跨午夜：24 小时窗口取最近一条，未来记录不算", () => {
  const entries = [
    entry("2026-11-09T23:40", {
      kind: "feeding",
      amountMl: 90,
      sourceText: "夜奶",
    }),
    entry("2026-11-10T00:20", {
      kind: "feeding",
      amountMl: 100,
      sourceText: "凌晨",
    }),
    entry("2026-11-10T03:00", {
      kind: "diaper",
      diaper: "wet",
      sourceText: "换尿布",
    }),
    entry("2026-11-10T09:00", {
      kind: "feeding",
      amountMl: 80,
      sourceText: "还没到的时间",
    }),
  ];
  const midnight = latestCareByKind(entries, new Date("2026-11-10T00:30"));
  assert.equal(midnight.feeding?.capturedAt, "2026-11-10T00:20");
  assert.equal(midnight.diaper, undefined);
  const later = latestCareByKind(entries, new Date("2026-11-10T10:00"));
  assert.equal(later.feeding?.capturedAt, "2026-11-10T09:00");
  assert.equal(later.diaper?.capturedAt, "2026-11-10T03:00");
});

test("最近体温取最后一次测量，而不是当日最高", () => {
  const entries = [
    entry("2026-11-07T08:00", {
      kind: "temperature",
      temperatureC: 38.6,
      sourceText: "早上",
    }),
    entry("2026-11-07T15:00", {
      kind: "temperature",
      temperatureC: 36.8,
      sourceText: "下午",
    }),
    entry("2026-11-07T20:00", {
      kind: "temperature",
      temperatureC: 39.9,
      sourceText: "还没到的时间",
    }),
  ];
  assert.deepEqual(
    lastTemperatureOn(entries, "2026-11-07", new Date("2026-11-07T16:00")),
    { value: 36.8, at: "2026-11-07T15:00" },
  );
  assert.equal(
    lastTemperatureOn(entries, "2026-11-08", new Date("2026-11-08T08:00")),
    undefined,
  );
});
