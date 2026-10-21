export const ALIYUN_DM_ENDPOINTS = {
  "cn-hangzhou": "https://dm.aliyuncs.com/",
  "ap-southeast-1": "https://dm.ap-southeast-1.aliyuncs.com/",
  "us-east-1": "https://dm.us-east-1.aliyuncs.com/",
  "eu-central-1": "https://dm.eu-central-1.aliyuncs.com/",
} as const;

export type AliyunEmailConfig = {
  region: keyof typeof ALIYUN_DM_ENDPOINTS;
  accountName: string;
  accessKeyId: string;
  accessKeySecret: string;
};

export type AuthEmailConfig = {
  provider: "resend" | "aliyun";
  from: string;
  resendApiKey?: string;
  aliyun?: AliyunEmailConfig;
};

export function requireAuthEmailConfig(env: Record<string, string | undefined> = process.env): AuthEmailConfig {
  const provider = env.AUTH_EMAIL_PROVIDER?.trim() || "resend";
  const fallback = env.AUTH_EMAIL_FALLBACK_PROVIDER?.trim() || "none";
  if (provider !== "resend" && provider !== "aliyun") {
    throw new Error("AUTH_EMAIL_PROVIDER must be resend or aliyun.");
  }
  if (fallback !== "none" && fallback !== "aliyun") {
    throw new Error("AUTH_EMAIL_FALLBACK_PROVIDER must be none or aliyun.");
  }
  const from = env.AUTH_EMAIL_FROM?.trim();
  if (!from) throw new Error("AUTH_EMAIL_FROM is required to send authentication email.");
  const resendApiKey = env.RESEND_API_KEY?.trim();
  if (provider === "resend" && !resendApiKey) {
    throw new Error("RESEND_API_KEY is required when AUTH_EMAIL_PROVIDER=resend.");
  }
  let aliyun: AliyunEmailConfig | undefined;
  if (provider === "aliyun" || fallback === "aliyun") {
    const region = env.ALIYUN_DM_REGION_ID?.trim();
    if (!region || !Object.hasOwn(ALIYUN_DM_ENDPOINTS, region)) {
      throw new Error("ALIYUN_DM_REGION_ID must be cn-hangzhou, ap-southeast-1, us-east-1 or eu-central-1.");
    }
    const accountName = env.ALIYUN_DM_ACCOUNT_NAME?.trim();
    if (!accountName || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(accountName)) {
      throw new Error("ALIYUN_DM_ACCOUNT_NAME must be one verified sender email address without a display name.");
    }
    const accessKeyId = env.ALIYUN_DM_ACCESS_KEY_ID?.trim();
    const accessKeySecret = env.ALIYUN_DM_ACCESS_KEY_SECRET?.trim();
    if (!accessKeyId || !accessKeySecret || /[\r\n]/.test(accessKeyId + accessKeySecret)) {
      throw new Error("ALIYUN_DM_ACCESS_KEY_ID and ALIYUN_DM_ACCESS_KEY_SECRET are required and must not contain line breaks.");
    }
    aliyun = { region: region as AliyunEmailConfig["region"], accountName, accessKeyId, accessKeySecret };
  }
  return { provider, from, resendApiKey, aliyun };
}
