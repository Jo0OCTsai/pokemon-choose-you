/**
 * 桥协议形状校验（protocol.ts 的校验半边——按方向拆分到每消息一个小解析器，
 * 复杂度档位对齐 dsh-plugin 域核心口径）。
 *
 * 校验立场（AD §4.3 + 任务纪律）：未知 type、未知 op、缺字段/类型不符 → 返回 null
 * （调用方丢弃 + 计错），绝不抛异常崩掉 helper。
 */
import {
  CMD_OPS,
  LANGS,
  type ActiveTask,
  type Badge,
  type CaughtVariant,
  type CmdMsg,
  type CmdOp,
  type DownstreamMsg,
  type Lang,
  type PomoPhaseSnapshot,
  type UpstreamMsg,
} from "./protocol.ts";
import { SYS_DOWNSTREAM_PARSERS, SYS_UPSTREAM_PARSERS } from "./validators-sys.ts";

// ---- 字段级小工具（手写守卫，零依赖） ----

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isTaskId = (v: unknown): v is number | string => isNum(v) || isStr(v);
const isLang = (v: unknown): v is Lang => isStr(v) && (LANGS as readonly string[]).includes(v);

function isBadge(v: unknown): v is { pendingSuggestions: number; failures: number } {
  return isObj(v) && isNum(v.pendingSuggestions) && isNum(v.failures);
}

/** 任务字段集校验（activeTask 与 todayTasks 条目共用） */
function isTaskLike(v: unknown): v is ActiveTask {
  return isObj(v) && isTaskId(v.id) && isStr(v.title) && isStr(v.categoryPokemon) && isStr(v.status);
}

function isLocalizedName(v: unknown): v is { hans: string; hant: string; en: string } {
  return isObj(v) && isStr(v.hans) && isStr(v.hant) && isStr(v.en);
}

function isSpriteEntry(v: unknown): v is { key: string; id: number; name: { hans: string; hant: string; en: string } } {
  return isObj(v) && isStr(v.key) && isNum(v.id) && isLocalizedName(v.name);
}

function isPos(v: unknown): v is { x: number; y: number } {
  return isObj(v) && isNum(v.x) && isNum(v.y);
}

// ---- 下行各消息解析器（helper 收到的方向） ----

/** task-state 字段集守卫（拆小函数控复杂度棘轮） */
function isTaskStateFields(v: Record<string, unknown>): boolean {
  const activeTask = v.activeTask;
  const todayTasks = v.todayTasks;
  if (!isBadge(v.badge) || !isNum(v.ts)) return false;
  if (activeTask !== null && !isTaskLike(activeTask)) return false;
  if (todayTasks !== undefined && !isTaskArray(todayTasks)) return false;
  return v.caught === undefined || isCaughtVariant(v.caught);
}

function parseTaskState(v: Record<string, unknown>): DownstreamMsg | null {
  if (!isTaskStateFields(v)) return null;
  const todayTasks = v.todayTasks;
  const caught = v.caught;
  return {
    type: "task-state",
    activeTask: v.activeTask as ActiveTask | null,
    badge: v.badge as Badge,
    ts: v.ts as number,
    ...(todayTasks !== undefined ? { todayTasks: todayTasks as ActiveTask[] } : {}),
    ...(caught === undefined ? {} : { caught: caught as CaughtVariant }),
  };
}

/** caught 变体（2.7 补充接线）：两键均可选，存在必须是有限数 */
function isCaughtVariant(v: unknown): v is CaughtVariant {
  if (!isObj(v)) return false;
  if (v.milestone !== undefined && !isNum(v.milestone)) return false;
  return v.streakDays === undefined || isNum(v.streakDays);
}

function isTaskArray(v: unknown): v is ActiveTask[] {
  return Array.isArray(v) && v.every(isTaskLike);
}

function parsePomodoroConfig(v: Record<string, unknown>): DownstreamMsg | null {
  const durations = v.durations;
  if (!Array.isArray(durations) || durations.length === 0 || !durations.every(isNum)) return null;
  if (!isNum(v.breakMin) || typeof v.enabled !== "boolean" || !isLang(v.lang)) return null;
  return { type: "pomodoro-config", durations, breakMin: v.breakMin, enabled: v.enabled, lang: v.lang };
}

function parseSprites(v: Record<string, unknown>): DownstreamMsg | null {
  const builtin = v.builtin;
  if (!Array.isArray(builtin) || !builtin.every(isSpriteEntry) || !isStr(v.cdnBase)) return null;
  const reducedMotion = v.reducedMotion;
  if (reducedMotion !== undefined && typeof reducedMotion !== "boolean") return null;
  return {
    type: "sprites",
    builtin,
    cdnBase: v.cdnBase,
    ...(reducedMotion !== undefined ? { reducedMotion } : {}),
  };
}

