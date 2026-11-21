import "@tanstack/react-start/server-only";
import { createRequestId, failureResponse, PublicApiError, assertSameOrigin, enforceRateLimit } from "@riic/platform-server/api-contract";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import { websiteAdminAccess } from "@riic/platform-server/auth/admin-access";
import { localTestSession } from "@riic/platform-server/auth/local-test-account";
import { getDatabasePool } from "@riic/platform-server/db";
import { ConversationStore, conversationStorageEnabled, type ArchiveScope } from "./conversation-store.ts";

const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
function identifier(value: string | null) {
  if (value && !/^[a-f0-9-]{36}$/.test(value)) throw new PublicApiError("AIC-REQ-1001");
  return value ?? undefined;
}
function date(value: string | null) {
  if (!value) return undefined;
  if (value.length > 40 || !Number.isFinite(Date.parse(value))) throw new PublicApiError("AIC-REQ-1001");
  return new Date(value).toISOString();
}

export async function archiveAccess(request: Request) {
  const session = await requireWebsiteSession(request);
  const account = (await getDatabasePool().query('SELECT id,role,banned FROM public."user" WHERE id=$1', [session.user.id])).rows[0];
  if (!account || account.banned) throw new PublicApiError("AIC-AUTH-2009");
  // Session lookup may be memoized for this request. Recheck revocation for each export batch.
  if (localTestSession(request)?.user.id !== session.user.id) {
    const sessionId = (session as { session?: { id?: string } }).session?.id;
    const valid = await getDatabasePool().query('SELECT id FROM public.session WHERE id=$1 AND user_id=$2 AND expires_at>now()', [sessionId ?? null, session.user.id]);
    if (!valid.rowCount) throw new PublicApiError("AIC-AUTH-2008");
  }
  const impersonated = (session as { session?: { impersonatedBy?: unknown } }).session?.impersonatedBy;
  const canManageAll = !impersonated && websiteAdminAccess(session.user.id, account.role).isSuperAdmin;
  return { userId: session.user.id, canManageAll, canExport: canManageAll };
}

