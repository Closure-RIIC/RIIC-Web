import { searchKnowledgeBase, readKnowledgeDoc } from "../apps/arknights/src/server/agent/knowledge.ts";

const route = await searchKnowledgeBase("搓玉 源石碎片 无人机折算");
console.log("== kb_route 搓玉 ==");
for (const entry of route.matched) console.log(`- ${entry.path} :: ${entry.label.slice(0, 50)}`);

const read = await readKnowledgeDoc("docs/1-基础设定/资源体系/产出常数表.md");
console.log(`\n== kb_read 产出常数表 == title=${read.title} chars=${read.content.length} truncated=${read.truncated}`);
console.log(read.content.slice(0, 300));

try {
  await readKnowledgeDoc("../../etc/passwd");
  console.log("\n!! path traversal NOT blocked");
} catch (error) {
  console.log(`\npath traversal blocked: ${error instanceof Error ? error.message : "?"}`);
}
