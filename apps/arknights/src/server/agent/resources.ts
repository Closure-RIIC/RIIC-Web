import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { getDatabasePool } from "@riic/platform-server/db";
import { agentKnowledgeDir } from "./config.ts";
import { loadAgentSkillManifest, loadKnowledgePolicy, readAgentSkill } from "./knowledge-policy.ts";
import { readBuiltinAgentPersona } from "./persona-catalog.ts";
import { DEFAULT_AGENT_SYSTEM_PROMPT, loadPersonaBody } from "./persona.ts";
import { BUILTIN_AGENT_PERSONAS } from "../../agent-personas.ts";
import { parseResourcePolicy, RESOURCE_PAYLOAD_LIMIT, type AgentResourcePolicy } from "./resource-policy.ts";

let cached: { id: string; policy: AgentResourcePolicy } | null = null;
export async function activeAgentResources(): Promise<{ id: string; policy: AgentResourcePolicy } | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  const pool = getDatabasePool();
  const result = await pool.query("SELECT id FROM app.agent_policy_version WHERE kind='resources' AND status='active'");
  const row = result.rows[0];
  if (!row) return null;
  if (cached?.id === row.id) return cached;
  const snapshot = (await pool.query("SELECT payload FROM app.agent_policy_version WHERE id=$1 AND kind='resources'", [row.id])).rows[0];
  cached = { id: row.id, policy: parseResourcePolicy(snapshot?.payload) };
  return cached;
}

/** Import only the configured private source, never a path supplied by the browser. */
export async function importAgentResources(): Promise<AgentResourcePolicy> {
  if (!agentKnowledgeDir()) throw new Error("知识库未配置。");
  const root = await realpath(agentKnowledgeDir());
  let size = 0;
  async function read(filename: string) {
    const target = await realpath(path.join(root, filename));
    if (!target.startsWith(root + path.sep)) throw new Error("知识库资源越界。");
    const info = await stat(target);
    size += info.size;
    if (info.size > 600_000 || size > RESOURCE_PAYLOAD_LIMIT) throw new Error("知识库超过导入大小上限。");
    return readFile(target, "utf8");
  }
  const files: AgentResourcePolicy["knowledge"]["files"] = [];
  async function walk(relative: string, depth = 0) {
    if (depth > 12) throw new Error("知识库目录层级过深。");
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("知识库正文不能包含符号链接。");
      const filename = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(filename, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        if (files.length >= 998) throw new Error("知识库文件过多。");
        files.push({ path: filename, content: await read(filename) });
      }
    }
  }
  await walk("docs");
  for (const filename of ["index/标题清单.md", "index/消歧字典.json"]) files.push({ path: filename, content: await read(filename) });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = await loadAgentSkillManifest(root);
  const skills = await Promise.all(manifest.map(async skill => ({ id: skill.id, title: skill.title, purpose: skill.purpose, content: (await readAgentSkill(root, skill.id)).content, enabled: true })));
  const personas = await Promise.all(BUILTIN_AGENT_PERSONAS.map(async persona => {
    try { return { id: persona.id, content: await readBuiltinAgentPersona(persona.id), enabled: true }; }
    catch { return { id: persona.id, content: "", enabled: false }; }
  }));
  const policy = await loadKnowledgePolicy(root);
  const version = createHash("sha256").update(JSON.stringify({ files, policy })).digest("hex").slice(0, 16);
  return parseResourcePolicy({ schema: 1, systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT, defaultPersona: await loadPersonaBody(), personas, knowledge: { version, policy, files }, skills });
}
