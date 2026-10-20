export const WEBSITE_ACCOUNT_NAME_MIN_LENGTH = 2;
export const WEBSITE_ACCOUNT_NAME_MAX_LENGTH = 20;
export const WEBSITE_ACCOUNT_NAME_HINT = "2–20 个字符，可使用中文、英文字母、数字、空格、下划线和短横线。";

const ALLOWED_ACCOUNT_NAME = /^[\p{Script=Han}A-Za-z0-9 _-]+$/u;
const ACCOUNT_NAME_CONTENT = /[\p{Script=Han}A-Za-z0-9]/u;

export interface WebsiteAccountNameValidation {
  name: string;
  error: string | null;
}

export function validateWebsiteAccountName(value: unknown): WebsiteAccountNameValidation {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  const length = Array.from(name).length;
  if (length < WEBSITE_ACCOUNT_NAME_MIN_LENGTH || length > WEBSITE_ACCOUNT_NAME_MAX_LENGTH) {
    return { name, error: `昵称长度需为 ${WEBSITE_ACCOUNT_NAME_MIN_LENGTH}–${WEBSITE_ACCOUNT_NAME_MAX_LENGTH} 个字符。` };
  }
  if (!ALLOWED_ACCOUNT_NAME.test(name) || !ACCOUNT_NAME_CONTENT.test(name)) {
    return { name, error: "昵称只能使用中文、英文字母、数字、空格、下划线和短横线，且至少包含一个文字或数字。" };
  }
  if (/ {2,}/.test(name)) return { name, error: "昵称不能包含连续空格。" };
  return { name, error: null };
}
