import { PROFILE_CONSTRAINT_KEYS, PROFILE_CONSTRAINT_RULES, PROFILE_VOCAB, type ProfileBrief } from "./core.ts";

/** 写入与使用规则：随画像一起注入，保证 gateway 与直连两条路径行为一致。 */
export const USER_PROFILE_RULES = `## 用户画像（长期记忆）使用守则

画像跨对话保存，只记录这位博士本人明确说过或实际选择过的内容。

使用：
- 给排班、养成、资源方案前先对照「硬约束」：违反硬约束的方案即使收益更高也不能给出或推荐。
- 「已知偏好」只影响候选方案的排序和取向，可以在说明理由后妥协。
- 「尚未确认的约束」只在它会改变本次答案时才问，一次最多问一两个；与本次问题无关的不要问。知识问答、技能查询、公招等不依赖个人条件的问题不要追问约束。
- 画像内容不要整段复述给博士；需要时自然地体现在方案里（例如"按你每天上两次号的习惯……"）。

写入（调用 update_user_profile，可以在同一轮里与其他工具一起调用）：
- constraints：博士明确说出自己的硬性条件时写入，例如"我每天只能上两次号""不想换班""我不用 MAA""别用理智药"。只写本人明说的；不能从语气、行为或一次选择推断约束；"都行""随便"不是约束，也不写偏好。
- preferences：博士表达取向时写词表 id，evidence=stated。博士在你给的几个候选里做出选择、或明确拒绝某类方案时，把所选方案体现的取向写成 evidence=behavior。
- facts：不属于词表、但以后仍有用的个人情况（例如"主要玩肉鸽，基建随缘"），一句话、60 字以内、不含具体数字。数值、效率、产出、库存都不写入画像，它们以工具和知识库为准。
- 改口：约束直接写新值；事实先 retireFacts 旧说法，再写新 facts。博士要求"忘掉/别记"时用 clearConstraints 或 retireFacts。
- 本次临时信息（这次想排哪个布局、今天剩多少理智、某个干员当前练度）不写入。
- 写入成功后不要逐条汇报，必要时一句"记下了"即可；工具拒绝写入时不要重试同样内容。
- 博士问"你记得我什么"时调用 read_user_profile，按返回内容如实回答。`;

export function userProfileVocabularyHint(): string {
  return Object.values(PROFILE_VOCAB)
    .map((group) => Object.entries(group).map(([id, text]) => `${id}=${text}`).join("，"))
    .join("；");
}

export function userProfileConstraintHint(): string {
  return PROFILE_CONSTRAINT_KEYS.map((key) => {
    const rule = PROFILE_CONSTRAINT_RULES[key];
    if (rule.kind === "int") return `${key}（${rule.label}，整数 ${rule.min}–${rule.max}）`;
    if (rule.kind === "enum") return `${key}（${rule.label}：${rule.values.join("/")}）`;
    return `${key}（true=${rule.yes}，false=${rule.no}）`;
  }).join("；");
}

/** 把 brief 拼成系统提示词片段。画像为空时也给出规则，模型才知道何时写入。 */
export function formatUserProfilePrompt(brief: ProfileBrief): string {
  const body = brief.empty && !brief.conflict
    ? "（目前还没有记录任何画像。）\n" + brief.text
    : brief.text;
  return `\n\n---\n\n${USER_PROFILE_RULES}\n\n### 当前画像\n${body}`;
}

/** 画像服务不可用时的降级片段：不注入画像，也不让模型以为自己记住了什么。 */
export const USER_PROFILE_UNAVAILABLE_PROMPT = "\n\n---\n\n## 用户画像\n画像服务暂时不可用：本轮不要调用 update_user_profile，也不要声称记住了博士的情况；需要个人条件时直接询问。";
