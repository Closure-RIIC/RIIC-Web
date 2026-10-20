import { PublicApiError } from "./api-contract.ts";

export type PlanAccessMode = "trusted-sample" | "authenticated";

export function planAccessMode(boxSource: unknown, hasClientOperbox: boolean): PlanAccessMode {
  if (boxSource !== undefined && !["skland", "maa", "sample"].includes(String(boxSource))) throw new PublicApiError("AIC-REQ-1001");
  if (boxSource === "sample") {
    if (hasClientOperbox) throw new PublicApiError("AIC-REQ-1001", { message: "全角色数据由服务端提供，不能由客户端覆盖。" });
    return "trusted-sample";
  }
  return "authenticated";
}
