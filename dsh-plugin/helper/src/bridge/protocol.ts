/**
 * 桥协议消息全集（specs/dsh-plugin AD §4.3 + specs/dsh-plugin-full-parity AD §4.3）——
 * stdio JSON 行，每行一个 JSON 对象。
 *
 * 信封字段 = `type`；基础下行（插件 → helper）七种：task-state / pomodoro-config / lang /
 * sprites / heartbeat / quotes（自定义台词惰性集）/ pet-event（提醒敲门·位置复位）+
 * 系统能力扩展下行八种（sys-config / sys-notify / tts-speak /
 * dialog-request / dialog-cancel / open-path / mac-auth-query / chat-reply，见
 * `sys-protocol.ts`）；基础上行（helper → 插件）四种：cmd / focus-settle / hello /
 * crash-diag + 系统能力扩展上行九种（tray-action / shortcut-fired / notify-clicked /
 * dialog-ack / dialog-result / mac-auth-ack / mac-auth-result / input-activity /
 * sys-unsupported）。`hello.caps` 8 系统能力位 + hello 发送门控 + seq 两段语义 +
 * 双向兼容语义（NFR-14）的声明面亦在 `sys-protocol.ts`（本模块 `export *` 并入单源）。
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

// 系统能力扩展（full-parity AD §4.3）单源：类型/枚举声明在 sys-protocol.ts，本模块
// 并入公共导入面（host 侧 pet/ 直接 import protocol.ts 即得全集，不另开导入路径）
import {
  type ChatReplyMsg,
  type DialogAckMsg,
  type DialogCancelMsg,
  type DialogResultMsg,
  type DialogRequestMsg,
  type InputActivityMsg,
  type MacAuthAckMsg,
  type MacAuthQueryMsg,
  type MacAuthResultMsg,
  type NotifyClickedMsg,
  type OpenPathMsg,
  type ShortcutFiredMsg,
  type SysConfigMsg,
  type SysNotifyMsg,
  type SysUnsupportedMsg,
  type TrayActionMsg,
  type TtsSpeakMsg,
} from "./sys-protocol.ts";
export * from "./sys-protocol.ts";

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
  /** 捕获演出变体（full-parity 2.7 补充接线：完成路径郑重判定结果随行；缺省 = plain 变体） */
  caught?: CaughtVariant;
}

/** 郑重时刻变体数据（solemn 判定投影：里程碑阈值 / 连胜天数 / 收工清空——helper CatchShow 消费） */
export interface CaughtVariant {
  milestone?: number;
  streakDays?: number;
  /** 今日待办清空（桌面 allDone = 无进行中且 open 任务为 0——收尾台词最高优先级 + 送客陪跑） */
  allDone?: boolean;
}

export interface PomodoroConfigMsg {
  type: "pomodoro-config";
  /** 专注时长档位（分钟） */
  durations: number[];
  breakMin: number;
  /** 番茄功能开关（共享设置 pomodoro_enabled；false 时 PomoPill 不显示——主应用 parity） */
  enabled: boolean;
  /** 到期系统通知（共享设置 pomodoro_notify——helper 本地 sys-notify 面发声） */
  notify?: boolean;
  /** 长番茄提示音（共享设置 pomodoro_chime；仅 ≥45min：中点 1 声 / 剩 5 分钟 2 声） */
  chime?: boolean;
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

/** 每宝可梦自定义台词惰性下发（P1 D2：相关集 = 主宝可梦 + 进行中任务精灵，变化才发） */
export interface QuotesMsg {
  type: "quotes";
  map: Record<string, string[]>;
}

/** 桌宠事件下行（P1 D3/D6：提醒敲门/催促、位置复位） */
export interface PetEventMsg {
  type: "pet-event";
  kind: "reminder" | "reset-pos";
  /** reminder：目标任务（动作条完成/推迟回写用） */
  taskId?: number | string;
  /** reminder：任务标题（气泡文案插值） */
  title?: string;
  /** reminder：紧急优先级（urgent 底态 + 催促文案） */
  urgent?: boolean;
  /** reminder：分类精灵 key（缺省精灵名兜底） */
  pokemon?: string;
}

export type DownstreamMsg =
  | TaskStateMsg
  | PomodoroConfigMsg
  | LangMsg
  | SpritesMsg
  | HeartbeatMsg
  | QuotesMsg
  | PetEventMsg
  | SysConfigMsg
  | SysNotifyMsg
  | TtsSpeakMsg
  | DialogRequestMsg
  | DialogCancelMsg
  | OpenPathMsg
  | MacAuthQueryMsg
  | ChatReplyMsg;

export const DOWNSTREAM_TYPES = [
  "task-state",
  "pomodoro-config",
  "lang",
  "sprites",
  "heartbeat",
  "quotes",
  "pet-event",
  "sys-config",
  "sys-notify",
  "tts-speak",
  "dialog-request",
  "dialog-cancel",
  "open-path",
  "mac-auth-query",
  "chat-reply",
] as const;

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
  // ---- 系统能力扩展（full-parity AD §4.3）：AI 聊聊问题上载（FR-A8）----
  "pet-chat",
  // ---- P1 D4：提醒就近动作条「推迟 N 分钟」（写 remind_at + 重置 reminded）----
  "snooze",
] as const;

export type CmdOp = (typeof CMD_OPS)[number];

export interface CmdMsg {
  type: "cmd";
  op: CmdOp;
  taskId?: number | string;
  /** capture（⚡发报文本）/ pet-chat（AI 聊聊问题 ≤200 字符）等载荷 */
  text?: string;
  /** snooze：推迟分钟数（缺省 10） */
  minutes?: number;
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

export type UpstreamMsg =
  | CmdMsg
  | FocusSettleMsg
  | HelloMsg
  | CrashDiagMsg
  | TrayActionMsg
  | ShortcutFiredMsg
  | NotifyClickedMsg
  | DialogAckMsg
  | DialogResultMsg
  | MacAuthAckMsg
  | MacAuthResultMsg
  | InputActivityMsg
  | SysUnsupportedMsg;

export const UPSTREAM_TYPES = [
  "cmd",
  "focus-settle",
  "hello",
  "crash-diag",
  "tray-action",
  "shortcut-fired",
  "notify-clicked",
  "dialog-ack",
  "dialog-result",
  "mac-auth-ack",
  "mac-auth-result",
  "input-activity",
  "sys-unsupported",
] as const;

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
