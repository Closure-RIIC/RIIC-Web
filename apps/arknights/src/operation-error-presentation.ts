import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type { AppLocale } from "@riic/contracts/locale";
import type Messages from "../messages/zh-CN/OperationErrors.json";
const errors = createLocalizer<typeof Messages>("OperationErrors");

/** Preserve protocol diagnostics and foreign text; translate known first-party messages only. */
export function localizedOperationError(message: string, locale: AppLocale): string {
  if (message.includes("\n")) return message.split("\n").map(line => localizedOperationError(line, locale)).join("\n");
  if (message === "任务已经开始计算，暂时无法取消；完成后仍会保留结果。") return errors.text(locale, "running");
  if (message === "任务状态已经变化，正在重新查询。") return errors.text(locale, "changed");
  if (message === "任务已取消。") return errors.text(locale, "cancelled");
  if (message === "排班失败，请重试。") return errors.text(locale, "failed");
  if (message === "任务不存在或已过期，请重新生成排班。") return errors.text(locale, "missing");
  if (message === "任务状态异常，请刷新页面后重试。") return errors.text(locale, "invalid");
  if (message === "登录已过期，请重新登录后刷新页面继续查询。") return errors.text(locale, "signedOut");
  if (message === "网络异常，请点击查询进度。") return errors.text(locale, "network");
  if (message === "取消请求未确认，任务仍会继续查询。") return errors.text(locale, "cancelPending");
  if (message === "排班任务已完成，但没有返回可用结果。") return errors.text(locale, "noResult");
  if (message === "Task context changed.") return errors.text(locale, "contextChanged");
  if (message === "作业文件不能超过 256 KB。") return errors.text(locale, "fileSize");
  if (message === "单页最多支持 7 个生产设施。") return errors.text(locale, "productionLimit");
  if (message === "最多支持 3 个发电站。") return errors.text(locale, "powerLimit");
  if (message === "layout 必须是 JSON 对象。") return errors.text(locale, "layoutObject");
  if (message === "template 必须是非空字符串。") return errors.text(locale, "layoutTemplate");
  if (message === "scenario 必须是对象。") return errors.text(locale, "layoutScenario");
  if (message === "rooms 必须是非空数组。") return errors.text(locale, "layoutRooms");
  if (message === "布局至少需要一个发电站。") return errors.text(locale, "layoutPower");
  { const match = new RegExp("^作业文件格式不正确：(.*)$").exec(message); if (match) return errors.text(locale, "fileFormat", { detail: match[1]! }); }
  { const match = new RegExp("^未知设施 (.+)$").exec(message); if (match) return errors.text(locale, "unknownRoom", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 人数超过容量。$").exec(message); if (match) return errors.text(locale, "roomCapacity", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 的 AUTO 槽位重复。$").exec(message); if (match) return errors.text(locale, "autoDuplicate", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 不支持 MAA 自动填充。$").exec(message); if (match) return errors.text(locale, "autoUnsupported", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 的 AUTO 槽位超过设施容量。$").exec(message); if (match) return errors.text(locale, "autoCapacity", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 的 AUTO 槽位不能同时安排固定干员。$").exec(message); if (match) return errors.text(locale, "autoOccupied", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 设置了 AUTO 槽位但关闭了设施自动填充。$").exec(message); if (match) return errors.text(locale, "autoDisabled", { room: match[1]! }); }
  { const match = new RegExp("^第 (\\d+) 班的 (.+) 重复入驻。$").exec(message); if (match) return errors.text(locale, "duplicateOperator", { shift: match[1]!, name: match[2]! }); }
  { const match = new RegExp("^(.+) 产物类型不符。$").exec(message); if (match) return errors.text(locale, "productType", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 合成玉需要 3 级贸易站。$").exec(message); if (match) return errors.text(locale, "tradeLevel", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 源石碎片需要 3 级制造站解锁。$").exec(message); if (match) return errors.text(locale, "factoryLevel", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 必须是 (.+) 的整数。$").exec(message); if (match) return errors.text(locale, "integer", { field: match[1]!, range: match[2]! }); }
  { const match = new RegExp("^(.+) 必须是对象。$").exec(message); if (match) return errors.text(locale, "object", { field: match[1]! }); }
  { const match = new RegExp("^(.+) 必须是非空字符串。$").exec(message); if (match) return errors.text(locale, "nonempty", { field: match[1]! }); }
  { const match = new RegExp("^(.+) 不能包含首尾空格。$").exec(message); if (match) return errors.text(locale, "space", { field: match[1]! }); }
  { const match = new RegExp("^房间 ID 重复：(.+)。$").exec(message); if (match) return errors.text(locale, "duplicateRoom", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 不受支持。$").exec(message); if (match) return errors.text(locale, "unsupported", { field: match[1]! }); }
  { const match = new RegExp("^(.+) 缺少有效贸易订单。$").exec(message); if (match) return errors.text(locale, "tradeOrder", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 仅 3 级贸易站可使用开采协力。$").exec(message); if (match) return errors.text(locale, "tradeUnlock", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 缺少有效制造配方。$").exec(message); if (match) return errors.text(locale, "factoryRecipe", { room: match[1]! }); }
  { const match = new RegExp("^(.+) 需至少一个 3 级制造站解锁源石碎片配方。$").exec(message); if (match) return errors.text(locale, "factoryUnlock", { room: match[1]! }); }
  { const match = new RegExp("^布局必须且只能包含一个控制中枢（当前 (\\d+) 个）。$").exec(message); if (match) return errors.text(locale, "controlCount", { count: match[1]! }); }
  return message;
}
