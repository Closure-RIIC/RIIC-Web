import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import type { FileUIPart, UIMessage } from "ai";
import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@riic/platform-server/db";
import { PublicApiError } from "@riic/platform-server/api-contract";

export type ArchiveStatus = "streaming" | "completed" | "cancelled" | "failed" | "interrupted";
export interface ArchiveScope { userId?: string; from?: string; to?: string }
export interface ArchiveTurn {
  id: string; conversationId: string; userId: string; sequence: number; attemptId: string;
  requestId: string; runId: string | null; model: string; status: ArchiveStatus;
  userMessage: UIMessage; assistantMessage: UIMessage | null; userText: string; assistantText: string;
  createdAt: string; updatedAt: string; finishedAt: string | null;
}
export const conversationStorageEnabled = () => process.env.AGENT_CONVERSATION_STORAGE_ENABLED === "1";
export const messageText = (message: UIMessage | null) => message?.parts.flatMap(part => {
  if (part.type === "text") return [part.text];
  if (part.type === "data-archive-attachment" && typeof (part.data as { text?: unknown })?.text === "string") return [(part.data as { text: string }).text];
  return [];
}).join("\n") ?? "";

/** Binary bodies and URLs do not enter the archive. Text attachments retain their content. */
function archiveFile(part: FileUIPart): UIMessage["parts"][number] {
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
  const bytes = match ? Buffer.from(match[2], "base64") : null;
  return { type: "data-archive-attachment", data: {
    filename: part.filename ?? null, mediaType: part.mediaType, byteLength: bytes?.length ?? null,
    sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : null,
    ...(part.mediaType === "text/plain" && bytes ? { text: bytes.toString("utf8") } : {}),
    bodyStored: part.mediaType === "text/plain" && bytes !== null,
  } };
}

export function archiveUserMessage(message: UIMessage): UIMessage {
  return { id: message.id, role: "user", parts: message.parts.flatMap((part): UIMessage["parts"] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type !== "file") return [];
    const match = /^data:([^;]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
    if (!match) throw new PublicApiError("AIC-REQ-1001", { message: "附件格式无效。" });
    return [archiveFile(part)];
  }) };
}

export class ConversationStore {
  private pool: Pool;
  constructor(pool: Pool = getDatabasePool()) { this.pool = pool; }

