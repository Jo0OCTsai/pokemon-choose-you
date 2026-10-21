/**
 * dsh 类 agent 的交互前端 = dst（dsh-tui 启动器；`dst` 与 `dsh-tui` 同指 bin/dsh-tui.js）：
 * dsh CLI 自身无交互/续接旗标（`dsh [--profile] <name> [app-args]`，会话旗标属 profile 应用层，
 * 此前注入的 `--session-id` 对 dsh 本体并不成立），交互派发与回放一律换 dst：
 * `dst -- <提示词>` 以字面提示词启动；`dst --resume <id>` 恢复指定会话；无会话 id 裸 `dst`
 * （TUI 自带会话管理器兜底 = picker 分支）。工作目录由调用方的 cd 前缀承载（本机外部终端
 * 织入 / 回放行 cd 前缀 / 远端载荷 cd 段），不走 dst 的位置参数。无头派发不经本件（仍是
 * dsh headless profile + `--json` 捕获会话）。
 */
import { posixQuote } from "./cmdline";
import { kindForCommand } from "./sessions";

export const DST_COMMAND = "dst";

/** agent 命令是否 dsh 家族（dsh / dst / dsh-tui / deepseek*） */
export function isDshKind(command: string): boolean {
  return kindForCommand(command) === "dsh";
}

/** 交互派发首行：字面提示词经 `--` 交 dst */
export function dstLaunchLine(prompt: string): string {
  return `${DST_COMMAND} -- ${posixQuote(prompt)}`;
}

/** 回放行：有会话 id → `--resume <id>`；无 → 裸 dst（会话管理器） */
export function dstReplayLine(sessionId: string | null): string {
  return sessionId === null ? DST_COMMAND : `${DST_COMMAND} --resume ${posixQuote(sessionId)}`;
}
