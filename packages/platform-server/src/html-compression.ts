/** Stream SSR documents using the browser's accepted encoding, without buffering. */
export function compressHtmlResponse(request: Request, response: Response): Response {
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const acceptsGzip = (request.headers.get("accept-encoding") ?? "").split(",").some((part) => {
    const [encoding, quality] = part.trim().split(";");
    return encoding === "gzip" && (!quality || Number(quality.trim().replace(/^q=/, "")) > 0);
  });
  if (!acceptsGzip || !response.body || response.headers.has("content-encoding")) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");
  headers.append("Vary", "Accept-Encoding");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status, statusText: response.statusText, headers,
  });
}
