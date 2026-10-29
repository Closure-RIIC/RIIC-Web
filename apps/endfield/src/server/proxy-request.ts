const localPeers = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function restoreHttpsProxyRequest(request: Request): Request {
  // Nitro's Node preset does not enable srvx trustProxy. Trust the socket peer,
  // never a client-supplied IP header; the local ingress overwrites the protocol.
  const peer = (request as Request & {
    runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } };
  }).runtime?.node?.req?.socket?.remoteAddress;
  if (!peer || !localPeers.has(peer) || request.headers.get("x-forwarded-proto") !== "https") return request;
  const url = new URL(request.url);
  if (url.protocol !== "http:") return request;
  url.protocol = "https:";
  return new Request(url, request);
}
