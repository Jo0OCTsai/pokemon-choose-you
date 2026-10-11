/**
 * host 命令 · 派发与设置域（AD §4.1.1 派发/设置行）：dispatchInteractive /
 * dispatchHeadless / dispatchClose / dispatchReset / dispatchCancel / dispatchRedo +
 * configRead / configWrite / routeUpsert / larkAuth / larkTest。
 */
import { dispatchHeadless } from "../dispatch/headless";
import { dispatchInteractive, dispatchReport, dispatchReset } from "../dispatch/interactive";
import { dispatchTransition } from "../domain/dispatch";
import { routeUpsert as routeUpsertDomain, type DispatchRoute } from "../dispatch/routes";
import { readSettings, writeSettings } from "../domain/settings";
import { authLoginCommandLine } from "../radio/lark";
import { listAllChats } from "../radio/fetcher";
import type { CommandTable } from "./context";

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

/** 设置段（config/route/lark，5 条） */
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
  };
}

/** 派发与设置域命令表（11 条） */
export function dispatchSettingsCommands(): CommandTable {
  return { ...dispatchCommandSet(), ...settingsCommandSet() };
}
