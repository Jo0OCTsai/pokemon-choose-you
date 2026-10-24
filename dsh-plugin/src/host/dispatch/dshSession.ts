/**
 * dsh headless 的会话 id 通道（dispatch / judge 两条 spawn 链共用）：dsh 的 `--session-id`
 * 是 adopt 语义（未知 id 报错、要求 cwd 与原会话一致），不能像 claude/pi 预生成——会话 id 只能
 * 先捕获后使用；而 dsh headless 默认模式 stdout 仅最终回答文本，id 只出现在 `--json` 事件流
 * （dsh-headless json-stream 在订阅开始前写入 `{"type":"session","sessionId","cwd"}` 事件行）。
 * 零 dsh 依赖：纯字符串/JSON 处理。
 */
import { tryParseObject } from "./executor";

/** dsh kind 自动补 `--json`（用户 args 已配则不重复）；其他 kind 空串 */
export function dshJsonFlag(kind: string | null, args: string): string {
  return kind === "dsh" && !args.split(/\s+/).includes("--json") ? "--json" : "";
}

/**
 * 事件流里的会话 id（按行扫首个 type=session 事件）。NDJSON 整段不是单个 JSON 对象，
 * 对 executor.parseHeadlessEnvelope（claude 单对象信封）恒空——两解析互不干扰。非该形态 → undefined。
 */
export function parseDshSessionId(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    const parsed = tryParseObject(line);
    if (
      parsed !== null &&
      parsed.type === "session" &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId !== ""
    ) {
      return parsed.sessionId;
    }
  }
  return undefined;
}