  async begin(input: { userId: string; conversationId: unknown; attemptId: unknown; requestId: string; model: string; message: UIMessage }) {
    if (typeof input.conversationId !== "string" || !/^[\w:-]{1,128}$/.test(input.conversationId)
      || typeof input.attemptId !== "string" || !/^[\w-]{16,128}$/.test(input.attemptId)) {
      throw new PublicApiError("AIC-REQ-1001", { message: "请刷新页面后重新发送。" });
    }
    const message = archiveUserMessage(input.message);
    const text = messageText(message);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const conversation = (await client.query(
        `INSERT INTO app.agent_conversation (id,user_id,client_id,title,next_sequence) VALUES ($1,$2,$3,$4,1)
         ON CONFLICT (user_id,client_id) DO UPDATE SET next_sequence=app.agent_conversation.next_sequence+1,updated_at=now()
         RETURNING id,next_sequence`, [randomUUID(), input.userId, input.conversationId, text.trim().slice(0, 80) || "附件对话"],
      )).rows[0];
      const id = randomUUID();
      await client.query(`INSERT INTO app.agent_conversation_turn
        (id,conversation_id,user_id,sequence,attempt_id,request_id,model,status,user_message,user_text)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'streaming',$8,$9)`,
      [id, conversation.id, input.userId, conversation.next_sequence, input.attemptId, input.requestId, input.model, JSON.stringify(message), text]);
      await client.query("COMMIT");
      return { id, conversationId: conversation.id as string };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw new PublicApiError("AIC-REQ-1001", { message: "此发送尝试已经记录，请使用新的重试操作。" });
      throw error;
    } finally { client.release(); }
  }

  async checkpoint(id: string, message: UIMessage | null, status: ArchiveStatus, runId?: string, finishReason?: string) {
    // Only the server UI stream supplies assistant data. Drop non-visible reasoning defensively.
    const response = message ? { id: message.id, role: "assistant" as const,
      parts: message.parts.filter(part => part.type !== "reasoning").map(part => part.type === "file" ? archiveFile(part) : part),
      ...(finishReason ? { metadata: { finishReason } } : {}) } : null;
    const result = await this.pool.query(`UPDATE app.agent_conversation_turn SET assistant_message=$2,assistant_text=$3,
      status=$4,run_id=coalesce($5,run_id),updated_at=now(),finished_at=CASE WHEN $4='streaming' THEN NULL ELSE now() END
      WHERE id=$1 AND status='streaming' RETURNING conversation_id`, [id, response && JSON.stringify(response), messageText(response), status, runId ?? null]);
    if (result.rows[0]) await this.pool.query("UPDATE app.agent_conversation SET updated_at=now() WHERE id=$1", [result.rows[0].conversation_id]);
    else if (!(await this.pool.query("SELECT id FROM app.agent_conversation_turn WHERE id=$1", [id])).rowCount) throw new Error("Archive turn no longer exists");
  }

  async recoverInterrupted(scope: ArchiveScope) {
    await this.pool.query(`UPDATE app.agent_conversation_turn SET status='interrupted',finished_at=now(),updated_at=now()
      WHERE status='streaming' AND updated_at < now()-interval '15 minutes' AND ($1::text IS NULL OR user_id=$1)`, [scope.userId ?? null]);
  }

  async list(scope: ArchiveScope, before?: string) {
    return (await this.pool.query(`SELECT c.id,c.user_id AS "userId",c.client_id AS "clientId",c.title,
      c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.next_sequence AS "turnCount"
      FROM app.agent_conversation c WHERE ($1::text IS NULL OR c.user_id=$1)
      AND EXISTS (SELECT 1 FROM app.agent_conversation_turn t WHERE t.conversation_id=c.id
        AND ($2::timestamptz IS NULL OR t.created_at >= $2) AND ($3::timestamptz IS NULL OR t.created_at <= $3))
      AND ($4::text IS NULL OR (c.created_at,c.id) < (SELECT created_at,id FROM app.agent_conversation WHERE id=$4))
      ORDER BY c.created_at DESC,c.id DESC LIMIT 51`, [scope.userId ?? null, scope.from ?? null, scope.to ?? null, before ?? null])).rows;
  }

  async detail(id: string, scope: ArchiveScope) {
    const conversation = (await this.pool.query(`SELECT id,title,user_id AS "userId" FROM app.agent_conversation
      WHERE id=$1 AND ($2::text IS NULL OR user_id=$2)`, [id, scope.userId ?? null])).rows[0];
    if (!conversation) throw new PublicApiError("AIC-DATA-8004");
    // Detail is paginated too: a conversation is not limited by browser history length.
    return conversation;
  }

  async turns(scope: ArchiveScope, options: { conversationId?: string; after?: string; cutoff?: string; terminalOnly?: boolean; limit?: number } = {}, connection: Pick<PoolClient, "query"> = this.pool): Promise<ArchiveTurn[]> {
    return (await connection.query(`SELECT t.id,t.conversation_id AS "conversationId",t.user_id AS "userId",t.sequence,
      t.attempt_id AS "attemptId",t.request_id AS "requestId",t.run_id AS "runId",t.model,t.status,
      t.user_message AS "userMessage",t.assistant_message AS "assistantMessage",t.user_text AS "userText",t.assistant_text AS "assistantText",
      t.created_at AS "createdAt",t.updated_at AS "updatedAt",t.finished_at AS "finishedAt"
      FROM app.agent_conversation_turn t WHERE ($1::text IS NULL OR t.user_id=$1)
      AND ($2::timestamptz IS NULL OR t.created_at >= $2) AND ($3::timestamptz IS NULL OR t.created_at <= $3)
      AND ($4::text IS NULL OR t.conversation_id=$4)
      AND ($5::text IS NULL OR CASE WHEN $4::text IS NULL THEN t.id > $5
        ELSE t.sequence > (SELECT sequence FROM app.agent_conversation_turn WHERE id=$5 AND conversation_id=$4) END)
      AND ($6::timestamptz IS NULL OR t.finished_at <= $6) AND (NOT $7::boolean OR t.status <> 'streaming')
      ORDER BY CASE WHEN $4::text IS NOT NULL THEN t.sequence END,t.id LIMIT $8`, [scope.userId ?? null, scope.from ?? null, scope.to ?? null, options.conversationId ?? null,
      options.after ?? null, options.cutoff ?? null, options.terminalOnly ?? false, Math.min(options.limit ?? 200, 500)])).rows;
  }

  async *exportSnapshot(scope: ArchiveScope, conversationId: string | undefined, cutoff: string) {
    const client = await this.pool.connect();
    let active = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      active = true;
      await client.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
      let after: string | undefined;
      for (;;) {
        const batch = await this.turns(scope, { conversationId, after, cutoff, terminalOnly: true }, client);
        if (!batch.length) break;
        for (const turn of batch) yield turn;
        after = batch.at(-1)!.id;
      }
      await client.query("COMMIT");
      active = false;
    } finally {
      try { if (active) await client.query("ROLLBACK"); } finally { client.release(); }
    }
  }

  async deleteOwn(id: string, userId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      // begin() locks this same parent before inserting a turn. Check active turns
      // in a fresh statement after acquiring the lock, including any just committed.
      const conversation = await client.query("SELECT id FROM app.agent_conversation WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId]);
      if (!conversation.rowCount) throw new PublicApiError("AIC-DATA-8004");
      const active = await client.query("SELECT id FROM app.agent_conversation_turn WHERE conversation_id=$1 AND status='streaming' LIMIT 1", [id]);
      if (active.rowCount) throw new PublicApiError("AIC-REQ-1001", { message: "此会话仍在生成，请停止或结束后再删除归档。" });
      await client.query("DELETE FROM app.agent_conversation WHERE id=$1 AND user_id=$2", [id, userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async audit(actorId: string, requestId: string, action: string, scope: Record<string, unknown>) {
    const id = randomUUID();
    await this.pool.query(`INSERT INTO app.agent_conversation_audit (id,actor_id,request_id,action,scope,result)
      VALUES ($1,$2,$3,$4,$5,'started')`, [id, actorId, requestId, action, JSON.stringify(scope)]);
    return id;
  }

  async finishAudit(id: string, result: "completed" | "failed" | "cancelled", count: number) {
    await this.pool.query("UPDATE app.agent_conversation_audit SET result=$2,record_count=$3,updated_at=now() WHERE id=$1", [id, result, count]);
  }
}
