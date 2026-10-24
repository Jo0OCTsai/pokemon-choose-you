/**
 * 任务状态事件流（host 侧 stateFeed，AD §3.1 pet/）：
 * - 快照组装：activeTask（含分类绑定宝可梦）+ badge（待处理建议/判定失败计数）；
 * - 本形态写后直推（写路径回调注册接口——tools/命令层写完调 notifyLocalWrite）；
 * - 跨形态 ≤2 秒侦听（A17 变更标记轮询：MAX(task_logs.id) + active 聚合 +
 *   chat_messages 计数合取单查询，变了 → 重读 active 任务推 task-state + badge）；
 * - 位置持久化 dsh:pet_pos；配置下发组装在 stateFeedConfig.ts（本文件 re-export）。
 */
import type { Conn } from "../storage/db";
import { getSetting, setSetting } from "../domain/settings";
import type { ActiveTask, Badge, QuickTask, TaskStateMsg } from "../../../helper/src/bridge/protocol";
import { BridgeClient } from "./bridge";
import {
  buildPomodoroConfig,
  buildSpritesMsg,
  buildSysConfig,
  quotesFor,
  quotesKeysFor,
  resolveLang,
} from "./stateFeedConfig";

// ---- 配置下发组装（等量迁移至 stateFeedConfig.ts；re-export 保消费面 import 路径不变） ----
export {
  buildPomodoroConfig,
  buildSpritesMsg,
  buildSysConfig,
  DEFAULT_SHORTCUTS,
  quotesFor,
  quotesKeysFor,
  resolveLang,
} from "./stateFeedConfig";

/** 桌宠位置持久化键（AD §4.1.1 petMove / §5.2 dsh: 内部态） */
export const PET_POS_KEY = "dsh:pet_pos";

/** 跨形态侦听轮询间隔（毫秒，A17 ≤2 秒上界） */
export const CHANGE_POLL_INTERVAL_MS = 2_000;

