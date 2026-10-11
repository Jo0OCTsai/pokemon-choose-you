/**
 * 桥协议消息全集（specs/dsh-plugin AD §4.3）——stdio JSON 行，每行一个 JSON 对象。
 *
 * 信封字段 = `type`；下行（插件 → helper）五种：task-state / pomodoro-config / lang / sprites /
 * heartbeat；上行（helper → 插件）四种：cmd / focus-settle / hello / crash-diag。
 *
 * 校验立场（AD §4.3 + 任务纪律）：未知 type、未知 op、缺字段/类型不符 → **丢弃 + 计错**，
 * 绝不抛异常崩掉 helper——坏消息的观测点在 `stats.invalidMessages` 与 crash-diag 环形缓冲。
 *
 * 并行组对接注记（供组 1 host 侧消费）：
 * - `task-state.todayTasks?` 为 v1 可选扩展字段（QuickDexScreen 今日列表数据源；缺省时快捷屏
 *   呈现空态，协议向后兼容——宿主不发送不影响其余消息）。
 * - `sprites.reducedMotion?` 为 v1 可选扩展位（U15 减弱动效双通道之一，宿主下发覆盖系统偏好）。
 * - 拖动结束的位置上报：AD cmd 的 op 枚举未单列 move，就地把拖动归为交互事件
 *   （`op:"pet-interact"` + `pos`），宿主侧按 cmd.pos 持久化（§4.1.1 petMove 同义）。
 */

export type Lang = "zh-Hans" | "zh-Hant" | "en";
export const LANGS: readonly Lang[] = ["zh-Hans", "zh-Hant", "en"];

/** 进行中任务（activeTask；status 对齐任务六态，helper 只关心 active/paused） */
export interface ActiveTask {
  id: number | string;
  title: string;
  /** 分类绑定宝可梦 key（换装目标，如 "pikachu"） */
  categoryPokemon: string;
  status: string;
}

export interface Badge {
  pendingSuggestions: number;
  failures: number;
}

/** QuickDexScreen 今日列表条目（task-state 可选扩展字段） */
export interface QuickTask {
  id: number | string;
  title: string;
  categoryPokemon: string;
  status: string;
}

export interface TaskStateMsg {
  type: "task-state";
  activeTask: ActiveTask | null;
  badge: Badge;
  ts: number;
  todayTasks?: QuickTask[];
}

export interface PomodoroConfigMsg {
  type: "pomodoro-config";
  /** 专注时长档位（分钟） */
  durations: number[];
  breakMin: number;
  lang: Lang;
}

export interface LangMsg {
  type: "lang";
  lang: Lang;
}

/** 素材协议：builtin 清单 + cdnBase（AD §4.3；builtin ≥ 内置 6 只，宿主可附加条目） */
export interface SpriteEntry {
  key: string;
  /** PokeAPI 全国图鉴编号（CDN 候选链拼 URL 用） */
  id: number;
  name: { hans: string; hant: string; en: string };
}

export interface SpritesMsg {
  type: "sprites";
  builtin: SpriteEntry[];
  cdnBase: string;
  /** v1 扩展位：减弱动效（U15 双通道之二；缺省 = 跟随系统 prefers-reduced-motion） */
  reducedMotion?: boolean;
}

export interface HeartbeatMsg {
  type: "heartbeat";
  ts: number;
}

export type DownstreamMsg = TaskStateMsg | PomodoroConfigMsg | LangMsg | SpritesMsg | HeartbeatMsg;

export const DOWNSTREAM_TYPES = ["task-state", "pomodoro-config", "lang", "sprites", "heartbeat"] as const;

export const CMD_OPS = [
  "start",
  "pause",
  "resume",
  "done",
  "switch",
  "capture",
  "hide",
  "open-page",
  "pet-interact",
] as const;

export type CmdOp = (typeof CMD_OPS)[number];

export interface CmdMsg {
  type: "cmd";
  op: CmdOp;
  taskId?: number | string;
  /** capture（⚡发报文本）等载荷 */
  text?: string;
  /** 拖动后窗口位置（宿主侧持久化，§4.1.1 petMove） */
  pos?: { x: number; y: number };
}

/** D16 整分钟入账上报；宿主侧按 localSessionId 幂等（settings 键 dsh:focus_settled，PROTOCOL §7） */
export interface FocusSettleMsg {
  type: "focus-settle";
  taskId: number | string;
  localSessionId: string;
  elapsedMin: number;
}

/** 握手：版本 + 能力位 */
export interface HelloMsg {
  type: "hello";
  version: string;
  caps: string[];
}

/** 崩溃前环形缓冲最近诊断（AD §4.3） */
export interface CrashDiagMsg {
  type: "crash-diag";
  entries: { ts: number; tag: string; detail: string }[];
}

export type UpstreamMsg = CmdMsg | FocusSettleMsg | HelloMsg | CrashDiagMsg;

export const UPSTREAM_TYPES = ["cmd", "focus-settle", "hello", "crash-diag"] as const;

export interface ParsedLine {
  ok: boolean;
  /** ok 时为裸对象（尚未按方向校验）；!ok 时为丢弃原因（进计错与诊断） */
  value?: unknown;
  reason?: string;
}

/** 单行 → 裸对象（JSON 解析层；形状校验见 validateDownstream/validateUpstream） */
export function parseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, reason: "empty-line" };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "bad-json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "not-an-object" };
  }
  return { ok: true, value };
}

// 形状校验（每消息一个小解析器 + 方向分发）拆在 validators.ts——本文件只留类型与行编解码，
// 公共导入面不变：validateDownstream / validateUpstream 仍从本模块导出
export { validateDownstream, validateUpstream } from "./validators.ts";

/** 编码为行协议（JSON + 换行；发送侧统一出口） */
export function encodeLine(msg: UpstreamMsg | DownstreamMsg): string {
  return `${JSON.stringify(msg)}\n`;
}
