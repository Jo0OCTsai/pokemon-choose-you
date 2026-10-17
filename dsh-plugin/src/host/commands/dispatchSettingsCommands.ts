/**
 * host 命令 · 派发与设置域（AD §4.1.1 派发/设置行 + full-parity 增量）：dispatchInteractive /
 * dispatchHeadless / dispatchClose / dispatchReset / dispatchCancel / dispatchRedo +
 * configRead / configWrite / routeUpsert / larkAuth / larkTest / larkLoginStart +
 * sessionsPage 域外（readCommands）/ sessionReplay（FR-C2 回放路由）。
 */
import { dispatchHeadless } from "../dispatch/headless";
import { dispatchInteractive, dispatchReport, dispatchReset } from "../dispatch/interactive";
import { dispatchTransition } from "../domain/dispatch";
import { routeUpsert as routeUpsertDomain, type DispatchRoute, listRoutes } from "../dispatch/routes";
import { readSettings, writeSettings } from "../domain/settings";
import { paramError, PkyError } from "../storage/errors";
import { authLoginCommandLine } from "../radio/lark";
import { listAllChats } from "../radio/fetcher";
import type { CommandTable, HostCommandDeps } from "./context";
import { injectLineGuarded } from "./context";
import {
  kindForCommand,
  sessionFlags,
  sessionReplay as sessionReplayDomain,
  type LocalReplayLaunch,
  type ReplayLauncher,
} from "../dispatch/sessions";
import { createRemoteTerminalAdapter } from "../remote/sshExecutor";
import { deploymentByAlias } from "../remote/deployments";
import { posixQuote } from "../dispatch/cmdline";

/** 派发视图（客户端 DispatchView 投影；startedAt/endedAt 取任务行时间线锚点） */
function dispatchView(conn: Parameters<CommandTable["dbStatus"]>[1]["conn"], taskId: number, state: string | null) {
  const row = conn.prepare("SELECT dispatch_state, started_at, completed_at FROM tasks WHERE id=?").get(taskId) as
    { dispatch_state: string | null; started_at: string | null; completed_at: string | null } | undefined;
  return {
    taskId,
    state: (row?.dispatch_state ?? state) as string | null,
    agentId: null,
    startedAt: row?.started_at ?? null,
    endedAt: row?.completed_at ?? null,
  };
}

/** 派发段（6 条） */
function dispatchCommandSet(): CommandTable {
  return {
    dispatchInteractive: async (p, deps) => {
      const args = p as { taskId: number; routeOverride?: string };
      const out = await dispatchInteractive(
        deps.conn,
        { terminal: deps.terminal, sshCheck: deps.dispatchDeps.sshCheck },
        args.taskId,
        { routeOverride: args.routeOverride },
      );
      deps.onWrites();
      return dispatchView(deps.conn, args.taskId, out.state);
    },
    dispatchHeadless: async (p, deps) => {
      const args = p as { taskId: number; routeOverride?: string };
      const out = await dispatchHeadless(deps.conn, deps.dispatchDeps, args.taskId, {
        routeOverride: args.routeOverride,
      });
      deps.onWrites();
      return dispatchView(deps.conn, args.taskId, out.state);
    },
    dispatchClose: (p, deps) => {
      const args = p as { taskId: number; result: "done" | "failed"; note?: string };
      const out = dispatchReport(deps.conn, args.taskId, args.result, args.note);
      deps.onWrites();
      return dispatchView(deps.conn, args.taskId, out.state);
    },
    dispatchReset: (p, deps) => {
      const id = (p as { taskId: number }).taskId;
      dispatchReset(deps.conn, id);
      deps.onWrites();
      return dispatchView(deps.conn, id, null);
    },
    dispatchCancel: (p, deps) => {
      const id = (p as { taskId: number }).taskId;
      dispatchTransition(deps.conn, id, null, "手动取消排队", "dsh:dispatch");
      deps.onWrites();
      return dispatchView(deps.conn, id, null);
    },
    dispatchRedo: async (p, deps) => {
      const args = p as { taskId: number; routeOverride?: string };
      const out = await dispatchHeadless(deps.conn, deps.dispatchDeps, args.taskId, {
        routeOverride: args.routeOverride,
      });
      deps.onWrites();
      return dispatchView(deps.conn, args.taskId, out.state);
    },
  };
}

