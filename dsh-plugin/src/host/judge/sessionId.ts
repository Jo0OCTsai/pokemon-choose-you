/**
 * 判定会话 id 的三源与失败回链（judge.rs pregen_session_id / inject_pregen_args 同构）：
 * - claude / pi：`--session-id` 是 create-if-absent，执行前预生成即可保证失败路径（超时被杀、
 *   非零退出）账本也有回链；
 * - dsh：`--session-id` 是 adopt 语义（未知 id 报错）不预生成，改由 `--json` 事件流捕获
 *   （dispatch/dshSession.ts）；
 * - 其他 kind 无续接语义。
 * 失败回链：执行方在抛错前把已知会话 id 挂到错误对象上，编排层落账本失败行时回读——
 * 失败会话同样可回放，不再硬编码 null。
 */
import { randomUUID } from "node:crypto";
import { dshJsonFlag } from "../dispatch/dshSession";

export function withSessionId<E>(error: E, sessionId: string | null): E {
  if (sessionId !== null && typeof error === "object" && error !== null) {
    (error as { sessionId?: string }).sessionId = sessionId;
  }
  return error;
}

export function sessionIdOfError(error: unknown): string | null {
  const id = (error as { sessionId?: unknown } | null | undefined)?.sessionId;
  return typeof id === "string" && id !== "" ? id : null;
}

/** 预生成会话 id（仅 claude-code / pi） */
export function pregenSessionId(kind: string | null): string | null {
  return kind === "claude-code" || kind === "pi" ? randomUUID() : null;
}

/** 会话旗标追加到 argv 末尾（inject_pregen_args 同构；dsh 补 `--json` 捕获通道） */
export function sessionArgv(argv: string[], kind: string | null, pregen: string | null, args: string): string[] {
  const extra = pregen === null ? [] : ["--session-id", pregen];
  const json = dshJsonFlag(kind, args);
  return json === "" ? [...argv, ...extra] : [...argv, ...extra, json];
}
