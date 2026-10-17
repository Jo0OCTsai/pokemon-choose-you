/**
 * host 命令装配（AD §4.1.1：49 client→host RPC + 1 条 host→客户端 pageOpen 推送，
 * 共 50 条目——49 命令含放生撤销 taskDeleteUndo 的显式撤销面；实体读域 5 条为
 * Phase B 契约缺口补齐 + 任务编辑/跟进/历史 4 条 + 备份/导出域 3 条 + 复盘向导
 * 标签体检 3 条 + agent 工具面 3 条（连接探针 / pk 技能检查与安装）+ 桌宠显隐状态 1 条，
 * 共 69 条目）。
 * 分域实现表见 commands/ 目录；本文件装配统一调用面（ok/fail 信封）+ pageOpen 推送出口 +
 * conversation chip 数据源接口（dsh 适配层后续接线）。
 */
import { envelope, type CommandTable, type HostCommandCaller, type HostCommandDeps } from "./commands/context";
import { taskCommands } from "./commands/taskCommands";
import { radioCommands } from "./commands/radioCommands";
import { dispatchSettingsCommands } from "./commands/dispatchSettingsCommands";
import { backpackCommands } from "./commands/backpackCommands";
import { agentToolsCommands } from "./commands/agentToolsCommands";
import { miscCommands } from "./commands/miscCommands";
import { readCommands } from "./commands/readCommands";
import { backupCommands } from "./commands/backupCommands";

export type { HostCommandDeps, HostCommandCaller } from "./commands/context";

/** 命令名全集（装配完整性断言单源；AD §4.1.1 表逐行 + taskDeleteUndo 撤销面 + petStatus 显隐状态） */
export const HOST_COMMAND_NAMES = [
  "taskStart",
  "taskPause",
  "taskResume",
  "taskComplete",
  "taskCancel",
  "taskDelete",
  "taskDeleteUndo",
  "taskReschedule",
  "taskUpdate",
  "taskNoteAdd",
  "taskNoteDelete",
  "taskHistory",
  "captureTodo",
  "reviewAccept",
  "reviewApplyUpdate",
  "reviewDismiss",
  "reviewRestore",
  "reviewBatch",
  "retryJudge",
  "forceCapture",
  "forceDismiss",
  "pollNow",
  "dispatchInteractive",
  "dispatchHeadless",
  "dispatchClose",
  "dispatchReset",
  "dispatchCancel",
  "dispatchRedo",
  "configRead",
  "configWrite",
  "routeUpsert",
  "larkAuth",
  "larkTest",
  "categoryUpsert",
  "categoryDelete",
  "tagUpsert",
  "tagDelete",
  "dimensionUpdate",
  "filterList",
  "filterUpsert",
  // 复盘向导「标签体检」（本地预筛报告 + 合并/迁维度治理动作）
  "tagCheckup",
  "tagMerge",
  "tagMoveDimension",
  "agentUpsert",
  "agentDelete",
  "agentTest",
  "pkSkillCheck",
  "pkSkillInstall",
  "promptList",
  "promptGet",
  "promptOverride",
  "promptReset",
  "diagnosticsSnapshot",
  "supportReport",
  "logQuery",
  "petShow",
  "petHide",
  "petStatus",
  "petMove",
  "dbStatus",
  "pomoTryFive",
  // 实体读域（Phase B 契约缺口补齐——面板首载聚合 + 按需懒载，全部只读）
  "panelSnapshot",
  "taskDetail",
  "taskSearch",
  "todayTasks",
  "categoriesList",
  // 备份/导出域（手动快照 + 滚动保留 + 三种导出；恢复/导入不在命令面）
  "backupRun",
  "backupList",
  "exportRun",
] as const;

/** 全量命令实现表（分域合并） */
export function hostCommandTable(): CommandTable {
  return {
    ...taskCommands(),
    ...radioCommands(),
    ...dispatchSettingsCommands(),
    ...backpackCommands(),
    ...agentToolsCommands(),
    ...miscCommands(),
    ...readCommands(),
    ...backupCommands(),
  };
}

/**
 * 装配统一调用面：命令名 → ok/fail 信封。未知命令 = INVALID_ARGUMENT 信封；
 * 非命令实现异常原样上抛（编程缺陷不静默）。
 */
export function createHostCommands(deps: HostCommandDeps): HostCommandCaller {
  const table = hostCommandTable();
  const known = new Set(HOST_COMMAND_NAMES as readonly string[]);
  return (command: string, params?: unknown) => {
    const fn = table[command];
    if (fn === undefined || !known.has(command)) {
      return Promise.resolve({
        ok: false as const,
        error: { code: "INVALID_ARGUMENT" as const, message: `未知 host 命令 ${command}` },
      });
    }
    return envelope(fn, params, deps);
  };
}

// ---- host→客户端推送 + conversation chip 数据源（dsh 适配层接线面） ----

/** pageOpen 推送出口（§4.1.1：桌宠双击 open-page 桥 cmd → 客户端导航通道） */
export interface PageOpenChannel {
  (section?: "panel" | "settings"): void;
}

/** conversation chip 数据源接口（会话内自然语言建任务的入口卡——AD §3.2 QuickCapture
 * 的 host 侧数据面；dsh 适配层把它投影到 chip 组件） */
export interface ChipDataSource {
  /** 待确认建议数（badge） */
  pendingCount(): number;
  /** 最近一条待确认建议标题（无则 null） */
  latestPendingTitle(): string | null;
}

/** chip 数据源实现（共享库直读） */
export function createChipDataSource(deps: Pick<HostCommandDeps, "conn">): ChipDataSource {
  const pendingSql =
    "SELECT COUNT(*) AS n FROM chat_messages WHERE review_status='pending' AND ai_status IN ('todo','update')";
  return {
    pendingCount(): number {
      return Number((deps.conn.prepare(pendingSql).get() as { n: number }).n);
    },
    latestPendingTitle(): string | null {
      const row = deps.conn
        .prepare(
          "SELECT suggested_title FROM chat_messages WHERE review_status='pending' " +
            "AND ai_status IN ('todo','update') ORDER BY id DESC LIMIT 1",
        )
        .get() as { suggested_title: string | null } | undefined;
      return row?.suggested_title ?? null;
    },
  };
}