/** 设置段（config/route/lark，6 条） */
function settingsCommandSet(): CommandTable {
  return {
    configRead: (p, deps) => ({ keyValues: readSettings(deps.conn, (p as { keys?: string[] }).keys) }),
    configWrite: (p, deps) => {
      writeSettings(deps.conn, (p as { keyValues: Record<string, string> }).keyValues);
      deps.onWrites();
      return { ok: true };
    },
    routeUpsert: (p, deps) => {
      // 客户端视图模型含 tag（键）；domain 路由值不含键（键 = 项目标签名）
      const route = (p as { route: { tag: string } & DispatchRoute }).route;
      const { tag, ...value } = route;
      routeUpsertDomain(deps.conn, tag, value);
      deps.onWrites();
      return { route };
    },
    larkAuth: async (_p, deps) => {
      const command = await authLoginCommandLine(deps.lark, deps.larkBin);
      deps.log("info", "radio: larkAuth", `请在终端执行：${command}`);
      return { launched: true, command };
    },
    larkTest: async (_p, deps) => {
      const identity = await deps.lark.userIdentity();
      const chats = await listAllChats(deps.lark);
      return { identity: identity.name, chatCount: chats.length };
    },
    // lark 一键登录（FR-C3）：dsh 终端会话注入 lark-cli（已初始化 → auth login；
    // 未初始化 → config init 接续）；终端注入失败 → DISPATCH_LAUNCH_FAILED 复用
    larkLoginStart: async (_p, deps) => {
      const command = await authLoginCommandLine(deps.lark, deps.larkBin);
      await injectLineGuarded(deps, command);
      deps.log("info", "radio: larkLoginStart", `已向终端面板注入登录命令`);
      return { ok: true, note: command };
    },
  };
}

/** 派发与设置域命令表（12 条） */
export function dispatchSettingsCommands(): CommandTable {
  return {
    ...dispatchCommandSet(),
    ...settingsCommandSet(),
    // 行内回放（FR-C2）：按账本行执行世界快照路由（快照压过当前配置）；错误 tag →
    // PROTOCOL 码映射（DEPLOYMENT_NOT_READY / DISPATCH_LAUNCH_FAILED / SSH_AUTH_REQUIRED）
    sessionReplay: async (p, deps) => {
      const rowId = (p as { rowId?: unknown }).rowId;
      if (!Number.isInteger(rowId) || (rowId as number) <= 0) {
        throw paramError(`非法会话行 id：${String(rowId)}`);
      }
      const rig = replayLauncherOf(deps);
      const outcome = sessionReplayDomain(deps.conn, rowId as number, rig.launcher);
      await rig.settle(); // 唤起在 domain（同步）触发的异步注入——失败在此浮出为信封
      if (outcome.kind === "not-replayable") {
        throw paramError("该会话无回放句柄（session_id 与 tmux 会话名皆无）");
      }
      if (outcome.kind === "error") {
        throw outcome.hint === undefined
          ? new PkyError(outcome.tag, outcome.message)
          : new PkyError(outcome.tag, outcome.message, outcome.hint);
      }
      return { routed: { world: outcome.world } };
    },
  };
}

// ---- 回放唤起装配（sessions.ts ReplayLauncher 注入件——本文件属命令装配层） ----

/** 回放命令行组装：tmux attach 优先 → agent 会话续接旗标 → agent 自带选择器兜底 */
export function replayCommandLine(l: LocalReplayLaunch): string {
  if (l.branch === "tmux" && l.tmuxSession !== null) {
    return `tmux attach-session -t ${posixQuote(l.tmuxSession)}`;
  }
  const kind = kindForCommand(l.agentCommand);
  if (l.branch === "resume" && l.sessionId !== null && (kind === "claude-code" || kind === "pi")) {
    return `${posixQuote(l.agentCommand)} ${sessionFlags(kind, l.sessionId).flags}`;
  }
  return kind === "claude-code" ? `${posixQuote(l.agentCommand)} --resume` : posixQuote(l.agentCommand);
}

/** target（user@host[:port]）→ 部署实体（先按 alias 直配；再扫路由 target 反解 ref） */
function deploymentForTarget(deps: HostCommandDeps, target: string) {
  const t = target.trim();
  const direct = deploymentByAlias(deps.conn, t);
  if (direct !== null) {
    return direct;
  }
  for (const route of Object.values(listRoutes(deps.conn))) {
    if (route.deployment?.target === t) {
      return deploymentByAlias(deps.conn, route.deployment.ref);
    }
  }
  return null;
}

/**
 * 回放唤起装配 rig：launcher 保持 domain 要求的同步签名（launch 触发即返回），
 * 实际异步注入在 settle() 收口——失败（DISPATCH_LAUNCH_FAILED / SSH_AUTH_REQUIRED）
 * 由命令层 await settle 浮出为错误信封（不逃逸为未处理 rejection）。
 */
function replayLauncherOf(deps: HostCommandDeps): { launcher: ReplayLauncher; settle(): Promise<void> } {
  let inflight: Promise<void> = Promise.resolve();
  return {
    launcher: {
      resolveDeployment(target) {
        const entity = deploymentForTarget(deps, target);
        return entity === null ? null : { alias: entity.alias, ready: entity.status === "ready" };
      },
      launchLocal(l) {
        inflight = injectLineGuarded(deps, replayCommandLine(l));
      },
      launchRemote(l) {
        inflight = launchRemoteReplay(deps, l);
      },
    },
    settle: () => inflight,
  };
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
    sessionId: l.sessionId,
    tmuxSession: l.tmuxSession,
    workdir: l.workdir,
  };
}

/** 终端适配器合成 agent 配置（回放注入占位——适配器只消费 line/workdir） */
function syntheticAgent(id: string, command: string, workdir: string) {
  return { id, name: id, command, args: "", historyArgs: "", workdir, timeoutSecs: 60, enabled: true };
}
