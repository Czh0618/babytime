import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace } from "../src/domain/seed.ts";
import { parseVoiceTranscript } from "../src/domain/voice-parser.ts";
import { addVoiceEntries } from "../src/domain/care-records.ts";

test("同一批语音重复确认，不生成重复照护记录", () => {
  const workspace = emptyWorkspace();
  const drafts = parseVoiceTranscript(
    "刚刚喂奶90ml",
    new Date(2026, 10, 4, 15, 30),
  );
  assert.equal(addVoiceEntries(workspace, drafts, "batch"), 1);
  assert.equal(addVoiceEntries(workspace, drafts, "batch"), 0);
  assert.equal(workspace.entries.length, 1);
  assert.equal(workspace.entries[0]!.care?.amountMl, 90);
});

test("一条时间不明时，整批保持未保存，不出现半批落盘", () => {
  const workspace = emptyWorkspace();
  const drafts = parseVoiceTranscript(
    "刚刚喂奶90ml",
    new Date(2026, 10, 4, 15, 30),
  );
  const invalid = {
    ...drafts[0]!,
    id: "unclear",
    capturedAt: "",
    needsTimeConfirmation: true,
  };
  assert.throws(() =>
    addVoiceEntries(workspace, [...drafts, invalid], "batch"),
  );
  assert.equal(workspace.entries.length, 0);
});

test("零值或无效奶量不能在确认时悄悄变成已记录喂奶", () => {
  const workspace = emptyWorkspace();
  const draft = parseVoiceTranscript(
    "刚刚喂奶90ml",
    new Date(2026, 10, 4, 15, 30),
  )[0]!;
  for (const amountMl of [0, -10, Number.NaN]) {
    assert.throws(() =>
      addVoiceEntries(workspace, [{ ...draft, amountMl }], "invalid"),
    );
  }
  assert.equal(workspace.entries.length, 0);
});

test("家长修改后的奶量与录入原话分开保留，不把旧识别值当成备注", () => {
  const workspace = emptyWorkspace();
  const draft = parseVoiceTranscript(
    "刚刚喂奶90ml",
    new Date(2026, 10, 4, 15, 30),
  )[0]!;
  addVoiceEntries(workspace, [{ ...draft, amountMl: 95 }], "edited");
  assert.equal(workspace.entries[0]!.care?.amountMl, 95);
  assert.equal(workspace.entries[0]!.care?.sourceText, "刚刚喂奶90ml");
  assert.equal(workspace.entries[0]!.note, "");
  addVoiceEntries(
    workspace,
    [{ ...draft, note: "这条由爸爸记录" }],
    "with-note",
  );
  assert.equal(workspace.entries[1]!.note, "这条由爸爸记录");
});

test("http 访问（无 crypto.randomUUID）时语音记录仍能保存", (t) => {
  t.mock.property(Object.getPrototypeOf(crypto), "randomUUID", undefined);
  const workspace = emptyWorkspace();
  const drafts = parseVoiceTranscript(
    "刚刚喂奶90ml",
    new Date(2026, 10, 4, 15, 30),
  );
  assert.equal(addVoiceEntries(workspace, drafts, "batch"), 1);
});
