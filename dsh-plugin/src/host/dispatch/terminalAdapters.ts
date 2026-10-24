/**
 * TerminalAdapter 器件（接口契约在 interactive.ts）：handoff 诚实化终端（debt ③——
 * 无第三方可驱动终端面板时命令行回传客户端复制）与 fake 终端（测试注入记录件）。
 * 平台真终端实现件在 dsh/externalTerminal.ts（desktop 载体）；远端真 PTY/copy-line
 * 在 remote/sshExecutor*。
 */
import type { TerminalAdapter } from "./interactive";

/** handoff 原因码（客户端呈现分流：web-carrier = 宿主在远程机器无法弹窗 → web 提示） */
export type HandoffReasonCode = "web-carrier" | "no-terminal" | "spawn-failed";

/**
 * 本机 handoff 终端（debt ③ 诚实化）：dsh 宿主无第三方可驱动的终端面板（浏览器终端
 * Session 私有 / ctx.terminals 为 agent 工具注册表——平台事实见 AD §4.8），本机交互
 * 派发不再假装注入——note 携带完整命令行由客户端呈现复制面；**无 sessionRef**
 * （agent_sessions.session_id 如实落 NULL，回放按「无句柄」不渲染按钮）。与 remote 的
 * createCopyLineTerminal 同语义（terminal 标识 "copy-line" 同值——命令层 handedOff
 * 判据单源）；本变体归业务核心。
 */
export function createHandoffTerminal(reason: string, code?: HandoffReasonCode): TerminalAdapter {
  return {
    async inject({ line }) {
      return {
        terminal: "copy-line",
        reason: code,
        note: `${reason}——请复制完整命令行到终端手动执行：${line}`,
      };
    },
  };
}

/** fake 终端适配器（测试）：记录注入行，可编程结果 */
export interface FakeTerminal extends TerminalAdapter {
  readonly injections: Array<{
    line: string;
    taskId: number;
    workdir: string | null;
    agentId: string;
    terminalPreference: string | null;
  }>;
  /** 下一次 inject 抛错（驱动唤起失败路径）；传 null 清除 */
  failNext(message: string | null): void;
}

export function createFakeTerminal(): FakeTerminal {
  const injections: FakeTerminal["injections"] = [];
  const state = { failMessage: null as string | null };
  return {
    injections,
    failNext(message) {
      state.failMessage = message;
    },
    async inject(input) {
      injections.push({
        line: input.line,
        taskId: input.taskId,
        workdir: input.workdir,
        agentId: input.agent.id,
        terminalPreference: input.terminalPreference ?? null,
      });
      if (state.failMessage !== null) {
        const message = state.failMessage;
        state.failMessage = null;
        throw new Error(message);
      }
      return { terminal: "fake-terminal", sessionRef: `pane-${input.taskId}` };
    },
  };
}
