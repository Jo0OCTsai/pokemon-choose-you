/**
 * 回放唤起装配 rig（从 dispatchSettingsCommands.ts 拆出——棘轮 max-lines，等量迁移；
 * sessions.ts ReplayLauncher 的命令装配层注入件）：本机双形态（终端注入面在场 →
 * 真实注入；缺席 = 真实 dsh 宿主形态 → handoff 命令行回传客户端复制执行——AD §4.8
 * 「复制命令行」降级口径，零静默）+ 远端部署 PTY 注入（SSH_AUTH_REQUIRED 折算）。
 */
import { PkyError } from "../storage/errors";
import type { HostCommandDeps } from "./context";
import { injectLineGuarded } from "./context";
import { kindForCommand, type LocalReplayLaunch, type ReplayLauncher } from "../dispatch/sessions";
import { createRemoteTerminalAdapter } from "../remote/sshExecutor";
import { deploymentByAlias } from "../remote/deployments";
import { posixQuote } from "../dispatch/cmdline";

// ---- 回放唤起装配（sessions.ts ReplayLauncher 注入件——本文件属命令装配层） ----

/**
 * 历史参数注入会话 id（desktop adapt_history_args 同构）：已有 --session-id/--resume/
 * resume 旗标时紧跟其后插入（用户自配参数在后不被挤丢）；无旗标按 kind 追加
 * （claude-code → --resume、pi → --session-id、dsh → --session-id（headless adopt 既有
 * 会话——「带既有 session 重开任务」，cwd 需与原会话一致））；其余 kind 无续接语义不强插
 * （等价 agent 自带选择器兜底）。
 */
function injectSessionArg(args: string[], sessionId: string, kind: string | null): void {
  const flagIdx = args.findIndex((a) => a === "--session-id" || a === "--resume" || a === "resume");
  if (flagIdx >= 0) {
    args.splice(flagIdx + 1, 0, sessionId);
    return;
  }
  if (kind === "claude-code") {
    args.push("--resume", sessionId);
  } else if (kind === "pi" || kind === "dsh") {
    args.push("--session-id", sessionId);
  }
}

/**
 * 回放命令行组装（desktop history_invocation 同构基准）：tmux attach 优先；其余 =
 * agent 配置命令 + 历史参数（resume 分支注入会话 id——`claude --resume <id>` 直接
 * 回放转录）；工作目录非空时 cd 前缀（desktop local_history_line 同款——历史会话
 * 与派发同目录）。
 */
export function replayCommandLine(l: LocalReplayLaunch): string {
  if (l.branch === "tmux" && l.tmuxSession !== null) {
    return `tmux attach-session -t ${posixQuote(l.tmuxSession)}`;
  }
  const args = l.historyArgs.split(/\s+/).filter((t) => t !== "");
  if (l.branch === "resume" && l.sessionId !== null) {
    injectSessionArg(args, l.sessionId, kindForCommand(l.agentCommand));
  }
  const line = [posixQuote(l.agentCommand), ...args.map(posixQuote)].join(" ");
  const dir = l.workdir.trim();
  return dir === "" ? line : `cd ${posixQuote(dir)} && ${line}`;
}

/** target → 部署实体（快照自包含：单源化后 remote_host = 部署 alias，直配即得） */
function deploymentForTarget(deps: HostCommandDeps, target: string) {
  return deploymentByAlias(deps.conn, target.trim());
}

/**
 * 回放唤起装配 rig：launcher 保持 domain 要求的同步签名（launch 触发即返回），
 * 实际异步注入在 settle() 收口——失败（DISPATCH_LAUNCH_FAILED / SSH_AUTH_REQUIRED）
 * 由命令层 await settle 浮出为错误信封（不逃逸为未处理 rejection）。
 *
 * 本机分支双形态：终端注入面在场（terminalLine 显式注入）→ 真实注入；缺席（真实
 * dsh 宿主形态——宿主无第三方可驱动的终端面板）→ handoff：不注入（fake 终端的
 * 静默成功即「回放按钮没反应」的根因，不再触碰），命令行记录后由命令层回传客户端
 * 复制执行（AD §4.8「复制命令行」降级口径）。
 */
