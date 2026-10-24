/**
 * host 命令 · 派发与设置域（AD §4.1.1 派发/设置行 + full-parity 增量）：dispatchInteractive /
 * dispatchHeadless / dispatchClose / dispatchReset / dispatchCancel / dispatchRedo +
 * configRead / configWrite / routeUpsert / larkAuth / larkTest / larkLoginStart +
 * sessionsPage 域外（readCommands）/ sessionReplay（FR-C2 回放路由）。
 */
import { dispatchHeadless } from "../dispatch/headless";
import { dispatchInteractive, dispatchReport, dispatchReset } from "../dispatch/interactive";
import { dispatchTransition } from "../domain/dispatch";
import { routeUpsert as routeUpsertDomain, type DispatchRoute } from "../dispatch/routes";
import { readSettings, writeSettings } from "../domain/settings";
import { paramError, PkyError } from "../storage/errors";
import { authLoginCommandLine } from "../radio/lark";
import { listAllChats } from "../radio/fetcher";
import type { CommandFn, CommandTable } from "./context";
import { injectLineGuarded } from "./context";
import { replayLauncherOf } from "./replayRig";
import { sessionReplay as sessionReplayDomain } from "../dispatch/sessions";

/**
 * 派发视图（客户端 DispatchView 投影；startedAt/endedAt 取任务行时间线锚点）。
 * outcome 为 handoff（terminal="copy-line"——宿主无第三方终端面板）时带出命令行与
 * note 供客户端复制执行（debt ③ 诚实化回传）；真实注入不回显命令行。
 */
function dispatchView(
  conn: Parameters<CommandTable["dbStatus"]>[1]["conn"],
  taskId: number,
  state: string | null,
  outcome?: { terminal: string; note: string | null; line: string; reason?: string },
) {
  const row = conn.prepare("SELECT dispatch_state, started_at, completed_at FROM tasks WHERE id=?").get(taskId) as
    { dispatch_state: string | null; started_at: string | null; completed_at: string | null } | undefined;
  const base = {
    taskId,
    state: (row?.dispatch_state ?? state) as string | null,
    agentId: null,
    startedAt: row?.started_at ?? null,
    endedAt: row?.completed_at ?? null,
  };
  if (outcome === undefined || outcome.terminal !== "copy-line") {
    return base;
  }
  return {
    ...base,
    note: outcome.note,
    line: outcome.line,
    handedOff: true as const,
    ...(outcome.reason === undefined ? {} : { handoffReason: outcome.reason }),
  };
}

/**
 * 交互派发命令实现（debt ③ 接线）：本机 = deps.terminal（dsh 宿主注入 handoff
 * 终端——命令行回传）；远端 = remoteInteractive 件（terminalFor 真 PTY/copy-line
 * + 就绪复核；缺席回落 terminal）。outcome 经 dispatchView 带 handoff 载荷。
 */
async function runDispatchInteractive(p: unknown, deps: Parameters<CommandFn>[1]) {
  const args = p as { taskId: number; routeOverride?: string };
  const out = await dispatchInteractive(
    deps.conn,
    {
      terminal: deps.terminal,
      sshCheck: deps.dispatchDeps.sshCheck,
      ...(deps.remoteInteractive ?? {}),
    },
    args.taskId,
    { routeOverride: args.routeOverride },
  );
  deps.onWrites();
  return dispatchView(deps.conn, args.taskId, out.state, out);
}

/** 派发段（6 条） */
function dispatchCommandSet(): CommandTable {
  return {
    dispatchInteractive: (p, deps) => runDispatchInteractive(p, deps),
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
    // PROTOCOL 码映射（DEPLOYMENT_NOT_READY / DISPATCH_LAUNCH_FAILED / SSH_AUTH_REQUIRED）；
    // 无句柄行走 picker 兜底（agent 自带历史选择器），不再拦「不可回放」
    sessionReplay: async (p, deps) => {
      const rowId = (p as { rowId?: unknown }).rowId;
      if (!Number.isInteger(rowId) || (rowId as number) <= 0) {
        throw paramError(`非法会话行 id：${String(rowId)}`);
      }
      const rig = replayLauncherOf(deps);
      const outcome = sessionReplayDomain(deps.conn, rowId as number, rig.launcher);
      await rig.settle(); // 唤起在 domain（同步）触发的异步注入——失败在此浮出为信封
      if (outcome.kind === "error") {
        throw outcome.hint === undefined
          ? new PkyError(outcome.tag, outcome.message)
          : new PkyError(outcome.tag, outcome.message, outcome.hint);
      }
      // 本机 handoff（无终端注入面）：命令行回传客户端复制执行——零静默（不再落入
      // fake 终端静默成功的假象），审计留痕
      const handoff = rig.localHandoff();
      if (handoff !== null) {
        deps.log("info", "dsh:replay", `本机回放 handoff（命令行回传）：${handoff.line}`);
        return { routed: { world: outcome.world, line: handoff.line, workdir: handoff.workdir, opened: false } };
      }
      return { routed: { world: outcome.world } };
    },
  };
}
