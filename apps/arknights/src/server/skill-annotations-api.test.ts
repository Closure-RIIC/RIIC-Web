import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("skill annotation mutations enforce administrator and same-origin checks", async () => {
  const source = await readFile(new URL("./skill-annotations-api.ts", import.meta.url), "utf8");

  assert.equal(source.match(/await requireWebsiteAdmin\(request\)/gu)?.length, 4);
  assert.equal(source.match(/assertSameOrigin\(request\)/gu)?.length, 3);
  assert.equal(source.includes("SKILL_ANNOTATION_MAX_LENGTH"), true);
  assert.equal(source.includes("operatorSkills.get(operatorId)?.has(skillId)"), true);
});

test("public skill annotation responses exclude administrator identity", async () => {
  const source = await readFile(new URL("./skill-annotations-api.ts", import.meta.url), "utf8");
  const publicDtoStart = source.indexOf("function toSkillAnnotationData");
  const adminDtoStart = source.indexOf("function toAdminSkillAnnotationData");
  const publicDto = source.slice(publicDtoStart, adminDtoStart);

  assert.equal(publicDto.includes("createdByUserId"), false);
  assert.equal(publicDto.includes("updatedByUserId"), false);
  assert.equal(source.includes('no-store, max-age=0'), true);
});
