/**
 * 专注入账（D16 / PROTOCOL.md §7）：番茄为各形态本地状态；任务离开「进行中」时
 * 已专注部分按整分钟（向下取整）入账 `tasks.focus_seconds`。幂等账本 = settings 键
 * `dsh:focus_settled`（JSON 数组滚动保留最近 100 个 localSessionId，含则跳过——A20）。
 */
import { txImmediate, type Conn } from "../storage/db";
import { paramError } from "../storage/errors";
import { getSetting, setSetting } from "./settings";

/** 幂等账本的 settings 键（host 半边内部态，随库备份/导出） */
export const FOCUS_SETTLED_KEY = "dsh:focus_settled";

/** 账本滚动保留上限（A20：最近 100 个 localSessionId） */
export const FOCUS_LEDGER_LIMIT = 100;

export interface SettleFocusInput {
  taskId: number;
  /** 本形态番茄会话的幂等键（helper 桥 focus-settle 携带） */
  localSessionId: string;
  /** 本会话专注分钟数（整分钟，调用方向下取整后传入） */
  elapsedMin: number;
}

export interface SettleFocusResult {
  /** true = 本次入账；false = 账本命中（重复 settle），跳过 */
  settled: boolean;
  focusSeconds: number;
}

/**
 * 整分钟入账（幂等）：单条 BEGIN IMMEDIATE 内「读账本 → 未命中则累加 focus_seconds
 * 并滚动追加账本」，跨形态并发 settle 同一 localSessionId 只入账一次。
 * elapsedMin 为负拒绝（参数错）；localSessionId 空串拒绝。
 */
export function settleFocus(conn: Conn, input: SettleFocusInput): SettleFocusResult {
  const { taskId, localSessionId, elapsedMin } = input;
  if (localSessionId.trim() === "") {
    throw paramError("localSessionId 不能为空");
  }
  if (!Number.isInteger(elapsedMin) || elapsedMin < 0) {
    throw paramError("elapsedMin 必须为非负整数（整分钟）");
  }
  return txImmediate(conn, () => {
    const ledger = parseLedger(getSetting(conn, FOCUS_SETTLED_KEY));
    if (ledger.includes(localSessionId)) {
      const row = conn.prepare("SELECT focus_seconds FROM tasks WHERE id=?").get(taskId) as
        { focus_seconds: number } | undefined;
      return { settled: false, focusSeconds: row === undefined ? 0 : Number(row.focus_seconds) };
    }
    const result = conn
      .prepare("UPDATE tasks SET focus_seconds = focus_seconds + ? WHERE id=?")
      .run(elapsedMin * 60, taskId);
    if (Number(result.changes) === 0) {
      throw paramError(`任务 ${taskId} 不存在`);
    }
    // 滚动保留最近 100 个（新条目在尾部，超出裁掉最旧的）
    ledger.push(localSessionId);
    setSetting(conn, FOCUS_SETTLED_KEY, JSON.stringify(ledger.slice(-FOCUS_LEDGER_LIMIT)));
    const row = conn.prepare("SELECT focus_seconds FROM tasks WHERE id=?").get(taskId) as {
      focus_seconds: number;
    };
    return { settled: true, focusSeconds: Number(row.focus_seconds) };
  });
}

/** 账本读取（坏数据按空账本处理——不因一条脏行挡住入账） */
export function parseLedger(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
