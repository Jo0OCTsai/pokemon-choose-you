/**
 * host 命令 · 诊断/桌宠/通用/专注域（AD §4.1.1）：diagnosticsSnapshot /
 * supportReport / logQuery / petShow / petHide / petStatus / petMove / dbStatus / pomoTryFive。
 * logQuery 返回文本经三层脱敏（NFR-2 ⑥，与支持报告同管线——原始明文不出 host 边界）。
 */
import type { CommandTable } from "./context";
import { dbStatus } from "../storage/migrate";
import { diagnosticsSnapshot } from "../health/snapshot";
import { buildSupportReport } from "../health/supportReport";
import { logQuery } from "../health/logRing";
import { setPetPos } from "../pet/stateFeed";
import type { LogQueryParams } from "../health/logRing";
import { logDirFrom } from "../storage/paths";

/** 诊断/桌宠/通用/专注命令表（9 条） */
export function miscCommands(): CommandTable {
  return {
    diagnosticsSnapshot: (_p, deps) => ({
      links: diagnosticsSnapshot(deps.conn, deps.health, { feishuConfigured: deps.feishuConfigured }),
    }),
    supportReport: (_p, deps) => ({
      text: buildSupportReport(deps.conn, deps.health, deps.logs, {
        pluginVersion: deps.meta.pluginVersion,
        dshVersion: deps.meta.dshVersion,
      }),
    }),
    // 磁盘侧合并主应用共享日志目录（桌面写 <appHome>/logs/*.log——单读内存环恒近空）
    logQuery: (p, deps) => logQuery(deps.conn, deps.logs, p as LogQueryParams, logDirFrom()),
    // ready = hello 握手在超时窗内完成；false 不代表失败（迟到仍会触发 onBridgeReady），
    // 但必须如实带回——否则 helper 启动死循环时 UI 静默假成功
    petShow: async (_p, deps) => {
      const hello = await deps.pet.show();
      return { ok: true, ready: hello !== null };
    },
    petHide: (_p, deps) => {
      deps.pet.hide();
      return { ok: true };
    },
    // 桌宠显隐状态（背包桌宠分区状态行回显源：running = helper 子进程存活——hide 即停进程）
    petStatus: (_p, deps) => ({ running: deps.pet.running }),
    petMove: (p, deps) => {
      setPetPos(deps.conn, (p as { pos: { x: number; y: number } }).pos);
      deps.onWrites();
      return { ok: true };
    },
    dbStatus: (_p, deps) => dbStatus(deps.conn),
    // 番茄「先试 5 分钟」为 helper 本地计时（AD §4.1.1：结束不自动接休息）；计时态在
    // helper 侧（D2），host 命令面返回 ok——桥下行消息随 dsh 适配层装配接线。
    pomoTryFive: (_p, deps) => {
      deps.log("info", "pet: pomoTryFive", "helper 本地 5 分钟计时（桥下行随 dsh 适配层接线）");
      return { ok: true };
    },
  };
}
