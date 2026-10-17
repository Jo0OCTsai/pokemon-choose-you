/**
 * 交互 TerminalAdapter 远端分支（FR-RD4；从 sshExecutor.ts 拆出——棘轮 max-lines，
 * 等量迁移；sshExecutor.ts 为统一再出口，消费面不变）。
 *
 * spawnTerminal 开真 PTY（模型留本机）+ 任务命令行注入；同任务重派 = 同 sessionId
 * writeTerminal 注入（同一执行上下文，不新开会话）；原会话已关闭 → 新开 + note 明示。
 * 会话标识经 sessionRef 落 agent_sessions。
 */
import type { Conn } from "../storage/db";
import type { TerminalAdapter } from "../dispatch/interactive";
import type { DeploymentEntity } from "./deployments";
import type { SshTerminalScope } from "./sshExecutor";

/** 远端 PTY 承载 shell（POSIX 保底；任务命令行注入后由 agent 会话自持） */
const REMOTE_TERMINAL_SHELL = "/bin/sh";

/** 向远端终端写入（通道故障与未知会话同归 false——驱动兜底新开） */
async function writeIntoTerminal(scope: SshTerminalScope, sessionId: string, data: string): Promise<boolean> {
  try {
    return await scope.writeTerminal(sessionId, data);
  } catch {
    return false;
  }
}

/** 新开远端 PTY 并写入首行（cwd 空串不传；写入失败即抛——不留半开会话给上层） */
async function spawnTerminalWithLine(
  scope: SshTerminalScope,
  payload: string,
  workdir: string | null | undefined,
  alias: string,
): Promise<string> {
  const term = await scope.spawnTerminal({
    command: REMOTE_TERMINAL_SHELL,
    ...(workdir !== null && workdir !== undefined && workdir.trim() !== "" ? { cwd: workdir.trim() } : {}),
  });
  if (!(await writeIntoTerminal(scope, term.sessionId, payload))) {
    throw new Error(`远端 PTY 会话写入失败（${term.sessionId}，部署 ${alias}）`);
  }
  return term.sessionId;
}

/**
 * 远端交互终端适配器：见文件头。会话标识经 sessionRef 落 agent_sessions；
 * target 为部署 target（remote_host 执行世界快照——同上下文重派查询键）。
 */
export function createRemoteTerminalAdapter(input: {
  conn: Conn;
  scopeFor: () => Promise<SshTerminalScope | null>;
  entity: DeploymentEntity;
  /** 部署 target（agent_sessions.remote_host 执行世界快照——同上下文重派查询键） */
  target: string;
}): TerminalAdapter {
  const { conn, scopeFor, entity, target } = input;
  return {
    async inject({ line, taskId, workdir }) {
      const scope = await scopeFor();
      if (scope === null || !scope.connected) {
        throw new Error(`远端连接不可用（部署 ${entity.alias}）——无法打开远端终端`);
      }
      const payload = `${line}\n`;
      const prev = conn
        .prepare(
          "SELECT session_id FROM agent_sessions " +
            "WHERE task_id=? AND kind='dispatch_interactive' AND session_id IS NOT NULL AND remote_host=? " +
            "ORDER BY id DESC LIMIT 1",
        )
        .get(taskId, target) as { session_id: string } | undefined;
      if (prev !== undefined && (await writeIntoTerminal(scope, prev.session_id, payload))) {
        return { terminal: prev.session_id, sessionRef: prev.session_id };
      }
      const note = prev !== undefined ? "原会话已关闭，已开新会话注入" : undefined;
      const sessionId = await spawnTerminalWithLine(scope, payload, workdir, entity.alias);
      return note === undefined
        ? { terminal: sessionId, sessionRef: sessionId }
        : { terminal: sessionId, sessionRef: sessionId, note };
    },
  };
}

/**
 * 降级「复制完整命令行」适配器（家族缺失 / 直连降级的交互兜底——既有语义）：不注入
 * 任何终端，note 携带完整命令行与目标，由客户端呈现复制面。
 */
export function createCopyLineTerminal(reason: string, target: string): TerminalAdapter {
  return {
    async inject({ line }) {
      return {
        terminal: "copy-line",
        note: `远端终端不可用（${reason}）——请复制完整命令行到 ${target} 手动执行：${line}`,
      };
    },
  };
}
