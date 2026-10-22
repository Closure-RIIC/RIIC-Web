import { stringifySetCookie, type SerializeOptions } from "cookie";

export function setResponseCookie(response: Response, name: string, value: string, options: SerializeOptions = {}) {
  const { encode, ...attributes } = options;
  response.headers.append("Set-Cookie", stringifySetCookie({ ...attributes, name, value }, { encode }));
}
