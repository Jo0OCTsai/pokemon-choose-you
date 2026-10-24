/**
 * 桥协议系统能力扩展的形状校验（sys-protocol.ts 15 条消息的解析器半边）。
 *
 * 校验立场与 validators.ts 一致：未知 type、缺字段/类型不符 → 返回 null（调用方
 * 丢弃 + 计错），绝不抛异常崩掉 helper。导出 `SYS_DOWNSTREAM_PARSERS` /
 * `SYS_UPSTREAM_PARSERS` 两张表并入 validators.ts 的方向分发。
 */
import type { DownstreamMsg, SysConfigMsg, UpstreamMsg } from "./protocol.ts";
import { NOTIFY_KINDS, SHORTCUT_IDS, TRAY_ACTIONS, type DialogFileFilter, type NotifyKind } from "./sys-protocol.ts";

// 字段级小工具（与 validators.ts 同型；本文件独立声明避免循环依赖）

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** seq 域：非负整数（0 保留给主动上报——mac-auth-result 撤销语义，sys-protocol.ts） */
const isSeq = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
const isNotifyKind = (v: unknown): v is NotifyKind => isStr(v) && (NOTIFY_KINDS as readonly string[]).includes(v);

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}

function isFileFilter(v: unknown): v is DialogFileFilter {
  return isObj(v) && isStr(v.name) && isStrArray(v.extensions);
}

// ---- 下行 8 条解析器（helper 收到的方向） ----

/** sys-config 分节小解析器（每节独立守卫——缺省 = 通过不动；存在但不过 = 整条作废） */
function traySection(v: unknown): SysConfigMsg["tray"] | null {
  if (!isObj(v) || !isStr(v.tooltip)) return null;
  const petVisible = v.petVisible;
  if (petVisible !== undefined && !isBool(petVisible)) return null;
  return petVisible === undefined ? { tooltip: v.tooltip } : { tooltip: v.tooltip, petVisible };
}

function shortcutsSection(v: unknown): SysConfigMsg["shortcuts"] | null {
  return isObj(v) && isStr(v.capture) && isStr(v.togglePet) ? { capture: v.capture, togglePet: v.togglePet } : null;
}

function inputResponseSection(v: unknown): SysConfigMsg["inputResponse"] | null {
  if (!isObj(v) || !isBool(v.enabled)) return null;
  const max = v.focusHopCoupleMax;
  return max === undefined
    ? { enabled: v.enabled }
    : isNum(max)
      ? { enabled: v.enabled, focusHopCoupleMax: max }
      : null;
}

function ttsSection(v: unknown): SysConfigMsg["tts"] | null {
  return isObj(v) && isBool(v.enabled) ? { enabled: v.enabled } : null;
}

/** 缩放档值域（sys-config.pet.scale 与共享键 pet_scale 单源） */
export const PET_SCALES = [1, 1.25, 1.5, 2] as const;
/** 透明度档值域（sys-config.pet.opacity 与共享键 pet_opacity 单源） */
export const PET_OPACITIES = [100, 80, 60] as const;

/** 可选字段搬移（守卫不过 → false = 整条作废；缺省跳过） */
function optGuard(
  source: Record<string, unknown>,
  out: Record<string, unknown>,
  key: string,
  guard: (raw: unknown) => boolean,
): boolean {
  const raw = source[key];
  if (raw === undefined) return true;
  if (!guard(raw)) return false;
  out[key] = raw;
  return true;
}

/** pet 分节（桌宠基础面——陪跑/聊聊/精灵/窗口配置；键均可选，存在即须合法） */
function petSection(v: unknown): SysConfigMsg["pet"] | null {
  if (!isObj(v)) return null;
  const out: Record<string, unknown> = {};
  const ok =
    optGuard(v, out, "mate", isBool) &&
    optGuard(v, out, "agentConfigured", isBool) &&
    optGuard(v, out, "alwaysOnTop", isBool) &&
    optGuard(v, out, "mainPokemon", isStr) &&
    optGuard(
      v,
      out,
      "scale",
      (raw): raw is number => typeof raw === "number" && (PET_SCALES as readonly number[]).includes(raw),
    ) &&
    optGuard(
      v,
      out,
      "opacity",
      (raw): raw is number => typeof raw === "number" && (PET_OPACITIES as readonly number[]).includes(raw),
    );
  return ok ? (out as SysConfigMsg["pet"]) : null;
}

/** 可选分节搬移：缺省通过；存在但守卫不过返回 false（整条消息作废） */
function assignSection<T extends object, K extends keyof T>(
  source: Record<string, unknown>,
  target: T,
  key: K,
  guard: (v: unknown) => T[K] | null,
): boolean {
  const raw = source[String(key)];
  if (raw === undefined) return true;
  const parsed = guard(raw);
  if (parsed === null) return false;
  target[key] = parsed;
  return true;
}

function parseSysConfig(v: Record<string, unknown>): DownstreamMsg | null {
  const msg = { type: "sys-config" } as SysConfigMsg;
  if (!assignSection(v, msg, "tray", traySection)) return null;
  if (!assignSection(v, msg, "shortcuts", shortcutsSection)) return null;
  if (!assignSection(v, msg, "inputResponse", inputResponseSection)) return null;
  if (!assignSection(v, msg, "tts", ttsSection)) return null;
  if (!assignSection(v, msg, "pet", petSection)) return null;
  return msg;
}

