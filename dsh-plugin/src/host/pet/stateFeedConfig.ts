/**
 * 配置下发组装（从 stateFeed.ts 拆出——棘轮 max-lines，等量迁移）：lang / sprites /
 * pomodoro-config / sys-config（含 pet 分节精灵与窗口配置投影）/ 自定义台词惰性集。
 * stateFeed.ts re-export 本文件导出面（消费方 import 路径不变）。
 */
import type { Conn } from "../storage/db";
import { getSetting, primaryAgent } from "../domain/settings";
import { DEFAULT_BUILTIN, DEFAULT_CDN_BASE } from "../../../helper/src/sprites";
import type { Lang, PomodoroConfigMsg, SpritesMsg, SysConfigMsg } from "../../../helper/src/bridge/protocol";
import { PET_OPACITIES, PET_SCALES } from "../../../helper/src/bridge/validators-sys";

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
 * sys-config 组装：tray（tooltip + 桌宠可见性回传）/ shortcuts（缺省组合）/
 * inputResponse（pet_input_response）/ tts（pet_voice）/ pet（mate/agentConfigured/
 * mainPokemon/置顶/缩放/透明度——P1 D2/D5）。分节能力位过滤在 sysChannel（缺位不发该节）。
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
    pet: buildPetSection(conn),
  };
}

/** pet 分节组装（P1 D2/D5：精灵与窗口配置共享键投影，值域非法回落缺省） */
function buildPetSection(conn: Conn): NonNullable<SysConfigMsg["pet"]> {
  const mainPokemon = getSetting(conn, "main_pokemon");
  const scale = Number(getSetting(conn, "pet_scale"));
  const opacity = Number(getSetting(conn, "pet_opacity"));
  return {
    mate: getSetting(conn, "pet_mate") === "true",
    agentConfigured: primaryAgent(conn) !== null,
    ...(mainPokemon === null || mainPokemon === "" ? {} : { mainPokemon }),
    alwaysOnTop: getSetting(conn, "pet_always_on_top") !== "false",
    scale: (PET_SCALES as readonly number[]).includes(scale) ? scale : 1,
    opacity: (PET_OPACITIES as readonly number[]).includes(opacity) ? opacity : 100,
  };
}

/**
 * 每宝可梦自定义台词相关集（P1 D2）：主宝可梦 + 进行中任务精灵，∩ pokemon_quotes
 * 已配置键——惰性下发面（未配置 → 空集不发）。
 */
export function quotesKeysFor(conn: Conn, mainPokemon: string, activePokemon: string): string[] {
  const raw = getSetting(conn, "pokemon_quotes");
  if (raw === null) return [];
  let configured: Record<string, unknown> = {};
  try {
    configured = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  const wanted = new Set([mainPokemon, activePokemon].filter((k) => k !== ""));
  return Object.keys(configured).filter((k) => wanted.has(k));
}

/** pokemon_quotes 中取指定键集的台词（解析失败/键缺 → 空映射） */
export function quotesFor(conn: Conn, keys: string[]): Record<string, string[]> {
  if (keys.length === 0) return {};
  const raw = getSetting(conn, "pokemon_quotes");
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const k of keys) {
      const lines = parsed[k];
      if (Array.isArray(lines) && lines.every((l) => typeof l === "string")) out[k] = lines as string[];
    }
    return out;
  } catch {
    return {};
  }
}