/** 注入式定时器（pet 侧独立声明，不跨 feature 依赖 dispatch） */
export interface FeedTimerApi {
  every(ms: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
}

export const feedSystemTimer: FeedTimerApi = {
  every: (ms, fn) => setInterval(fn, ms),
  cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface PetPos {
  x: number;
  y: number;
}

export function getPetPos(conn: Conn): PetPos | null {
  const raw = getSetting(conn, PET_POS_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
}

export function setPetPos(conn: Conn, pos: PetPos): void {
  setSetting(conn, PET_POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
}

/** 清除记忆位（「重置位置」rpc——helper 收 reset-pos 事件回默认位，P1 D6） */
export function clearPetPos(conn: Conn): void {
  setSetting(conn, PET_POS_KEY, "");
}

interface TaskLikeRow {
  id: number;
  title: string;
  status: string;
  sprite: string | null;
}

/** active/paused 任务 → 桥协议任务条目（分类绑定精灵 key 随行——categories.sprite 列） */
function toActiveTask(row: TaskLikeRow): ActiveTask {
  return { id: row.id, title: row.title, categoryPokemon: row.sprite ?? "pikachu", status: row.status };
}

/**
 * badge 组装：pendingSuggestions = 待处理建议（review_status='pending' 且
 * ai_status IN ('todo','update')——对齐主应用 stores/tasks.ts getter 口径）；
 * failures = 判定失败组（ai_status='error'）。
 */
export function snapshotBadge(conn: Conn): Badge {
  const pending = conn
    .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE review_status='pending' AND ai_status IN ('todo','update')")
    .get() as { n: number };
  const failures = conn.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE ai_status='error'").get() as {
    n: number;
  };
  return { pendingSuggestions: pending.n, failures: failures.n };
}

/** 任务状态快照（activeTask + badge + 今日列表 v1 扩展） */
export function snapshotTaskState(conn: Conn): {
  activeTask: ActiveTask | null;
  badge: Badge;
  todayTasks: QuickTask[];
} {
  const active = conn
    .prepare(
      "SELECT t.id, t.title, t.status, c.sprite FROM tasks t LEFT JOIN categories c ON c.id = t.category_id " +
        "WHERE t.status IN ('active','paused') ORDER BY CASE t.status WHEN 'active' THEN 0 ELSE 1 END, t.started_at DESC LIMIT 1",
    )
    .get() as TaskLikeRow | undefined;
  // open 待捕列表（QuickDexScreen 数据源；决策2 对齐桌面 listTasks("open") 语义与排序：
  // 全部未完成，active > paused > scheduled > inbox，再按优先级与到期——前 12 只）
  const today = conn
    .prepare(
      "SELECT t.id, t.title, t.status, c.sprite FROM tasks t LEFT JOIN categories c ON c.id = t.category_id " +
        "WHERE t.status IN ('inbox','scheduled','active','paused') " +
        "ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END, " +
        "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, " +
        "t.due_at IS NULL, t.due_at LIMIT 12",
    )
    .all() as unknown as TaskLikeRow[];
  return {
    activeTask: active === undefined ? null : toActiveTask(active),
    badge: snapshotBadge(conn),
    todayTasks: today.map(toActiveTask),
  };
}

/**
 * A17 变更标记（合取单查询，亚毫秒级）：MAX(task_logs.id) + active/paused 聚合 +
 * chat_messages 计数——三元组变化即「库被任一形态写过」，触发重读与推送。
 */
export function changeMark(conn: Conn): string {
  const row = conn
    .prepare(
      "SELECT (SELECT COALESCE(MAX(id), 0) FROM task_logs) AS maxLog, " +
        "(SELECT COUNT(*) FROM tasks WHERE status IN ('active','paused')) AS activeN, " +
        "(SELECT COUNT(*) FROM chat_messages) AS msgN",
    )
    .get() as { maxLog: number; activeN: number; msgN: number };
  return `${row.maxLog}:${row.activeN}:${row.msgN}`;
}

// ---- 事件流本体 ----

export interface StateFeedOptions {
  pollMs?: number;
  timer?: FeedTimerApi;
  /** 推送落点（supervisor 当前 bridge；helper 不在时推送丢弃） */
  bridgeProvider(): BridgeClient | null;
  /** 桌宠可见性（sys-config.tray.petVisible 投影——supervisor 显隐状态；缺省 false） */
  petVisible?(): boolean;
}

export class StateFeed {
  private lastMark: string | null = null;
  private lastQuotesKeys: string = "";
  private timer: FeedTimerApi;
  private pollHandle: unknown = null;
  private readonly conn: Conn;
  private readonly opts: StateFeedOptions;

  constructor(conn: Conn, opts: StateFeedOptions) {
    this.conn = conn;
    this.opts = opts;
    this.timer = opts.timer ?? feedSystemTimer;
  }

  /** 推送当前任务状态快照（写后直推 / 轮询命中 / 重启恢复共用出口；caught 变体随行可选） */
  pushTaskState(caught?: TaskStateMsg["caught"]): void {
    const bridge = this.opts.bridgeProvider();
    if (bridge === null) {
      return;
    }
    const snap = snapshotTaskState(this.conn);
    bridge.sendTaskState(snap.activeTask, snap.badge, Date.now(), snap.todayTasks, caught);
    this.maybePushQuotes(bridge, snap.activeTask?.categoryPokemon ?? "");
  }

  /** 自定义台词惰性下发（P1 D2：相关集变化才发；空集只重置基线不发消息） */
  private maybePushQuotes(bridge: BridgeClient, activePokemon: string): void {
    const keys = quotesKeysFor(this.conn, getSetting(this.conn, "main_pokemon") ?? "", activePokemon);
    const joined = keys.join(",");
    if (joined === this.lastQuotesKeys) return;
    this.lastQuotesKeys = joined;
    if (keys.length > 0) bridge.sendQuotes(quotesFor(this.conn, keys));
  }

  /**
   * 捕获演出变体直推（full-parity A1：完成动作路径郑重判定结果随 task-state 下发——
   * helper CatchShow 消费；无变体（非郑重时刻）不推，保持写后直推的 plain 快照）。
   */
  announceCaught(caught: NonNullable<TaskStateMsg["caught"]>): void {
    this.pushTaskState(caught);
  }

  /** sys-config 下发（分节能力位过滤在 sysChannel；tray.petVisible 取当前可见性） */
  pushSysConfig(): void {
    const bridge = this.opts.bridgeProvider();
    if (bridge === null) {
      return;
    }
    bridge.sys.sendSysConfig(buildSysConfig(this.conn, { petVisible: this.opts.petVisible?.() ?? false }));
  }

  /** 下发配置全集（helper 拉起/重启后恢复：lang + sprites + pomodoro-config + sys-config + task-state） */
  republishAll(): void {
    const bridge = this.opts.bridgeProvider();
    if (bridge === null) {
      return;
    }
    this.lastQuotesKeys = ""; // 重发基线复位（重启后首轮必发相关集）
    bridge.sendLang(resolveLang(this.conn));
    bridge.sendSprites(buildSpritesMsg(this.conn));
    bridge.sendPomodoroConfig(buildPomodoroConfig(this.conn));
    this.pushSysConfig();
    this.pushTaskState();
  }

  /** 本形态写后直推（tools/命令层写路径回调；FR-P2 ≤2 秒内——直推即时） */
  notifyLocalWrite(): void {
    this.pushTaskState();
  }

  /** 写后双推（P1 D1）：task-state 快照 + sys-config——设置变更免 helper 重启即生效 */
  notifyWrites(): void {
    this.notifyLocalWrite();
    this.pushSysConfig();
  }

  /** 跨形态轮询一轮：变更标记变化 → 重读推送（A17） */
  pollOnce(): boolean {
    const mark = changeMark(this.conn);
    if (mark === this.lastMark) {
      return false;
    }
    this.lastMark = mark;
    this.pushTaskState();
    return true;
  }

  start(): void {
    if (this.pollHandle !== null) {
      return;
    }
    this.lastMark = changeMark(this.conn);
    this.pollHandle = this.timer.every(this.opts.pollMs ?? CHANGE_POLL_INTERVAL_MS, () => {
      this.pollOnce();
    });
  }

  stop(): void {
    if (this.pollHandle !== null) {
      this.timer.cancel(this.pollHandle);
      this.pollHandle = null;
    }
  }
}
