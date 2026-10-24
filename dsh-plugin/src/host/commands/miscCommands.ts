/**
 * host 命令 · 诊断/桌宠/通用/专注域（AD §4.1.1 + full-parity 增量）：diagnosticsSnapshot
 * （links + helperCaps/shortcutRegistered/sshFamily 三字段——签名不变向后兼容）/
 * supportReport / logQuery / petShow / petHide / petStatus / petMove / dbStatus /
 * pomoTryFive / macAuthorizationStatus / macAuthPaneOpen。
 * logQuery 返回文本经三层脱敏（NFR-2 ⑥，与支持报告同管线——原始明文不出 host 边界）。
 */
import type { CommandFn, CommandTable, HostCommandDeps } from "./context";
import { dbStatus } from "../storage/migrate";
import { diagnosticsSnapshot } from "../health/snapshot";
import { buildSupportReport } from "../health/supportReport";
import { logQuery } from "../health/logRing";
import { clearPetPos, setPetPos } from "../pet/stateFeed";
import { electronSetupProgress } from "../pet/electronGet";
import type { LogQueryParams } from "../health/logRing";
import { logDirFrom } from "../storage/paths";
import { paramError, PkyError } from "../storage/errors";
import { SYS_CAPS } from "../../../helper/src/bridge/protocol";
import { macAuthorizationStatus as macAuthorizationStatusDomain } from "../pet/macAuth";

/** hello.caps 8 能力位 → 矩阵（缺位 false；helper 未运行 = null——HelperBanner 数据源） */
function helperCapsOf(deps: HostCommandDeps): Record<string, boolean> | null {
  const hello = deps.petBridge?.()?.hello ?? null;
  if (hello === null) {
    return null;
  }
  const caps: Record<string, boolean> = {};
  for (const cap of SYS_CAPS) {
    caps[cap] = hello.caps.includes(cap);
  }
  return caps;
}

/** 桥面在位校验（macAuth 面共用；缺席 → HELPER_CAPABILITY_MISSING） */
function requireBridge(deps: HostCommandDeps) {
  const bridge = deps.petBridge?.() ?? null;
  if (bridge === null || bridge.hello === null) {
    throw new PkyError(
      "HELPER_CAPABILITY_MISSING",
      "helper 未运行或握手未完成，系统授权面不可用",
      "确认 helper 已运行（托盘图标在位）且为最新版本",
    );
  }
  return bridge;
}

/** 诊断/通用段（diagnosticsSnapshot 三字段投影 + 支持报告 + 日志 + 库状态） */
function diagCommandSet(): CommandTable {
  return {
    diagnosticsSnapshot: (_p, deps) => ({
      links: diagnosticsSnapshot(deps.conn, deps.health, { feishuConfigured: deps.feishuConfigured }),
      // full-parity 三字段（AD §4.1 / A37——签名不变，旧客户端忽略未知字段）
      helperCaps: helperCapsOf(deps),
      shortcutRegistered: deps.shortcutRegistered?.() ?? null,
      sshFamily: deps.sshFamily?.() ?? null,
      helperVersion: deps.petBridge?.()?.hello?.version ?? null,
    }),
    supportReport: (_p, deps) => ({
      text: buildSupportReport(deps.conn, deps.health, deps.logs, {
        pluginVersion: deps.meta.pluginVersion,
        dshVersion: deps.meta.dshVersion,
      }),
    }),
    // 磁盘侧合并主应用共享日志目录（桌面写 <appHome>/logs/*.log——单读内存环恒近空）
    logQuery: (p, deps) => logQuery(deps.conn, deps.logs, p as LogQueryParams, logDirFrom()),
    dbStatus: (_p, deps) => dbStatus(deps.conn),
  };
}

/** 桌宠/专注/AX 授权段（生命周期 + sys 能力命令面） */
function petCommandSet(): CommandTable {
  return {
    // ready = hello 握手在超时窗内完成；false 不代表失败（迟到仍会触发 onBridgeReady），
    // 但必须如实带回——否则 helper 启动死循环时 UI 静默假成功
    petShow: async (_p, deps) => {
      const hello = await deps.pet.show();
      deps.onPetLifecycle?.(); // tray.petVisible 回推（A3——托盘 label 同步）
      return { ok: true, ready: hello !== null };
    },
    petHide: (_p, deps) => {
      deps.pet.hide();
      deps.onPetLifecycle?.();
      return { ok: true };
    },
    // 桌宠显隐状态（背包桌宠分区状态行回显源：running = helper 子进程存活——hide 即停进程）
    petStatus: (_p, deps) => ({ running: deps.pet.running }),
    // 番茄「先试 5 分钟」为 helper 本地计时（AD §4.1.1：结束不自动接休息）；计时态在
    // helper 侧（D2），host 命令面返回 ok——桥下行消息随 dsh 适配层装配接线。
    pomoTryFive: (_p, deps) => {
      deps.log("info", "pet: pomoTryFive", "helper 本地 5 分钟计时（桥下行随 dsh 适配层接线）");
      return { ok: true };
    },
    // AX 授权状态查询（FR-A9：seq 两段语义往返 + helper 二进制路径回显）
    macAuthorizationStatus: macAuthorizationStatusCommand,
    // 直达系统设置辅助功能面板（桥 mac-auth-query 承载直达动作——契约收敛纪要 §1；
    // 客户端联调对齐命令，AD §4.1 未列名）
    macAuthPaneOpen: async (_p, deps) => {
      const bridge = requireBridge(deps);
      try {
        const { granted } = await bridge.sys.queryMacAuth();
        return { ok: true, granted };
      } catch (error) {
        throw error instanceof PkyError
          ? error
          : new PkyError(
              "HELPER_CAPABILITY_MISSING",
              `辅助功能面板直达失败：${String(error instanceof Error ? error.message : error).slice(0, 160)}`,
            );
      }
    },
  };
}

/** 桌宠位置与首启进度段（P1 D6/D7——拆小函数控棘轮 max-lines-per-function） */
function petPositionCommandSet(): CommandTable {
  return {
    petMove: (p, deps) => {
      setPetPos(deps.conn, (p as { pos: { x: number; y: number } }).pos);
      deps.onWrites();
      return { ok: true };
    },
    // 重置桌宠位置：清宿主记忆位 + 通知 helper 回默认位（桥缺席只清位，下次启动生效）
    petResetPos: (_p, deps) => {
      clearPetPos(deps.conn);
      const bridge = deps.petBridge?.() ?? null;
      const delivered = bridge === null ? false : bridge.sendPetEvent({ kind: "reset-pos" });
      return { ok: true, delivered };
    },
    // Electron 首启进度（设置面「显示桌宠」行——下载/校验/解压阶段化呈现）
    petSetupProgress: () => electronSetupProgress(),
  };
}

/** macAuthorizationStatus 命令实现（独立成 const——控表函数行数棘轮） */
const macAuthorizationStatusCommand: CommandFn = async (p, deps) => {
  const kind = (p as { kind?: unknown }).kind;
  if (kind !== "accessibility") {
    throw paramError(`未知的授权查询类别：${String(kind)}`, "kind 须为 accessibility");
  }
  const result = await macAuthorizationStatusDomain({
    bridge: () => deps.petBridge?.() ?? null,
    helperPath: () => deps.helperPath?.() ?? "",
  });
  if (!result.ok) {
    throw new PkyError(result.error.code, result.error.message, result.error.hint);
  }
  return result.data;
};

/** 诊断/桌宠/通用/专注命令表（11 条） */
export function miscCommands(): CommandTable {
  return { ...diagCommandSet(), ...petCommandSet(), ...petPositionCommandSet() };
}
