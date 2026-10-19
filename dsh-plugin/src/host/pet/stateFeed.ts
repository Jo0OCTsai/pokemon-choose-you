/**
 * 任务状态事件流（host 侧 stateFeed，AD §3.1 pet/）：
 * - 快照组装：activeTask（含分类绑定宝可梦）+ badge（待处理建议/判定失败计数）；
 * - 本形态写后直推（写路径回调注册接口——tools/命令层写完调 notifyLocalWrite）；
 * - 跨形态 ≤2 秒侦听（A17 变更标记轮询：MAX(task_logs.id) + active 聚合 +
 *   chat_messages 计数合取单查询，变了 → 重读 active 任务推 task-state + badge）；
 * - 位置持久化 dsh:pet_pos；lang/sprites/pomodoro-config 下发组装
 *   （sprites builtin 清单 = helper 的六只内置 + cdnBase，单一来源 import）。
 */
import type { Conn } from "../storage/db";
import { getSetting, primaryAgent, setSetting } from "../domain/settings";
import { DEFAULT_BUILTIN, DEFAULT_CDN_BASE } from "../../../helper/src/sprites";
import type {
  ActiveTask,
  Badge,
  Lang,
  PomodoroConfigMsg,
  QuickTask,
  SpritesMsg,
  SysConfigMsg,
  TaskStateMsg,
} from "../../../helper/src/bridge/protocol";
import { BridgeClient } from "./bridge";

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

// ---- lang / sprites / pomodoro-config 下发组装 ----

export function resolveLang(conn: Conn): Lang {
  const raw = getSetting(conn, "language");
  return raw === "zh-Hant" || raw === "en" ? raw : "zh-Hans";
}

/** sprites 下发（builtin = helper 六只内置单源 + cdnBase；reducedMotion 双通道之一 U15） */
export function buildSpritesMsg(conn: Conn): Omit<SpritesMsg, "type"> {
  const reduced = getSetting(conn, "reduce_motion");
  return {
    builtin: DEFAULT_BUILTIN,
    cdnBase: DEFAULT_CDN_BASE,
    ...(reduced !== null ? { reducedMotion: reduced === "true" } : {}),
  };
}

/** pomodoro-config 下发（档位固定 [15,25,45,60]，breakMin/enabled/notify/chime 读共享设置；D2 本地计时） */
export function buildPomodoroConfig(conn: Conn): Omit<PomodoroConfigMsg, "type"> {
  const breakRaw = Number(getSetting(conn, "break_minutes"));
  return {
    durations: [15, 25, 45, 60],
    breakMin: Number.isInteger(breakRaw) && breakRaw > 0 ? breakRaw : 5,
    enabled: getSetting(conn, "pomodoro_enabled") === "true",
    notify: getSetting(conn, "pomodoro_notify") === "true",
    chime: getSetting(conn, "pomodoro_chime") === "true",
    lang: resolveLang(conn),
  };
}

/** 全局快捷键缺省组合（AD §4.3 sys-config.shortcuts 行——设置面覆写归后续配置键） */
export const DEFAULT_SHORTCUTS = { capture: "CmdOrCtrl+Shift+K", togglePet: "CmdOrCtrl+Shift+D" } as const;

/**
 * sys-config 组装（full-parity 2.7 补充接线 A2/A3）：tray（tooltip + 桌宠可见性回传）/
 * shortcuts（缺省组合）/ inputResponse（pet_input_response 共享键 + 非 macOS 恒关由
 * 装配层保证）/ tts（pet_voice）/ pet（mate = pet_mate 陪跑闸门 + agentConfigured =
 * 已配置 agent——ChatBox 菜单条件项）。分节能力位过滤在 sysChannel（缺位不发该节）。
 */
export function buildSysConfig(
  conn: Conn,
  opts: { petVisible: boolean } = { petVisible: false },
): Omit<SysConfigMsg, "type"> {
  return {
    tray: { tooltip: "就决定是你了", petVisible: opts.petVisible },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    inputResponse: { enabled: getSetting(conn, "pet_input_response") === "true" },
    tts: { enabled: getSetting(conn, "pet_voice") === "true" },
    pet: {
      mate: getSetting(conn, "pet_mate") === "true",
      agentConfigured: primaryAgent(conn) !== null,
    },
  };
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