function parseSysNotify(v: Record<string, unknown>): DownstreamMsg | null {
  if (!isNotifyKind(v.kind) || !isStr(v.title) || !isStr(v.body)) return null;
  return { type: "sys-notify", kind: v.kind, title: v.title, body: v.body };
}

function parseTtsSpeak(v: Record<string, unknown>): DownstreamMsg | null {
  return isStr(v.text) ? { type: "tts-speak", text: v.text } : null;
}

function parseDialogRequest(v: Record<string, unknown>): DownstreamMsg | null {
  if (v.mode !== "open-file" || !isSeq(v.seq)) return null;
  const filters = v.filters;
  if (filters !== undefined && !(Array.isArray(filters) && filters.every(isFileFilter))) return null;
  return {
    type: "dialog-request",
    mode: "open-file",
    seq: v.seq,
    ...(filters !== undefined ? { filters } : {}),
  };
}

function parseDialogCancel(v: Record<string, unknown>): DownstreamMsg | null {
  return isSeq(v.seq) ? { type: "dialog-cancel", seq: v.seq } : null;
}

function parseOpenPath(v: Record<string, unknown>): DownstreamMsg | null {
  return isStr(v.path) ? { type: "open-path", path: v.path } : null;
}

function parseMacAuthQuery(v: Record<string, unknown>): DownstreamMsg | null {
  if (v.kind !== "accessibility" || !isSeq(v.seq)) return null;
  return { type: "mac-auth-query", kind: "accessibility", seq: v.seq };
}

function parseChatReply(v: Record<string, unknown>): DownstreamMsg | null {
  return isStr(v.text) && isBool(v.ok) ? { type: "chat-reply", text: v.text, ok: v.ok } : null;
}

/** 下行扩展表（并入 validators.ts DOWNSTREAM_PARSERS） */
export const SYS_DOWNSTREAM_PARSERS: Record<string, (v: Record<string, unknown>) => DownstreamMsg | null> = {
  "sys-config": parseSysConfig,
  "sys-notify": parseSysNotify,
  "tts-speak": parseTtsSpeak,
  "dialog-request": parseDialogRequest,
  "dialog-cancel": parseDialogCancel,
  "open-path": parseOpenPath,
  "mac-auth-query": parseMacAuthQuery,
  "chat-reply": parseChatReply,
};

// ---- 上行 9 条解析器（helper 发出 / host 收到的方向） ----

function parseTrayAction(v: Record<string, unknown>): UpstreamMsg | null {
  return isStr(v.action) && (TRAY_ACTIONS as readonly string[]).includes(v.action)
    ? { type: "tray-action", action: v.action as (typeof TRAY_ACTIONS)[number] }
    : null;
}

function parseShortcutFired(v: Record<string, unknown>): UpstreamMsg | null {
  return isStr(v.id) && (SHORTCUT_IDS as readonly string[]).includes(v.id)
    ? { type: "shortcut-fired", id: v.id as (typeof SHORTCUT_IDS)[number] }
    : null;
}

function parseNotifyClicked(v: Record<string, unknown>): UpstreamMsg | null {
  return isNotifyKind(v.kind) ? { type: "notify-clicked", kind: v.kind } : null;
}

function parseDialogAck(v: Record<string, unknown>): UpstreamMsg | null {
  return isSeq(v.seq) ? { type: "dialog-ack", seq: v.seq } : null;
}

function parseDialogResult(v: Record<string, unknown>): UpstreamMsg | null {
  if (!isSeq(v.seq) || !isBool(v.canceled)) return null;
  const paths = v.paths;
  if (paths !== undefined && !isStrArray(paths)) return null;
  return {
    type: "dialog-result",
    seq: v.seq,
    canceled: v.canceled,
    ...(paths !== undefined ? { paths } : {}),
  };
}

function parseMacAuthAck(v: Record<string, unknown>): UpstreamMsg | null {
  return isSeq(v.seq) ? { type: "mac-auth-ack", seq: v.seq } : null;
}

function parseMacAuthResult(v: Record<string, unknown>): UpstreamMsg | null {
  if (v.kind !== "accessibility" || !isSeq(v.seq) || !isBool(v.granted)) return null;
  return { type: "mac-auth-result", seq: v.seq, kind: "accessibility", granted: v.granted };
}

function parseInputActivity(v: Record<string, unknown>): UpstreamMsg | null {
  return isNum(v.cps) && v.cps >= 0 ? { type: "input-activity", cps: v.cps } : null;
}

function parseSysUnsupported(v: Record<string, unknown>): UpstreamMsg | null {
  return isStr(v.unsupported) ? { type: "sys-unsupported", unsupported: v.unsupported } : null;
}

/** 上行扩展表（并入 validators.ts UPSTREAM_PARSERS） */
export const SYS_UPSTREAM_PARSERS: Record<string, (v: Record<string, unknown>) => UpstreamMsg | null> = {
  "tray-action": parseTrayAction,
  "shortcut-fired": parseShortcutFired,
  "notify-clicked": parseNotifyClicked,
  "dialog-ack": parseDialogAck,
  "dialog-result": parseDialogResult,
  "mac-auth-ack": parseMacAuthAck,
  "mac-auth-result": parseMacAuthResult,
  "input-activity": parseInputActivity,
  "sys-unsupported": parseSysUnsupported,
};
