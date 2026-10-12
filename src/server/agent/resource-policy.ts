import { z } from "zod";

const short = z.string().trim().min(1).max(200);
const content = z.string().max(200_000);
const skill = z.object({ id: z.string().regex(/^[\w-]{1,80}$/), title: short, purpose: z.string().max(1000), content, enabled: z.boolean() }).strict();
const document = z.object({ path: z.string().max(500).refine(value =>
  /^(docs\/.+\.md|index\/标题清单\.md|index\/消歧字典\.json)$/.test(value)
  && !value.includes("\\") && !value.includes("\0") && !value.split("/").some(part => part === ".." || part === "." || !part)), content }).strict();
const schema = z.object({
  schema: z.literal(1),
  systemPrompt: z.string().trim().min(1).max(36_000),
  defaultPersona: z.string().max(36_000),
  personas: z.array(z.object({ id: z.enum(["silverash", "exusiai", "saileach", "mountain"]), enabled: z.boolean(), content: z.string().max(36_000) }).strict()).max(4),
  knowledge: z.object({ version: short, policy: content, files: z.array(document).max(1000) }).strict(),
  skills: z.array(skill).max(100),
}).strict();
export type AgentResourcePolicy = z.infer<typeof schema>;
export const RESOURCE_PAYLOAD_LIMIT = 8_000_000;

export function parseResourcePolicy(value: unknown): AgentResourcePolicy {
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > RESOURCE_PAYLOAD_LIMIT) throw new Error("资源总大小不能超过 8 MB。");
  const policy = schema.parse(value);
  for (const list of [policy.personas.map(item => item.id), policy.skills.map(item => item.id), policy.knowledge.files.map(item => item.path)]) {
    if (new Set(list).size !== list.length) throw new Error("资源标识或路径重复。");
  }
  if (policy.personas.some(item => item.enabled && !item.content.trim()) || policy.skills.some(item => item.enabled && !item.content.trim())) throw new Error("启用的资源不能为空。");
  const files = new Map(policy.knowledge.files.map(file => [file.path, file.content]));
  if (!files.has("index/标题清单.md") || !files.has("index/消歧字典.json") || !policy.knowledge.policy.trim()) throw new Error("知识库缺少索引、消歧字典或共享规则。");
  const dictionary = JSON.parse(files.get("index/消歧字典.json")!);
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) throw new Error("消歧字典格式无效。");
  const catalog = [...files.get("index/标题清单.md")!.matchAll(/^-\s+`([^`]+)`/gm)].map(match => match[1]);
  if (!catalog.length || catalog.some(file => !files.has(file))) throw new Error("标题清单为空或引用了缺失的文档。");
  return policy;
}

export function resourceKnowledgeFile(policy: AgentResourcePolicy, filename: string) {
  const file = policy.knowledge.files.find(item => item.path === filename);
  if (!file) throw new Error("当前知识版本中没有这份正文，请重新检索。");
  return file.content;
}

export function resourceSkill(policy: AgentResourcePolicy, id: string) {
  const skill = policy.skills.find(item => item.id === id && item.enabled);
  if (!skill) throw new Error("该任务指引尚未启用。");
  return { id: skill.id, title: skill.title, content: skill.content };
}
