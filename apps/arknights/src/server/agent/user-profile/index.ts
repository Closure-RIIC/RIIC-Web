import "@tanstack/react-start/server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  PROFILE_CONSTRAINT_KEYS,
  applyProfileUpdate,
  describeUserProfile,
  renderProfileBrief,
} from "./core.ts";
import { USER_PROFILE_UNAVAILABLE_PROMPT, formatUserProfilePrompt, userProfileConstraintHint, userProfileVocabularyHint } from "./prompt.ts";
import { loadUserProfile, updateUserProfile } from "./store.ts";

/**
 * 每轮对话注入系统提示词的画像片段。读失败时降级为"画像不可用"，绝不阻断对话。
 * 只有本轮需要主动追问冲突（要记录询问时间）时才写库。
 */
export async function userProfilePrompt(userId: string, now = new Date()): Promise<string> {
  try {
    const profile = await loadUserProfile(userId);
    let brief = renderProfileBrief(profile, now);
    if (brief.changed) {
      brief = await updateUserProfile(userId, (locked) => {
        const fresh = renderProfileBrief(locked, now);
        return { changed: fresh.changed, result: fresh };
      });
    }
    return formatUserProfilePrompt(brief);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "agent_user_profile_unavailable", userId, message: error instanceof Error ? error.message : String(error) }));
    return USER_PROFILE_UNAVAILABLE_PROMPT;
  }
}

type Guard = <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T | { error: string }>;

const evidence = z.enum(["stated", "behavior"]);

export function buildUserProfileTools(userId: string, guard: Guard) {
  return {
    update_user_profile: tool({
      description:
        `记录博士的长期画像（跨对话保存）。只记本人明说或实际选择过的内容；规则见系统提示词「用户画像使用守则」。` +
        `constraints 可用键：${userProfileConstraintHint()}。` +
        `preferences 只能用这些 id：${userProfileVocabularyHint()}。`,
      inputSchema: z.object({
        constraints: z.object({
          dailyLoginMax: z.number().int().optional(),
          sessionMinutes: z.number().int().optional(),
          shiftChangeAllowed: z.boolean().optional(),
          thirdPartyToolAllowed: z.boolean().optional(),
          device: z.enum(["pc", "mobile", "both"]).optional(),
          sanityPotionAllowed: z.boolean().optional(),
          droneAllowed: z.boolean().optional(),
          mustKeepMood: z.boolean().optional(),
        }).optional().describe("博士明确说出的硬性条件；不推断"),
        clearConstraints: z.array(z.enum(PROFILE_CONSTRAINT_KEYS as [string, ...string[]])).max(8).optional()
          .describe("博士要求撤销或不再适用的约束键"),
        preferences: z.array(z.object({
          id: z.string().min(1).describe("词表 id"),
          evidence: evidence.optional().describe("stated=博士说的；behavior=博士在候选方案中的实际选择"),
        })).max(8).optional(),
        facts: z.array(z.object({
          text: z.string().min(1).max(80).describe("一句话，60 字以内，不含数字"),
          evidence: evidence.optional(),
        })).max(5).optional(),
        retireFacts: z.array(z.string().min(1)).max(5).optional().describe("要作废的旧事实原文或 id（改口/要求忘掉）"),
        resolveConflict: z.object({
          id: z.string().min(1),
          choice: evidence.describe("stated=按博士原来说的；behavior=按实际选择"),
        }).optional().describe("博士回答了画像里的待澄清问题时填写"),
      }),
      execute: async (input) => guard("update_user_profile", input, async () => {
        const now = new Date();
        const result = await updateUserProfile(userId, (profile) => {
          const update = applyProfileUpdate(profile, input, now);
          return { changed: update.changed, result: update };
        });
        return {
          saved: result.saved,
          rejected: result.rejected,
          newConflicts: result.newConflicts,
          note: result.newConflicts.length
            ? "出现了自述与实际选择不一致的偏好，之后在合适时机用一个具体的二选一问清。"
            : undefined,
        };
      }),
    }),

    read_user_profile: tool({
      description: "读取已保存的博士画像（硬约束、偏好、个人情况、待澄清项），用于回答「你记得我什么」或核对画像。",
      inputSchema: z.object({}),
      execute: async () => guard("read_user_profile", {}, async () => describeUserProfile(await loadUserProfile(userId), new Date())),
    }),
  };
}
