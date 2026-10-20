import type { SkillAnnotationData } from "./types.ts";

export const SKILL_ANNOTATION_MAX_LENGTH = 1000;

/** Stable lookup key for an operator-specific building-skill annotation. */
export function skillAnnotationKey(operatorId: string, skillId: string): string {
  return `${operatorId}\u001f${skillId}`;
}

export function indexSkillAnnotations(
  annotations: readonly SkillAnnotationData[],
): ReadonlyMap<string, SkillAnnotationData> {
  return new Map(
    annotations.map((annotation) => [
      skillAnnotationKey(annotation.operatorId, annotation.skillId),
      annotation,
    ]),
  );
}
