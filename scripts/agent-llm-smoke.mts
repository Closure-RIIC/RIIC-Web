import { generateText, tool } from "ai";
import { z } from "zod";

import { getAgentModel } from "../apps/arknights/src/server/agent/llm.ts";

const model = getAgentModel();
console.log("model resolved, starting basic call...");

const basic = await generateText({ model, prompt: "只回复两个字：收到" });
console.log("BASIC OK →", JSON.stringify(basic.text));

const withTool = await generateText({
  model,
  prompt: "调用工具查询技能关键词「订单效率」，然后用一句话概括返回结果。",
  tools: {
    query_skills: tool({
      description: "按关键词查基建技能",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ matched: [`模拟技能：${query}相关技能×3`] }),
    }),
  },
});
console.log("TOOLCALL OK → steps:", withTool.steps.length, "text:", JSON.stringify(withTool.text.slice(0, 80)));
