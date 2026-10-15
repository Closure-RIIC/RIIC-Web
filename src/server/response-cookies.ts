import { serialize } from "cookie";

export function setResponseCookie(response: Response, name: string, value: string, options: Parameters<typeof serialize>[2]) {
  response.headers.append("Set-Cookie", serialize(name, value, options));
}
