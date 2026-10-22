import { POSTER_MAX_BYTES, readPosterFile } from "@/schedule-poster-document";
import { loadPosterSnapshot, savePosterSnapshot } from "@/server/schedule-poster-store";

const headers = { "Cache-Control": "no-store" };

export async function getSchedulePoster(request: Request): Promise<Response> {
  try {
    const doc = await loadPosterSnapshot(new URL(request.url).searchParams.get("code") ?? "");
    return Response.json({ document: doc }, { headers });
  } catch {
    return Response.json({ error: "未找到作业。请确认作业码和网站地址；本地作业码只在生成它的服务中有效。" }, { status: 404, headers });
  }
}

export async function createSchedulePoster(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== (request.headers.get("host") ?? new URL(request.url).host)) {
      return Response.json({ error: "请在本站生成作业码。" }, { status: 403, headers });
    }
    let size = 0;
    const chunks: Uint8Array[] = [];
    const reader = request.body?.getReader();
    if (!reader) throw new Error("缺少作业内容。");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > POSTER_MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "作业文件不能超过 256 KB。" }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const code = await savePosterSnapshot(readPosterFile(new TextDecoder().decode(bytes)));
    return Response.json({ code }, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败。" }, { status: 400, headers });
  }
}
