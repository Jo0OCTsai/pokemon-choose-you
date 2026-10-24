/**
 * 回放唤起装配 rig（从 dispatchSettingsCommands.ts 拆出——棘轮 max-lines，等量迁移；
 * sessions.ts ReplayLauncher 的命令装配层注入件）：本机双形态（终端注入面在场 →
 * 真实注入；缺席 → handoff 命令行回传客户端复制执行——AD §4.8「复制命令行」降级口径，
 * 零静默）+ 远端部署双形态（终端注入面在场 → 本机 GUI 终端弹 ssh 别名窗口，desktop
 * 远端回放同构；缺席 → 部署 PTY 注入，SSH_AUTH_REQUIRED 折算）。
 */
import { PkyError } from "../storage/errors";
import type { HostCommandDeps } from "./context";
import { injectLineGuarded } from "./context";
import { kindForCommand, type LocalReplayLaunch, type ReplayLauncher } from "../dispatch/sessions";
import { createRemoteTerminalAdapter } from "../remote/sshExecutor";
import { deploymentByAlias } from "../remote/deployments";
import { cdSegment, posixQuote, sshAliasLine } from "../dispatch/cmdline";
import { dstReplayLine, isDshKind } from "../dispatch/dstLaunch";

// ---- 回放唤起装配（sessions.ts ReplayLauncher 注入件——本文件属命令装配层） ----

/** 选择器/续接旗标族（picker 兜底判重用——在场则不重复补 --resume） */
const PICKER_FLAGS: ReadonlySet<string> = new Set([
  "--resume",
  "-r",
  "resume",
  "--resume-picker",
  "--session",
  "--session-id",
]);

/**
 * 历史参数注入会话 id（desktop adapt_history_args 同构）：已有 --session-id/--resume/
 * resume 旗标时紧跟其后插入（用户自配参数在后不被挤丢）；无旗标按 kind 追加
 * （claude-code → --resume、pi → --session-id）；dsh 类不经本函数（回放整行换 dst，见
 * dstLaunch.ts）；其余 kind 无续接语义不强插（等价 agent 自带选择器兜底）。
 */
function injectSessionArg(args: string[], sessionId: string, kind: string | null): void {
  const flagIdx = args.findIndex((a) => a === "--session-id" || a === "--resume" || a === "resume");
  if (flagIdx >= 0) {
    args.splice(flagIdx + 1, 0, sessionId);
    return;
  }
  if (kind === "claude-code") {
    args.push("--resume", sessionId);
  } else if (kind === "pi") {
    args.push("--session-id", sessionId);
  }
}

/** 非 dsh 类 agent 的回放行：agent 配置命令 + 历史参数（resume 分支注入会话 id——`claude --resume <id>` 直接回放转录；
 * picker 分支 claude/pi 无旗标时补不带值的 --resume——agent 自带会话选择器，裸命令是开新会话） */
function agentReplayLine(l: LocalReplayLaunch): string {
  const args = l.historyArgs.split(/\s+/).filter((t) => t !== "");
  const kind = kindForCommand(l.agentCommand);
  if (l.branch === "resume" && l.sessionId !== null) {
    injectSessionArg(args, l.sessionId, kind);
  } else if (
    l.branch === "picker" &&
    (kind === "claude-code" || kind === "pi") &&
    !args.some((a) => PICKER_FLAGS.has(a))
  ) {
    args.push("--resume");
  }
  return [posixQuote(l.agentCommand), ...args.map(posixQuote)].join(" ");
}

/**
 * 回放命令行组装（desktop history_invocation 同构基准）：tmux attach 优先；dsh 类 agent
 * 整行换 dst（resume → `dst --resume <id>`；picker → 裸 dst 会话管理器）；其余 = agent 配置
 * 命令 + 历史参数；工作目录非空时 cd 前缀（desktop local_history_line 同款——历史会话与
 * 派发同目录；~ 前缀裸写）。
 */
export function replayCommandLine(l: LocalReplayLaunch): string {
  if (l.branch === "tmux" && l.tmuxSession !== null) {
    return `tmux attach-session -t ${posixQuote(l.tmuxSession)}`;
  }
  const line = isDshKind(l.agentCommand)
    ? dstReplayLine(l.branch === "resume" ? l.sessionId : null)
    : agentReplayLine(l);
  const dir = l.workdir.trim();
  // cd 段经 cdSegment：前导 ~ 裸写给 shell 展开（整体引用会让 `cd '~/x'` 找字面目录名必失败——
  // 判定行 workdir 多为 ~/.choose-you/workspace 形态）
  return dir === "" ? line : `${cdSegment(dir)} && ${line}`;
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
        // 本机 GUI 终端在场 → 弹 ssh 别名窗口（desktop 远端回放同构，用户面前可见）；
        // 缺席 → 既有部署 PTY 注入链（dsh-ssh 裸 PTY，无 UI 面）
        inflight =
          deps.terminalLine === undefined
            ? launchRemoteReplay(deps, l)
            : injectLineGuarded(deps, sshAliasLine(l.target, replayCommandLine(replayLaunchOf(l))));
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
 * ssh 别名回放命令行（desktop history_invocation 远端分支同构）：sshAliasLine 包装
 * `<cd dir && agent --resume id>` 载荷（快照三元组 port/key 随行）。本机 GUI 终端弹真窗口、
 * 无终端回传复制。
 */
export function sshAliasReplayLine(l: Parameters<ReplayLauncher["launchAlias"]>[0]): string {
  return sshAliasLine(l.target, replayCommandLine(replayLaunchOf(l)), { keyPath: l.keyPath, port: l.port });
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