// ---- 上行各消息解析器（helper 发出 / fake host 收到的方向） ----

function parseCmd(v: Record<string, unknown>): UpstreamMsg | null {
  const op = v.op as CmdOp;
  if (!(CMD_OPS as readonly string[]).includes(String(op))) return null;
  const msg: CmdMsg = { type: "cmd", op };
  if (!assignIf(v, msg, "taskId", isTaskId)) return null;
  if (!assignIf(v, msg, "text", isStr)) return null;
  if (!assignIf(v, msg, "pos", isPos)) return null;
  return msg;
}

/** 可选字段搬移：缺省 = 通过不动；存在但不过守卫 = 整条消息作废（返回 false） */
function assignIf<T>(
  source: Record<string, unknown>,
  target: Partial<T>,
  key: keyof T & string,
  guard: (v: unknown) => boolean,
): boolean {
  const value = source[key];
  if (value === undefined) return true;
  if (!guard(value)) return false;
  (target as { [k: string]: unknown })[key] = value;
  return true;
}

function parseFocusSettle(v: Record<string, unknown>): UpstreamMsg | null {
  if (!isTaskId(v.taskId) || !isStr(v.localSessionId) || !isNum(v.elapsedMin)) return null;
  if (v.elapsedMin < 0) return null;
  return {
    type: "focus-settle",
    taskId: v.taskId,
    localSessionId: v.localSessionId,
    elapsedMin: v.elapsedMin,
  };
}

function parseHello(v: Record<string, unknown>): UpstreamMsg | null {
  if (!isStr(v.version) || !isStrArray(v.caps)) return null;
  return { type: "hello", version: v.version, caps: v.caps };
}

const POMO_KINDS: readonly string[] = ["focus", "break", "trial"];

function isPomoPhase(v: unknown): v is PomoPhaseSnapshot {
  if (!isObj(v) || !isStr(v.kind) || !POMO_KINDS.includes(v.kind) || !isNum(v.endAt)) return false;
  return v.durationMin === undefined || isNum(v.durationMin);
}

function parsePomoState(v: Record<string, unknown>): UpstreamMsg | null {
  if (!isNum(v.ts)) return null;
  if (v.phase !== null && !isPomoPhase(v.phase)) return null;
  if (v.taskId !== null && !isTaskId(v.taskId)) return null;
  return {
    type: "pomo-state",
    phase: v.phase as PomoPhaseSnapshot | null,
    taskId: v.taskId as number | string | null,
    ts: v.ts,
  };
}

function parseCrashDiag(v: Record<string, unknown>): UpstreamMsg | null {
  if (!Array.isArray(v.entries) || !v.entries.every(isDiagEntry)) return null;
  return { type: "crash-diag", entries: v.entries };
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}

function isDiagEntry(v: unknown): v is { ts: number; tag: string; detail: string } {
  return isObj(v) && isNum(v.ts) && isStr(v.tag) && isStr(v.detail);
}

// ---- 方向分发（薄 switch：每 case 一个解析器；系统能力扩展表来自 validators-sys.ts） ----

const DOWNSTREAM_PARSERS: Record<string, (v: Record<string, unknown>) => DownstreamMsg | null> = {
  "task-state": parseTaskState,
  "pomodoro-config": parsePomodoroConfig,
  lang: (v) => (isLang(v.lang) ? { type: "lang", lang: v.lang } : null),
  sprites: parseSprites,
  heartbeat: (v) => (isNum(v.ts) ? { type: "heartbeat", ts: v.ts } : null),
  ...SYS_DOWNSTREAM_PARSERS,
};

const UPSTREAM_PARSERS: Record<string, (v: Record<string, unknown>) => UpstreamMsg | null> = {
  cmd: parseCmd,
  "focus-settle": parseFocusSettle,
  "pomo-state": parsePomoState,
  hello: parseHello,
  "crash-diag": parseCrashDiag,
  ...SYS_UPSTREAM_PARSERS,
};

export function validateDownstream(v: unknown): DownstreamMsg | null {
  if (!isObj(v)) return null;
  const parse = DOWNSTREAM_PARSERS[String(v.type)];
  return parse ? parse(v) : null;
}

export function validateUpstream(v: unknown): UpstreamMsg | null {
  if (!isObj(v)) return null;
  const parse = UPSTREAM_PARSERS[String(v.type)];
  return parse ? parse(v) : null;
}