export async function conversationApi(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    if (!conversationStorageEnabled()) return Response.json({ error: { message: "会话归档尚未启用。" } }, { status: 404, headers });
    const access = await archiveAccess(request);
    const params = new URL(request.url).searchParams;
    const action = params.get("action") ?? "list";
    if (action === "access" && request.method === "GET") return Response.json(access, { headers });
    const all = params.get("scope") === "all";
    if (all && !access.canManageAll) throw new PublicApiError("AIC-AUTH-2009");
    if (!all && params.has("userId")) throw new PublicApiError("AIC-AUTH-2009");
    const owner = all ? params.get("userId")?.trim() || undefined : access.userId;
    if (owner && owner.length > 128) throw new PublicApiError("AIC-REQ-1001");
    const scope: ArchiveScope = { userId: owner, from: date(params.get("from")), to: date(params.get("to")) };
    if (scope.from && scope.to && scope.from > scope.to) throw new PublicApiError("AIC-REQ-1001");
    enforceRateLimit("agent-archive-read", access.userId, 120, 60_000);
    const store = new ConversationStore();
    await store.recoverInterrupted(scope);
    const conversationId = identifier(params.get("id"));
    const auditScope = { ...scope, all, conversationId };
    if (request.method === "GET" && action === "list") {
      const audit = all ? await store.audit(access.userId, requestId, "list", auditScope) : undefined;
      try {
        const rows = await store.list(scope, identifier(params.get("before")));
        const items = rows.slice(0, 50);
        if (audit) await store.finishAudit(audit, "completed", items.length);
        return Response.json({ items, next: rows.length > 50 ? items.at(-1)?.id : null, canManageAll: access.canManageAll }, { headers });
      } catch (error) { if (audit) await store.finishAudit(audit, "failed", 0); throw error; }
    }
    if (request.method === "GET" && action === "detail" && conversationId) {
      const audit = all ? await store.audit(access.userId, requestId, "detail", auditScope) : undefined;
      try {
        const conversation = await store.detail(conversationId, scope);
        const items = await store.turns(scope, { conversationId, after: identifier(params.get("after")), limit: 51 });
        const turns = items.slice(0, 50).sort((a, b) => a.sequence - b.sequence);
        if (audit) await store.finishAudit(audit, "completed", turns.length);
        return Response.json({ conversation, turns, next: items.length > 50 ? items[49].id : null }, { headers });
      } catch (error) { if (audit) await store.finishAudit(audit, "failed", 0); throw error; }
    }
    if (request.method === "DELETE" && action === "delete" && conversationId && !all) {
      assertSameOrigin(request);
      const audit = await store.audit(access.userId, requestId, "delete_own", auditScope);
      try {
        await store.deleteOwn(conversationId, access.userId);
        await store.finishAudit(audit, "completed", 1);
      } catch (error) { await store.finishAudit(audit, "failed", 0); throw error; }
      return Response.json({ deleted: true }, { headers });
    }
    if (request.method === "POST" && action === "export") {
      if (!access.canExport) throw new PublicApiError("AIC-AUTH-2009");
      assertSameOrigin(request);
      enforceRateLimit("agent-archive-export", access.userId, 3, 60_000);
      if (conversationId) await store.detail(conversationId, scope);
      const format = params.get("format") ?? "jsonl";
      if (format !== "json" && format !== "jsonl") throw new PublicApiError("AIC-REQ-1001");
      const cutoff = new Date().toISOString();
      const metadata = { type: "manifest", schemaVersion: 1, exportedAt: cutoff, scope: auditScope,
        activeTurnsExcluded: true, messageSource: "user_input_and_server_ui_stream", binaryAttachmentsIncluded: false };
      const audit = await store.audit(access.userId, requestId, "export", { ...auditScope, format, cutoff });
      const encoder = new TextEncoder();
      let count = 0;
      let cancelled = false;
      const iterator = (async function* () {
        try {
          yield format === "jsonl" ? `${JSON.stringify(metadata)}\n` : `{"metadata":${JSON.stringify(metadata)},"turns":[`;
          for await (const turn of store.exportSnapshot(scope, conversationId, cutoff)) {
            if (cancelled) return;
            if (count % 200 === 0) {
              const current = await archiveAccess(request);
              if (!conversationStorageEnabled() || current.userId !== access.userId || !current.canExport) throw new PublicApiError("AIC-AUTH-2009");
            }
            yield format === "jsonl" ? `${JSON.stringify({ type: "turn", ...turn })}\n` : `${count ? "," : ""}${JSON.stringify(turn)}`;
            count++;
          }
          if (cancelled) return;
          await store.finishAudit(audit, "completed", count);
          const completion = { type: "completion", complete: true, recordCount: count };
          yield format === "jsonl" ? `${JSON.stringify(completion)}\n` : `],"completion":${JSON.stringify(completion)}}`;
        } catch (error) {
          await store.finishAudit(audit, "failed", count);
          throw error;
        }
      })();
      const stream = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const item = await iterator.next();
            if (cancelled) return;
            if (item.done) output.close(); else output.enqueue(encoder.encode(item.value));
          } catch { if (!cancelled) output.error(new Error("导出中断，请重新导出；完整文件必须包含 completion 记录。")); }
        },
        async cancel() { cancelled = true; await iterator.return(); await store.finishAudit(audit, "cancelled", count); },
      });
      return new Response(stream, { headers: { ...headers,
        "Content-Type": format === "jsonl" ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="agent-conversations-${cutoff.slice(0, 10)}.${format}"`,
      } });
    }
    throw new PublicApiError("AIC-REQ-1001");
  } catch (error) {
    const response = failureResponse(error, requestId, "/api/agent/archive", startedAt, "AIC-SYS-5000", request);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}
