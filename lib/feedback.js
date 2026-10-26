/**
 * Turn a send result ({ ok, kind, status }) into user-facing copy. Only the
 * kind and HTTP status are used, so the key or a response body can never leak
 * into the UI, a toast, or the toolbar tooltip.
 */
import { REQUEST_TIMEOUT_MS } from "./protocol.js";

function httpReason(status) {
  if (status === 401 || status === 403) return "密钥或地址不对";
  if (status === 404) return "地址不存在";
  if (status === 429) return "请求过多,稍后再试";
  if (status >= 500) return "Monica 服务端错误";
  return "请求失败";
}

/**
 * @returns {{ tone: "ok"|"err"|"warn", text: string, badge: string, action?: "authorize"|"configure" }}
 */
export function describeResult(result) {
  if (result?.ok) return { tone: "ok", text: "已保存", badge: "OK" };
  const status = Number(result?.status) || 0;
  switch (result?.kind) {
    case "http":
      return { tone: "err", text: `${httpReason(status)}(HTTP ${status})`, badge: String(status) };
    case "timeout":
      return { tone: "err", text: `无法连接:请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`, badge: "ERR" };
    case "network":
      return { tone: "err", text: "无法连接:请检查网络或 webhook 地址", badge: "ERR" };
    case "permission":
      return { tone: "warn", text: "未授权访问该域名,点此授权", badge: "PERM", action: "authorize" };
    case "missing":
      return { tone: "warn", text: "目标 webhook 已不存在,请在设置里检查", badge: "CFG", action: "configure" };
    case "config":
      return { tone: "warn", text: "webhook 配置不完整,请在设置里补全", badge: "CFG", action: "configure" };
    case "empty":
      return { tone: "err", text: "内容为空", badge: "ERR" };
    case "unreadable":
      return { tone: "err", text: "无法读取这个页面的地址", badge: "ERR" };
    default:
      return { tone: "err", text: "发送失败", badge: "ERR" };
  }
}

/** One-line summary naming the target, for toasts and the toolbar tooltip. */
export function headline(result, name) {
  if (result?.ok) return `已保存到「${name}」`;
  return `保存到「${name}」失败:${describeResult(result).text}`;
}
