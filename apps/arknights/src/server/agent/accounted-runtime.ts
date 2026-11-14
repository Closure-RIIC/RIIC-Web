import "@tanstack/react-start/server-only";
import { wrapLanguageModel } from "ai";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { beginModelCall, finishModelCall, markRunDelivered, recordFilterEvent, settleAgentRun } from "../billing/agent-accounting.ts";
import { findModelRate } from "../billing/rate-policy.ts";
import { createFilteredTextBuffer, type CompiledFilter } from "./filter-policy.ts";
export function createAccountedRun(input: {
  runId: string; requestId: string; userId: string; filterVersion: string; filter: CompiledFilter;
  model: LanguageModelV4;
  identity: (headers: Record<string, string>) => { provider: string; model: string; requestId?: string };
  validateIdentity?: boolean;
  responseModelIdentity?: boolean;
  trace?: (data: { callId: string; startedAt: number; model?: string }) => Promise<unknown>;
}) {
  let step = 0; let delivered = false; let closing = false; let terminal: Promise<void> | undefined;
  let terminalState: "completed" | "failed" | "cancelled" | "blocked" | undefined;
  const active = new Set<Promise<void>>();
  async function finalize(state: "completed" | "failed" | "cancelled" | "blocked") {
    closing = true;
    terminalState ??= state;
    terminal ??= (async () => { await Promise.all([...active]); await settleAgentRun(input.runId, terminalState!); })()
      .catch(error => { terminal = undefined; throw error; });
    return terminal;
  }
  const model = wrapLanguageModel({ model: input.model, middleware: {
    specificationVersion: "v4",
    wrapStream: async ({ doStream, params }) => {
      if (closing) throw new Error("Agent run is already closing");
      let done!: () => void;
      const completion = new Promise<void>(resolve => { done = resolve; }); active.add(completion);
      let call: Awaited<ReturnType<typeof beginModelCall>> | undefined;
      let providerId: string | undefined; let actualModel: string | undefined; let gatewayRequestId: string | undefined;
      let finished = false; let responseStarted = false;
      const startedAt = Date.now(); let traced = false;
      const trace = async () => {
        if (traced || !call) return; traced = true;
        await input.trace?.({ callId: call.id, startedAt, model: providerId && actualModel ? `${providerId}/${actualModel}` : undefined });
      };
      const end = () => { done(); active.delete(completion); };
      try {
        const bytes = Buffer.byteLength(JSON.stringify({ prompt: params.prompt, tools: params.tools }));
        call = await beginModelCall(input.runId, step++, bytes, params.maxOutputTokens ?? 2048);
        const response = await doStream();
        responseStarted = true;
        const headers = response.response?.headers ?? {};
        const identity = input.identity(headers);
        providerId = identity.provider; actualModel = identity.model; gatewayRequestId = identity.requestId;
        if (!providerId || !actualModel) { await response.stream.cancel(); throw new Error("Actual model identity missing"); }
        if (input.validateIdentity) {
          try { findModelRate(call.policy, providerId, actualModel); }
          catch (error) { await response.stream.cancel(); throw error; }
        }
        const reader = response.stream.getReader();
        const buffers = new Map<string, ReturnType<typeof createFilteredTextBuffer>>();
        const hits = new Set<string>();
        const toolParts = new Map<string, LanguageModelV4StreamPart[]>();
        let bufferedToolBytes = 0;
        const event = async () => {
          if (hits.size) await recordFilterEvent({ ...input, version: input.filterVersion, stage: "output", ruleIds: [...hits] });
        };
        return { ...response, stream: new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            try {
              while (true) {
              const { value, done: eof } = await reader.read();
              if (eof) {
                if (!finished) await finishModelCall({ id: call!.id, provider: providerId, model: actualModel, gatewayRequestId, error: "missing_finish" });
                await event(); await trace(); end(); controller.close(); return;
              }
              if (value.type === "response-metadata") {
                if (value.id) gatewayRequestId = value.id;
                if (input.responseModelIdentity && value.modelId) actualModel = value.modelId;
              }
              if (value.type === "text-start" || value.type === "reasoning-start") buffers.set(`${value.type.split("-")[0]}:${value.id}`, createFilteredTextBuffer(input.filter, ids => ids.forEach(id => hits.add(id))));
              if (value.type === "text-delta" || value.type === "reasoning-delta") {
                const buffer = buffers.get(`${value.type.split("-")[0]}:${value.id}`);
                if (!buffer) throw new Error("Unexpected text stream sequence");
                const delta = buffer.push(value.delta);
                if (delta) {
                  controller.enqueue({ ...value, delta });
                }
                if (delta) return;
                continue;
              }
              if (value.type === "text-end" || value.type === "reasoning-end") {
                const prefix = value.type.split("-")[0]; const key = `${prefix}:${value.id}`;
                const delta = buffers.get(key)?.push("", true) ?? "";
                if (delta) {
                  controller.enqueue({ type: prefix === "text" ? "text-delta" : "reasoning-delta", id: value.id, delta });
                }
                buffers.delete(key);
              }
              if (value.type === "tool-input-start") { toolParts.set(value.id, [value]); continue; }
              if (value.type === "tool-input-delta" || value.type === "tool-input-end") {
                if (value.type === "tool-input-delta") bufferedToolBytes += value.delta.length;
                if (bufferedToolBytes > 64_000) throw new Error("Tool argument limit exceeded");
                const list = toolParts.get(value.id); if (!list) throw new Error("Unexpected tool stream sequence"); list.push(value); continue;
              }
              if (value.type === "tool-call") {
                input.filter.assert(value.input);
                for (const part of toolParts.get(value.toolCallId) ?? []) controller.enqueue(part);
                toolParts.delete(value.toolCallId);
              }
              if (value.type === "finish") {
                const measured = value.usage.inputTokens.total !== undefined && value.usage.outputTokens.total !== undefined;
                await finishModelCall({ id: call!.id, provider: providerId, model: actualModel, gatewayRequestId,
                  usage: measured ? { inputTokens: value.usage.inputTokens.total!, outputTokens: value.usage.outputTokens.total!, cachedInputTokens: value.usage.inputTokens.cacheRead ?? 0 } : undefined });
                finished = true;
              }
              if (value.type === "error") throw new Error("Upstream stream failed");
              controller.enqueue(value);
              return;
              }
            } catch {
              try { await reader.cancel(); await finishModelCall({ id: call!.id, provider: providerId, model: actualModel, gatewayRequestId, error: "stream_failed" }); await event(); await trace(); }
              finally { end(); controller.error(new Error("本次回复中断，已保留可核验用量，请稍后重试。")); }
            }
          },
          async cancel(reason) {
            try { await reader.cancel(reason); await finishModelCall({ id: call!.id, provider: providerId, model: actualModel, gatewayRequestId, error: "cancelled" }); await event(); await trace(); }
            finally { end(); }
          },
        }) };
      } catch (error) {
        try { if (call) await finishModelCall({ id: call.id, provider: providerId, model: actualModel, gatewayRequestId, error: responseStarted ? "identity_failed" : "request_failed" }); }
        finally { try { await trace(); } finally { end(); } }
        throw error;
      }
    },
  } });
  return { model, finalize, async deliver() {
    if (!delivered) { await markRunDelivered(input.runId); delivered = true; }
  } };
}
