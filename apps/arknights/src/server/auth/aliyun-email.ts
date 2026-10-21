import { createHmac, randomUUID } from "node:crypto";
import { AUTH_EMAIL_BRAND } from "../../auth-email-brand.ts";
import { ALIYUN_DM_ENDPOINTS, type AliyunEmailConfig } from "./email-config.ts";

export type AuthEmailMessage = { from: string; to: string; subject: string; text: string; html: string };

// Direct Mail RPC signature v1 requires RFC 3986 encoding, including !'()*.
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    "%" + character.charCodeAt(0).toString(16).toUpperCase());
}

export function signAliyunParameters(parameters: Record<string, string>, accessKeySecret: string): string {
  const canonical = Object.keys(parameters).filter((key) => key !== "Signature").sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(parameters[key])}`).join("&");
  const toSign = `POST&%2F&${percentEncode(canonical)}`;
  return createHmac("sha1", `${accessKeySecret}&`).update(toSign).digest("base64");
}

export async function sendAliyunEmail(message: AuthEmailMessage, config: AliyunEmailConfig): Promise<void> {
  // SingleSendMail accepts comma-separated recipients; auth messages must have exactly one.
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(message.to)) {
    throw new Error("Authentication email requires one recipient email address.");
  }
  const parameters: Record<string, string> = {
    AccessKeyId: config.accessKeyId,
    Action: "SingleSendMail",
    Format: "JSON",
    RegionId: config.region,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2015-11-23",
    AccountName: config.accountName,
    AddressType: "1",
    ReplyToAddress: "false",
    FromAlias: AUTH_EMAIL_BRAND,
    ToAddress: message.to,
    Subject: message.subject,
    HtmlBody: message.html,
    TextBody: message.text,
    ClickTrace: "0",
  };
  parameters.Signature = signAliyunParameters(parameters, config.accessKeySecret);
  let response: Response;
  try {
    response = await fetch(ALIYUN_DM_ENDPOINTS[config.region], {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams(parameters).toString(),
    });
  } catch {
    // Never propagate the request, provider body or error cause: these can contain auth secrets.
    throw new Error("Aliyun authentication email request failed; delivery status is unknown.");
  }
  if (!response.ok) {
    throw new Error(`Aliyun rejected authentication email (HTTP ${response.status}).`);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Aliyun authentication email returned an invalid response; delivery status is unknown.");
  }
  if (!result || typeof result !== "object" || "Code" in result ||
    !("EnvId" in result) || typeof result.EnvId !== "string" || !result.EnvId.trim()) {
    throw new Error("Aliyun authentication email was not acknowledged; delivery status is unknown.");
  }
}
