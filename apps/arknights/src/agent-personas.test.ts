import assert from "node:assert/strict";
import test from "node:test";
import { builtinAgentPersona, resolveAgentPersonaSelection, type UploadedAgentPersona } from "./agent-personas.ts";

const uploaded: UploadedAgentPersona = { id: "upload-test", kind: "upload", name: "测试", description: "", content: "自定义语气" };

test("persona selection preserves legacy uploads and explicitly selected defaults", () => {
  assert.equal(resolveAgentPersonaSelection(null, uploaded), uploaded);
  assert.equal(resolveAgentPersonaSelection("upload-test", uploaded), uploaded);
  assert.equal(resolveAgentPersonaSelection("default", uploaded), null);
  assert.equal(resolveAgentPersonaSelection("silverash", uploaded), builtinAgentPersona("silverash"));
  assert.equal(resolveAgentPersonaSelection("silverash", null)?.kind, "builtin");
  assert.equal(resolveAgentPersonaSelection("exusiai", uploaded), builtinAgentPersona("exusiai"));
  assert.equal(resolveAgentPersonaSelection("exusiai", null)?.name, "能天使");
  assert.equal(resolveAgentPersonaSelection(null, null), null);
  assert.equal(resolveAgentPersonaSelection("saileach", uploaded), builtinAgentPersona("saileach"));
  assert.equal(resolveAgentPersonaSelection("saileach", null)?.name, "琴柳");
  assert.equal(resolveAgentPersonaSelection("mountain", uploaded), builtinAgentPersona("mountain"));
  assert.equal(resolveAgentPersonaSelection("mountain", null)?.name, "山");
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
