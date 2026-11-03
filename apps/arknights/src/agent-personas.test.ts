import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_PERSONA_SELECTION_KEY, builtinAgentPersona, resolveAgentPersonaSelection, type UploadedAgentPersona } from "./agent-personas.ts";
import { LEGACY_PERSONA_STORAGE_KEY, LOCAL_PERSONAS_STORAGE_KEY, MAX_PERSONA_LENGTH, readLocalPersonas, writeLocalPersonas } from "./agent-persona-storage.ts";

const uploaded: UploadedAgentPersona = { id: "upload-test", kind: "upload", name: "测试", description: "", content: "自定义语气" };

test("persona selection preserves legacy uploads and explicitly selected defaults", () => {
  assert.equal(resolveAgentPersonaSelection(null, [uploaded]), uploaded);
  assert.equal(resolveAgentPersonaSelection("upload-test", [uploaded]), uploaded);
  assert.equal(resolveAgentPersonaSelection("default", [uploaded]), null);
  assert.equal(resolveAgentPersonaSelection("silverash", [uploaded]), builtinAgentPersona("silverash"));
  assert.equal(resolveAgentPersonaSelection("silverash", [])?.kind, "builtin");
  assert.equal(resolveAgentPersonaSelection("exusiai", [uploaded]), builtinAgentPersona("exusiai"));
  assert.equal(resolveAgentPersonaSelection("exusiai", [])?.name, "能天使");
  assert.equal(resolveAgentPersonaSelection(null, []), null);
  assert.equal(resolveAgentPersonaSelection("saileach", [uploaded]), builtinAgentPersona("saileach"));
  assert.equal(resolveAgentPersonaSelection("saileach", [])?.name, "琴柳");
  assert.equal(resolveAgentPersonaSelection("mountain", [uploaded]), builtinAgentPersona("mountain"));
  assert.equal(resolveAgentPersonaSelection("mountain", [])?.name, "山");
});

function personaStorageFixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("persona selection distinguishes same-name cards and defaults after a selected card is deleted", () => {
  const second: UploadedAgentPersona = { ...uploaded, id: "upload-second", content: "不同的提示词" };
  assert.equal(resolveAgentPersonaSelection(second.id, [uploaded, second]), second);
  assert.equal(resolveAgentPersonaSelection(uploaded.id, [uploaded, second]), uploaded);
  assert.equal(resolveAgentPersonaSelection(second.id, [uploaded]), null);
  assert.equal(resolveAgentPersonaSelection("missing", [uploaded, second]), null);
  assert.equal(resolveAgentPersonaSelection("default", [uploaded, second]), null);
});

test("legacy persona migration preserves its content, avatar and selection", () => {
  const legacy = { version: 1, ...uploaded, filename: "personality.json", avatarUrl: "data:image/png;base64,YQ==" };
  const storage = personaStorageFixture({
    [LEGACY_PERSONA_STORAGE_KEY]: JSON.stringify(legacy),
    [AGENT_PERSONA_SELECTION_KEY]: uploaded.id,
  });
  const cards = readLocalPersonas(storage);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, legacy.id);
  assert.equal(cards[0].content, legacy.content);
  assert.equal(cards[0].avatarUrl, legacy.avatarUrl);
  assert.equal(cards[0].filename, legacy.filename);
  assert.deepEqual(JSON.parse(storage.getItem(LOCAL_PERSONAS_STORAGE_KEY)!), { version: 1, personas: cards });
  assert.equal(storage.getItem(LEGACY_PERSONA_STORAGE_KEY), null);
  assert.equal(storage.getItem(AGENT_PERSONA_SELECTION_KEY), uploaded.id);
});

test("persona collections retain independent avatars across writes and reloads", () => {
  const first = { ...uploaded, avatarUrl: "data:image/png;base64,YQ==" };
  const second = { ...uploaded, id: "upload-second", avatarUrl: "data:image/webp;base64,Yg==" };
  const storage = personaStorageFixture();
  writeLocalPersonas(storage, [first, second]);
  const cards = readLocalPersonas(storage);
  assert.deepEqual(cards.map(card => [card.id, card.avatarUrl]), [[first.id, first.avatarUrl], [second.id, second.avatarUrl]]);
  writeLocalPersonas(storage, cards.map(card => card.id === first.id ? { ...card, avatarUrl: undefined } : card));
  assert.deepEqual(readLocalPersonas(storage).map(card => card.avatarUrl), [undefined, second.avatarUrl]);
});

