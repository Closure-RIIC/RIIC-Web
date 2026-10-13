/* global console */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import { masteryRules, environments } from "./mastery-rule-definitions.mjs";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const catalog = await read("src/generated/arkntools/operator-catalog.json");
const skills = await read("src/generated/arkntools/building-skill-catalog.json");
const source = await read("src/generated/arkntools/source.json");
const output = "src/generated/mastery-data.json";
const check = process.argv.includes("--check");
const trainingIds = Object.keys(skills).filter((id) => id.startsWith("train_")).sort();
for (const id of trainingIds) if (!masteryRules[id]) throw new Error(`Unclassified training skill: ${id}`);
for (const id of Object.keys(masteryRules)) if (!skills[id]) throw new Error(`Unknown training skill: ${id}`);
const previous = await read(output).catch((error) => { if (error.code === "ENOENT" && !check) return null; throw error; });
const gamePath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? ".tmp/mastery-character-table.json";
const game = check ? null : await read(gamePath);
const gameSourceSha = process.argv.find((arg) => arg.startsWith("--game-source-sha="))?.split("=")[1];
const gameRepository = "https://github.com/Kengxxiao/ArknightsGameData";
const branchSource = check ? previous.source.branches : gameSourceSha === undefined ? source.portraitsSource : {
  repository: gameRepository, commit: gameSourceSha,
};
if (!/^[0-9a-f]{40}$/.test(branchSource?.commit)
  || ![gameRepository, source.portraitsSource.repository].includes(branchSource?.repository)) {
  throw new Error("Invalid pinned character table source.");
}
const branches = {};
for (const operator of catalog) {
  const branch = check ? previous.branches[operator.id] : game[operator.id]?.subProfessionId;
  if (!branch) throw new Error(`Missing branch for ${operator.id}`);
  branches[operator.id] = branch;
}
// A source-text change requires regenerating and reviewing the numerical rules.
const descriptionsHash = createHash("sha256").update(JSON.stringify(trainingIds.map((id) => [id, skills[id].descriptionRich]))).digest("hex");
if (!check && previous && previous.source.descriptionsHash !== descriptionsHash && !process.argv.includes("--review-rules")) {
  throw new Error("Training descriptions changed. Review mastery-rule-definitions.mjs, then regenerate with --review-rules.");
}
const data = {
  source: { rules: source.source, branches: branchSource, descriptionsHash },
  branches, environments, rules: Object.fromEntries(trainingIds.map((id) => [id, masteryRules[id]])),
};
const serialized = JSON.stringify(data, null, 2) + "\n";
if (check) {
  if (await readFile(output,"utf8") !== serialized) throw new Error("Mastery data is stale. Review rules and regenerate with the pinned character_table.json.");
} else await writeFile(output, serialized);
console.log(`Mastery data ${check ? "verified" : "generated"}: ${catalog.length} operators, ${trainingIds.length} skills.`);
