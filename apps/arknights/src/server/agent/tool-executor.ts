import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import type { ToolSet } from "ai";
import { getDatabasePool } from "@riic/platform-server/db";
import { beginToolCharge, finishToolCharge } from "../billing/agent-accounting.ts";
import { projectPlanResult } from "./plan-artifact.ts";
import { AgentFilterError } from "./filter-policy.ts";
import { AgentToolError, type SolveEvent } from "./execution-types.ts";

export function createToolExecutor(runId: string, check: (text: string, stage: string) => Promise<void>) {
  const executions = new Map<string, string>();
  async function recordSolve(toolCallId: string, event: SolveEvent) {
    const id = executions.get(toolCallId);
    if (!id) throw new Error("Unknown tool execution");
    const pool = getDatabasePool();
    if ("computation" in event) {
      await pool.query(`UPDATE app.agent_tool_execution SET computation_state=$2,
        error_code=coalesce($3,error_code),updated_at=now() WHERE id=$1 AND computation_state IN ('unknown','running')`,
        [id, event.computation, "errorCode" in event ? event.errorCode : null]);
    } else {
      if ("result" in event) {
        try { await check(JSON.stringify(event.result), "tool_output"); }
        catch (error) {
          if (!(error instanceof AgentFilterError)) throw error;
          await pool.query("UPDATE app.agent_tool_execution SET processing_state='failed',error_code='content_blocked',updated_at=now() WHERE id=$1", [id]);
          throw new AgentToolError("content_blocked", "工具结果未通过内容检查。");
        }
      }
      await pool.query(`UPDATE app.agent_tool_execution SET processing_state=$2,result=$3,
        error_code=coalesce($4,error_code),updated_at=now() WHERE id=$1 AND processing_state='unknown'`,
        [id, event.processing, "result" in event ? JSON.stringify(event.result) : null, "errorCode" in event ? event.errorCode : null]);
    }
  }
  function wrap(tools: ToolSet): ToolSet {
    for (const [name, tool] of Object.entries(tools)) {
      const execute = tool.execute;
      if (!execute) continue;
      tool.execute = async (input, options) => {
        const id = randomUUID();
        await getDatabasePool().query(`INSERT INTO app.agent_tool_execution (id,run_id,tool_call_id,name,state)
          VALUES ($1,$2,$3,$4,'running')`, [id, runId, options.toolCallId, name]);
        executions.set(options.toolCallId, id);
        let chargeId: string | undefined;
        let state = "failed"; let errorCode: string | null = null;
        try {
          await check(JSON.stringify(input), "tool_input");
          if (name === "solve_schedule") chargeId = await beginToolCharge(runId, options.toolCallId, name);
          const output = await execute(input, options);
          await check(JSON.stringify(output), "tool_output");
          const failed = !!output && typeof output === "object" && "error" in output;
          const code = failed ? "errorCode" in output ? String(output.errorCode) : "tool_failed" : null;
          state = code === "tool_wait_timeout" ? "timed_out" : code === "tool_wait_cancelled" ? "cancelled" : failed ? "failed" : "succeeded";
          errorCode = code;
          if (chargeId) await finishToolCharge(chargeId, !failed);
          return output && typeof output === "object" ? { ...output, execution: { id, state, resultUrl: `/api/agent/executions/${id}` } } : output;
        } catch (error) {
          errorCode = error instanceof AgentToolError ? error.code : error instanceof AgentFilterError ? "content_blocked" : "tool_failed";
          state = errorCode === "tool_wait_cancelled" ? "cancelled" : errorCode === "tool_wait_timeout" ? "timed_out" : "failed";
          if (chargeId) await finishToolCharge(chargeId, false);
          if (error instanceof AgentFilterError) return { error: "工具结果未通过内容检查。", errorCode, execution: { id, state } };
          throw error;
        } finally {
          await getDatabasePool().query("UPDATE app.agent_tool_execution SET state=$2,wait_error_code=$3,finished_at=now(),updated_at=now() WHERE id=$1 AND state='running'", [id, state, errorCode]);
        }
      };
    }
    return tools;
  }
  return { wrap, recordSolve };
}

export async function readToolExecution(id: string, userId: string) {
  const { rows: [row] } = await getDatabasePool().query(`SELECT e.id,e.name,e.state,e.computation_state,e.processing_state,
    e.error_code,e.wait_error_code,e.result,e.created_at,e.finished_at,e.updated_at
    FROM app.agent_tool_execution e JOIN app.agent_run r ON r.id=e.run_id
    WHERE e.id=$1 AND r.user_id=$2`, [id, userId]);
  return row ? { ...row, plan: row.result ? projectPlanResult(row.result) : null } : null;
}
