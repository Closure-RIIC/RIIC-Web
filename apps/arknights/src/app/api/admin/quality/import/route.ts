import { requireWebsiteReviewer } from "@/server/auth/authorization";
import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, requestClientIp, successResponse } from "@/server/api-contract";
import { previewImports } from "@/server/quality/import";
import { stageImport } from "@/server/quality/import-preview";
import { QUALITY_TOTAL_LIMIT } from "@/quality";
import type { ReproductionSettings } from "@/reproduction-package";
export async function POST(request: Request) {
  const requestId = createRequestId(), startedAt = performance.now();
  let response: Response;
  try {
    const actor = await requireWebsiteReviewer(request);
    assertSameOrigin(request);
    enforceRateLimit("quality-import", requestClientIp(request), 10, 10 * 60_000);
    const reader = request.body?.getReader();
    if (!reader) throw new PublicApiError("AIC-REQ-1001");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > QUALITY_TOTAL_LIMIT + 2 * 1024 * 1024) { await reader.cancel(); throw new PublicApiError("AIC-REQ-1002"); }
      chunks.push(next.value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("Content-Type") ?? "" } }).formData();
    const files = form.getAll("files");
    if (!files.length || files.length > 500 || files.some((file) => typeof file === "string")) throw new PublicApiError("AIC-REQ-1001");
    const settings = form.get("settings");
    const entries = previewImports(await Promise.all((files as File[]).map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))), typeof settings === "string" ? JSON.parse(settings) as ReproductionSettings : undefined);
    response = successResponse(await stageImport(entries, actor.userId), requestId);
  } catch (error) { response = failureResponse(error instanceof PublicApiError ? error : new PublicApiError("AIC-REQ-1001", { message: error instanceof Error ? error.message : "导入失败" }), requestId, "/api/admin/quality/import", startedAt); }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
