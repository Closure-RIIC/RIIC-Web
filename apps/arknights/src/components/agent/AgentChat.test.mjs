import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { URL, pathToFileURL, fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Compile the real card and result summaries; browser E2E covers chip disclosure and motion.
test("agent cards group sources, expose only knowledge subjects, and render failures once", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const temporary = await mkdtemp(path.join(root, ".agent-card-test-"));
  try {
    const outfile = path.join(temporary, "card.mjs");
    await build({ entryPoints: [path.join(root, "src/components/agent/AgentChat.tsx")], outfile, bundle: true,
      platform: "node", format: "esm", packages: "external", jsx: "automatic", plugins: [{ name: "card-only", setup(builder) {
        builder.onResolve({ filter: /^react$/, namespace: "stub" }, (args) => ({ path: args.path, external: true }));
        builder.onResolve({ filter: /^@\/agent-answer$/ }, () => ({ path: path.join(root, "src/agent-answer.ts") }));
        builder.onResolve({ filter: /^(@ai-sdk\/react|ai$|@tanstack\/react-router$|@\/|\.\/)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: `
          import { createElement } from "react";
          export default {};
          export const Link=({to,children,...props})=>createElement("a",{href:to,...props},children);
          export const useChat=()=>({});
          export const Chat=class{};
          export const DefaultChatTransport=class{};
          export const convertFileListToFileUIParts=async()=>[];
          export const useAgentRuntime=()=>({});
          export const useAgentHistory=()=>({});
          export const useAgentViewport=()=>{};
          export const useAgentScroll=()=>({});
          export const subscribeBillingUpdates=()=>()=>{};
          export const useIsMobile=()=>false;
          export const AGENT_PERSONA_SELECTION_KEY="test-persona";
          export const builtinAgentPersona=()=>undefined;
          export const resolveAgentPersonaSelection=()=>null;
          export const accountOrbColor=()=>"";
          export const parsePersonaAvatar=()=>undefined;
          export const readPersonaAvatar=()=>undefined;
          export const buildAgentDisplayTurns=()=>[];
          export const hasActiveAgentContent=()=>false;
          export const snapshotAgentReplyPersona=()=>({});
          export const agentChatErrorMessage=()=>"";
          export const Combobox=({children})=>children ?? null;
          export const ComboboxContent=({children})=>children ?? null;
          export const ComboboxInput=()=>null;
          export const ComboboxTrigger=()=>null;
          export const SidebarTrigger=()=>null;
          export const AgentComposerMenu=()=>null;
          export const ComboboxItem=({children})=>children ?? null;
          export const ComboboxList=()=>null;
          export const ToolChip=({label,children})=>createElement("div",null,label,children);
          export const AGENT_BROADCAST_CHANNEL="test";
          export const requestAgentArtifactOpen=()=>{};
          export const agentArtifactFromOutput=(output)=>output?.workbenchSession ? {session:output.workbenchSession,preset:"243"} : null;
          ${["PlanArtifactView", "MarkdownMessage", "WorkbenchPageHeading", "WorkbenchCard", "FluidOrb", "PersonaAvatar", "AgentCreditBalance", "AgentConversationScrollArea", "ChatBubble", "ChatPanel", "LoadingState", "PromptBar", "StreamingText", "ThinkingState", "Button", "Dialog", "DialogBody", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map((name) => `export const ${name}=({children})=>children ?? null;`).join("\n")}
        ` }));
      } }] });
    const { AgentToolCard, formatEnvironmentSummary } = await import(pathToFileURL(outfile).href);
    assert.equal(formatEnvironmentSummary({ fireworks: 0, sami: 1, abyssal: 2, knights: 0 }, { fireworks: "默认值（未自动推导）", sami: "森空岛自动读取", abyssal: "森空岛自动读取", knights: "手动指定" }), "默认：人间烟火 0；森空岛自动读取：萨米 1、深海猎人 2；用户指定：骑士 0");
    const render = (part) => renderToStaticMarkup(React.createElement(AgentToolCard, { part }));
    const solve = render({ type: "tool-solve_schedule", state: "output-available", output: { plan: { layoutLabel: "243", summary: {} }, workbenchSession: {}, planUrl: "/plan/old" } });
    assert.match(solve, /在基建计算器打开/);
    assert.doesNotMatch(solve, /只读结果页|\/plan\/old/);
    const skill = render({ type: "tool-query_skills", state: "output-available", output: { query: "巫恋", skills: [{ description: "隐藏的长原文" }], path: "docs/private.md" } });
    assert.match(skill, /技能查询 完成 · 巫恋/); assert.doesNotMatch(skill, /隐藏的长原文|docs\/private/);
    const reading = render({ type: "tool-kb_read", state: "output-available", output: { title: "违约索赔", content: "隐藏正文", path: "docs/private.md" } });
    assert.match(reading, /知识库阅读 完成《违约索赔》/); assert.doesNotMatch(reading, /隐藏正文|docs\/private/);
    const route = render({ type: "tool-kb_route", state: "output-available", output: { query: "内部扩展关键词", matched: [{ path: "docs/private.md" }] } });
    assert.match(route, /知识库导诊 完成/); assert.doesNotMatch(route, /内部扩展关键词|private/);
    for (const [code, message] of [["insufficient_training", "至简当前精0，练度不足；按精二前提计算。"], ["not_owned", "需先获得至简并提升至精二。"], ["ownership_unknown", "无法确认个人持有与练度。"]]) {
      const output = { targetOperator: { name: "至简" }, operator: { name: "至简" }, sourceName: "测试干员池", warnings: [{ code, message }],
        settings: { current: 0, target: 3, bufferMinutes: 1 }, simple: { totalTime: "10:00:00", switches: 0 }, fast: { totalTime: "9:00:00", switches: 1 }, assumptions: "按目标已获得且精二计算。" };
      for (const name of ["calculate_mastery", "resolve_operator"]) {
        const markup = render({ type: `tool-${name}`, state: "output-available", output });
        assert.match(markup, /完成/); assert.doesNotMatch(markup, /出错/);
        assert.equal(markup.split(message).length - 1, 1);
        if (name === "calculate_mastery") assert.match(markup, /简单方案.*10:00:00.*快速方案.*9:00:00/);
      }
      const sample = render({ type: "tool-calculate_mastery", state: "output-available", output: { ...output, isSample: true } });
      assert.match(sample, /全精二示例干员池计算，不代表个人实际持有与练度/);
      const legacy = render({ type: "tool-calculate_mastery", state: "output-available", output: { ...output, warnings: undefined } });
      assert.doesNotMatch(legacy, /出错|undefined/);
    }
    for (const state of ["output-available", "output-error"]) {
      const failure = render({ type: "tool-calculate_mastery", state, output: { error: "请确认目标干员" }, errorText: "请确认目标干员" });
      assert.equal(failure.split("请确认目标干员").length - 1, 1);
      const knowledge = render({ type: "tool-kb_read", state, output: { error: "E:/private/secret" }, errorText: "E:/private/secret" });
      assert.equal(knowledge.split("本次查询暂未完成").length - 1, 1); assert.doesNotMatch(knowledge, /private/);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
