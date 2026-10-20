import assert from "node:assert/strict";
import test from "node:test";

import { indexSkillAnnotations, skillAnnotationKey } from "./skill-annotations.ts";
import type { SkillAnnotationData } from "./types.ts";

test("skill annotations are scoped to both operator and skill", () => {
  const annotations: SkillAnnotationData[] = [
    {
      id: "annotation-amiya",
      operatorId: "char_002_amiya",
      skillId: "shared_skill",
      note: "阿米娅补充说明",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    {
      id: "annotation-kalts",
      operatorId: "char_003_kalts",
      skillId: "shared_skill",
      note: "凯尔希补充说明",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  ];

  const index = indexSkillAnnotations(annotations);

  assert.equal(index.get(skillAnnotationKey("char_002_amiya", "shared_skill"))?.note, "阿米娅补充说明");
  assert.equal(index.get(skillAnnotationKey("char_003_kalts", "shared_skill"))?.note, "凯尔希补充说明");
  assert.equal(index.get(skillAnnotationKey("char_002_amiya", "another_skill")), undefined);
});