test("persona collection parsing drops invalid and duplicate entries without discarding valid cards", () => {
  const invalidAvatar = { ...uploaded, id: "upload-invalid-avatar", avatarUrl: "data:image/svg+xml;base64,PHN2Zz4=" };
  const storage = personaStorageFixture({ [LOCAL_PERSONAS_STORAGE_KEY]: JSON.stringify({ version: 1, personas: [
    null, {}, uploaded, { ...uploaded, content: "duplicate ID" },
    { ...uploaded, id: "default" }, { ...uploaded, id: "silverash" },
    { ...uploaded, id: "empty", content: " " },
    { ...uploaded, id: "oversize", content: "a".repeat(MAX_PERSONA_LENGTH + 1) }, invalidAvatar,
  ] }) });
  const cards = readLocalPersonas(storage);
  assert.deepEqual(cards.map(card => card.id), [uploaded.id, invalidAvatar.id]);
  assert.equal(cards[0].content, uploaded.content);
  assert.equal(cards[1].avatarUrl, undefined);
});

test("failed migration keeps the original persona and avatar recoverable", () => {
  const legacy = JSON.stringify({ version: 1, ...uploaded, avatarUrl: "data:image/png;base64,YQ==" });
  const original = personaStorageFixture({ [LEGACY_PERSONA_STORAGE_KEY]: legacy });
  const storage = { ...original, setItem: () => { throw new Error("Storage quota exceeded"); } };
  assert.equal(readLocalPersonas(storage)[0].avatarUrl, "data:image/png;base64,YQ==");
  assert.equal(storage.getItem(LEGACY_PERSONA_STORAGE_KEY), legacy);
  assert.equal(storage.getItem(LOCAL_PERSONAS_STORAGE_KEY), null);
  assert.throws(() => writeLocalPersonas(storage, []), /quota/);
  assert.equal(storage.getItem(LEGACY_PERSONA_STORAGE_KEY), legacy);
});

test("empty collections do not resurrect old cards when legacy cleanup is blocked", () => {
  const original = personaStorageFixture({ [LEGACY_PERSONA_STORAGE_KEY]: JSON.stringify({ version: 1, ...uploaded }) });
  const storage = { ...original, removeItem: () => { throw new Error("Storage removal blocked"); } };
  assert.equal(readLocalPersonas(storage).length, 1);
  writeLocalPersonas(storage, []);
  assert.deepEqual(readLocalPersonas(storage), []);
  assert.notEqual(storage.getItem(LEGACY_PERSONA_STORAGE_KEY), null);
});

test("malformed collections never restore stale legacy data", () => {
  for (const raw of ["{", "null", JSON.stringify({ version: 2, personas: [uploaded] }), JSON.stringify({ version: 1, personas: {} })]) {
    const storage = personaStorageFixture({ [LOCAL_PERSONAS_STORAGE_KEY]: raw, [LEGACY_PERSONA_STORAGE_KEY]: JSON.stringify({ version: 1, ...uploaded }) });
    assert.deepEqual(readLocalPersonas(storage), []);
  }
});

test("built-in IDs must match exactly and carry no prompt or portrait asset", () => {
  assert.equal(builtinAgentPersona("../../silverash"), undefined);
  assert.equal(builtinAgentPersona({ id: "silverash" }), undefined);
  assert.equal(builtinAgentPersona("silverash")?.avatar, "silverash");
  assert.equal("content" in builtinAgentPersona("silverash")!, false);
  assert.equal(builtinAgentPersona("exusiai")?.avatar, "exusiai");
  assert.equal(builtinAgentPersona("exusiai")?.theme, "red");
  assert.equal(builtinAgentPersona("../exusiai"), undefined);
  assert.equal("content" in builtinAgentPersona("exusiai")!, false);
  assert.equal(builtinAgentPersona("saileach")?.avatar, "saileach");
  assert.equal(builtinAgentPersona("saileach")?.theme, "yellow");
  assert.equal(builtinAgentPersona("../saileach"), undefined);
  assert.equal("content" in builtinAgentPersona("saileach")!, false);
  assert.equal(builtinAgentPersona("mountain")?.avatar, "mountain");
  assert.equal(builtinAgentPersona("mountain")?.theme, "blue");
  assert.equal(builtinAgentPersona("../mountain"), undefined);
  assert.equal("content" in builtinAgentPersona("mountain")!, false);
});