export function replayLauncherOf(deps: HostCommandDeps): {
  launcher: ReplayLauncher;
  settle(): Promise<void>;
  /** 本机 handoff 载荷（null = 非 handoff——真实注入或非本机路由） */
  localHandoff(): { line: string; workdir: string } | null;
} {
  let inflight: Promise<void> = Promise.resolve();
  let handoff: { line: string; workdir: string } | null = null;
  return {
    launcher: {
      resolveDeployment(target) {
        const entity = deploymentForTarget(deps, target);
        return entity === null ? null : { alias: entity.alias, ready: entity.status === "ready" };
      },
      launchLocal(l) {
        if (deps.terminalLine === undefined) {
          handoff = { line: replayCommandLine(l), workdir: l.workdir };
          return;
        }
        inflight = injectLineGuarded(deps, replayCommandLine(l));
      },
      launchRemote(l) {
        inflight = launchRemoteReplay(deps, l);
      },
      launchAlias(l) {
        const line = sshAliasReplayLine(l);
        if (deps.terminalLine === undefined) {
          handoff = { line, workdir: "" };
          return;
        }
        inflight = injectLineGuarded(deps, line);
      },
    },
    settle: () => inflight,
    localHandoff: () => handoff,
  };
}

/**
 * ssh 别名回放命令行（desktop history_invocation 远端分支同构）：`ssh -tt -o
 * ConnectTimeout=10 [-i key] [-p port] -- <target> exec "$SHELL" -lc '<cd dir && agent
 * --resume id>'`——不设 BatchMode（密钥未就绪时可在终端输密码）；远端行整体引用防
 * -lc 只吞首词。desktop 载体经外部终端弹真窗口、web 载体回传复制。
 */
export function sshAliasReplayLine(l: Parameters<ReplayLauncher["launchAlias"]>[0]): string {
  const argv = ["ssh", "-tt", "-o", "ConnectTimeout=10"];
  const key = l.keyPath.trim();
  if (key !== "") {
    argv.push("-i", key);
  }
  if (l.port !== 0 && l.port !== 22) {
    argv.push("-p", String(l.port));
  }
  argv.push("--", l.target, "exec", `"$SHELL"`, "-l", "-c");
  // 载荷必须**自携单引号**到达远端：ssh 重组命令只做空格拼接（不保留引号），而本行
  // 先过本地 sh -c（剥一层引号）——故对「已含引号的载荷」再做一层 posixQuote，
  // 使 ssh argv 中的载荷形如 'cd … && claude --resume …'（远端外层 shell 再剥一层，
  // 内层 zsh -c 拿到完整命令串——desktop 直连 spawn 无此层，引号天然保留）
  const remoteLine = `'${replayCommandLine(replayLaunchOf(l))}'`;
  return [...argv.map(posixQuote), posixQuote(remoteLine)].join(" ");
}

/** 远端回放唤起（部署 PTY 写入；失败折算 SSH_AUTH_REQUIRED——免密/连接失败口径） */
async function launchRemoteReplay(
  deps: HostCommandDeps,
  l: Parameters<ReplayLauncher["launchRemote"]>[0],
): Promise<void> {
  const platform = deps.remote;
  if (platform === undefined) {
    throw new PkyError(
      "SSH_AUTH_REQUIRED",
      "远程部署平台面未装配（不在 dsh 宿主内运行），无法唤起远端回放",
      "可在本机打开该会话所属 agent 的历史选择器回放",
    );
  }
  const entity = deploymentByAlias(deps.conn, l.deploymentAlias) ?? deploymentForTarget(deps, l.target);
  if (entity === null) {
    throw new PkyError("SSH_AUTH_REQUIRED", `部署「${l.deploymentAlias}」实体缺失，无法唤起远端回放`);
  }
  const adapter = createRemoteTerminalAdapter({
    conn: deps.conn,
    scopeFor: () => platform.scopeFor(entity),
    entity,
    target: l.target,
  });
  try {
    await adapter.inject({
      line: replayCommandLine(replayLaunchOf(l)),
      agent: syntheticAgent(l.agentId, l.agentCommand, l.workdir),
      taskId: 0,
      workdir: l.workdir === "" ? null : l.workdir,
    });
  } catch (error) {
    throw new PkyError(
      "SSH_AUTH_REQUIRED",
      `远端回放唤起失败：${String(error instanceof Error ? error.message : error).slice(0, 160)}`,
      "确认部署免密可达（deploymentRecheck 复核）后重试",
    );
  }
}

/** 远端回放载荷 → 本机回放载荷形状（replayCommandLine 组装共用） */
function replayLaunchOf(l: Parameters<ReplayLauncher["launchRemote"]>[0]): LocalReplayLaunch {
  return {
    branch: l.branch,
    agentId: l.agentId,
    agentCommand: l.agentCommand,
    historyArgs: l.historyArgs,
    sessionId: l.sessionId,
    tmuxSession: l.tmuxSession,
    workdir: l.workdir,
  };
}

/** 终端适配器合成 agent 配置（回放注入占位——适配器只消费 line/workdir） */
function syntheticAgent(id: string, command: string, workdir: string) {
  return { id, name: id, command, args: "", historyArgs: "", workdir, timeoutSecs: 60, enabled: true };
}
