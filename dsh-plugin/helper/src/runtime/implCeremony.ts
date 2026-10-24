/**
 * runtime 完成仪式与番茄出口支撑件（从 impl.ts 拆出——棘轮 max-lines，等量迁移）：
 * 完成迁移收尾（台词优先级桌面 runCatchScene 同构：allDone > milestone > streak > 收尾/别处
 * 收工）、番茄到期出口（通知/自动接休息——决策3 对齐桌面）、sys-config 下行投影与纯组装。
 * 依赖经窄宿主接口注入（RuntimeImpl 直接满足），无循环运行时依赖。
 */
import type {
  ActiveTask,
  CaughtVariant,
  DownstreamMsg,
  PetEventMsg,
  PomodoroConfigMsg,
  SpritesMsg,
  TaskStateMsg,
} from "../bridge/protocol.ts";
import type { SysDownMsg } from "../sys/index.ts";
import { prepareTtsText } from "../state/ttsText.ts";
import type { PomoConfig } from "../state/pomodoro.ts";
import { planCatchScene, type SceneKind } from "../state/catchScene.ts";
import type { InputResponseView, PetConfigView, UiEvent } from "./index.ts";
import type { BubbleTone } from "./index.ts";
import LINES, { formatSettledElsewhere } from "./lines.ts";

/** 完成仪式宿主面（RuntimeImpl 满足；测试可注入替身） */
export interface CeremonyHost {
  readonly lang: CeremonyLang;
  readonly resolver: { pokemonName(key: string, lang: CeremonyLang): string };
  bubble(text: string, tone: BubbleTone, blink?: boolean): void;
  uiEvent(ev: UiEvent): void;
  /** 本地 TTS 出口（allDone 收工语音——sys 路由内部门控，缺省不发） */
  speak?(text: string): void;
}
type CeremonyLang = Parameters<typeof LINES.caught>[0];

/** 番茄到期出口宿主面（RuntimeImpl 满足） */
export interface PomoHost extends CeremonyHost {
  readonly activeTask: ActiveTask | null;
  readonly pomoBreakMin: number;
  readonly pomoNotifyOn: boolean;
  readonly sys: { readonly notify: { show(kind: "pomo-done", title: string, body: string): void } };
  setPetState(ev: { kind: "break-start" } | { kind: "break-end" }): void;
  readonly pomo: { beginBreak(): void };
}

/**
 * 完成迁移的统一仪式（本地 done 与外部收尾同路径，桌面 runCatchScene 同构）：
 * 变体 → 演出 + 收尾台词 + allDone 送客旗标。
 */
export function finishCeremony(
  host: CeremonyHost,
  prev: ActiveTask,
  caught: CaughtVariant | undefined,
  local: boolean,
): void {
  const scene = planCatchScene(caught ?? {});
  const p = host.resolver.pokemonName(prev.categoryPokemon, host.lang);
  const line = finishLine(host.lang, p, prev.title, caught, local);
  host.bubble(line, "event", true);
  if (caught?.allDone) host.speak?.(LINES.allDone(host.lang, p)); // 收工语音（桌面郑重四类之一）
  host.uiEvent({ kind: "catch-scene", scene, allDone: Boolean(caught?.allDone) });
}

/** 收尾台词优先级：allDone > milestone > streak > 本地收尾/别处收工 */
export function finishLine(
  lang: CeremonyLang,
  p: string,
  title: string,
  caught: CaughtVariant | undefined,
  local: boolean,
): string {
  if (caught?.allDone) return LINES.allDone(lang, p);
  if (caught?.milestone != null) return LINES.milestone(lang, p, caught.milestone);
  if (caught?.streakDays != null) return LINES.streakN(lang, caught.streakDays);
  return local ? LINES.caught(lang, title) : formatSettledElsewhere(lang, title);
}

/** 番茄到期出口（气泡/通知/接休息——桌面 usePomodoro 同构；开新一轮永远手动） */
export function emitPomoEnded(host: PomoHost, kind: "focus" | "trial" | "break"): void {
  if (kind === "break") {
    host.setPetState({ kind: "break-end" });
    host.bubble(LINES.breakOver(host.lang), "event");
    return;
  }
  if (kind === "trial") {
    host.bubble(LINES.trialDone(host.lang), "event");
    return;
  }
  host.bubble(LINES.pomoDone(host.lang), "event", true);
  if (host.pomoNotifyOn) emitPomoNotify(host);
  if (host.pomoBreakMin > 0) host.pomo.beginBreak(); // 决策3 对齐桌面：专注结束自动接短休息（trial 不接）
}

function emitPomoNotify(host: PomoHost): void {
  const task = host.activeTask;
  host.sys.notify.show(
    "pomo-done",
    LINES.pomoNotifTitle(host.lang),
    LINES.pomoNotifBody(
      host.lang,
      task?.title ?? "",
      host.resolver.pokemonName(task?.categoryPokemon ?? "pikachu", host.lang),
    ),
  );
}

/** sys-config.pet 分节 → 桌宠基础面投影（缺省继承当前值；值域钳制在 host 侧完成） */
export function petConfigOf(
  section: {
    mate?: boolean;
    agentConfigured?: boolean;
    mainPokemon?: string;
    alwaysOnTop?: boolean;
    scale?: number;
    opacity?: number;
    dexCaught?: string[];
  },
  cur: PetConfigView,
): PetConfigView {
  return {
    mate: section.mate ?? cur.mate,
    agentConfigured: section.agentConfigured ?? cur.agentConfigured,
    mainPokemon: section.mainPokemon ?? cur.mainPokemon,
    alwaysOnTop: section.alwaysOnTop ?? cur.alwaysOnTop,
    scale: section.scale ?? cur.scale,
    opacity: section.opacity ?? cur.opacity,
    dexCaught: section.dexCaught ?? cur.dexCaught,
  };
}

/** sys-config.inputResponse 分节 → 渲染层投影（hop 耦合上限夹在 0.1） */
export function inputResponseOf(section: { enabled: boolean; focusHopCoupleMax?: number }): InputResponseView {
  const max = section.focusHopCoupleMax;
  return { enabled: section.enabled, hopCoupleMax: typeof max === "number" && max > 0 ? Math.min(max, 0.1) : 0 };
}

/** pet 基础面变更判定（任一键变化才算——渲染层免抖动重放） */
export function petConfigChanged(a: PetConfigView, b: PetConfigView): boolean {
  return (
    a.mate !== b.mate ||
    a.agentConfigured !== b.agentConfigured ||
    a.mainPokemon !== b.mainPokemon ||
    a.alwaysOnTop !== b.alwaysOnTop ||
    a.scale !== b.scale ||
    a.opacity !== b.opacity ||
    a.dexCaught.join(",") !== b.dexCaught.join(",")
  );
}

/** pomodoro-config 下行 → 本地 PomoConfig（notify/chime 可选位缺省 false） */
export function pomoConfigOf(msg: PomodoroConfigMsg): PomoConfig {
  return {
    durations: msg.durations,
    breakMin: msg.breakMin,
    enabled: msg.enabled,
    notify: msg.notify === true,
    chime: msg.chime === true,
  };
}

/** sprites 下行 → 渲染层 ui-event 组装 */
export function spritesEventOf(msg: SpritesMsg, reducedMotion: boolean): UiEvent {
  return { kind: "sprites", builtin: msg.builtin, cdnBase: msg.cdnBase, reducedMotion };
}

/** 演出变体类型再出口（ceremony 消费面） */
export type { SceneKind };

/** pet-event 下行 → 渲染层事件组装（reset-pos 由 electron 胶水在主进程消化，仍发事件面） */
export function petEventUiEventOf(msg: PetEventMsg): UiEvent | null {
  if (msg.kind === "reset-pos") return { kind: "reset-pos" };
  return {
    kind: "reminder",
    taskId: msg.taskId ?? 0,
    title: msg.title ?? "",
    urgent: msg.urgent === true,
    pokemon: msg.pokemon ?? "",
  };
}

/** 下行分发宿主面（RuntimeImpl 满足；方法经 public 提升供结构化消费） */
export interface DispatchHost extends CeremonyHost {
  readonly sys: { setLang(lang: CeremonyLang): void; handle(msg: SysDownMsg): boolean };
  onTaskState(msg: TaskStateMsg): void;
  onPomodoroConfig(msg: PomodoroConfigMsg): void;
  onSprites(msg: SpritesMsg): void;
  onPetEvent(msg: PetEventMsg): void;
  routeSysMsg(msg: SysDownMsg): void;
  setLangValue(lang: CeremonyLang): void;
  setQuotes(map: Record<string, string[]>): void;
}

/** 下行分发 switch（每 case 一个宿主小方法；系统能力消息回落宿主路由） */
export function dispatchDownstream(host: DispatchHost, msg: DownstreamMsg): void {
  switch (msg.type) {
    case "task-state":
      host.onTaskState(msg);
      break;
    case "pomodoro-config":
      host.onPomodoroConfig(msg);
      break;
    case "lang":
      host.setLangValue(msg.lang);
      host.sys.setLang(msg.lang);
      host.uiEvent({ kind: "lang", lang: msg.lang });
      break;
    case "sprites":
      host.onSprites(msg);
      break;
    case "quotes":
      host.setQuotes(msg.map);
      host.uiEvent({ kind: "quotes", map: msg.map });
      break;
    case "pet-event":
      host.onPetEvent(msg);
      break;
    case "heartbeat":
      break; // 管道守卫已在 bridge 层喂狗（任意数据都算活着）
    case "chat-reply":
      dispatchChatReply(host, msg);
      break;
    default:
      host.routeSysMsg(msg as SysDownMsg);
      break;
  }
}

/** chat-reply：直达渲染层（失败 ok=false 气泡回退）+ 回答语音播报（桌面郑重四类） */
function dispatchChatReply(host: DispatchHost, msg: Extract<DownstreamMsg, { type: "chat-reply" }>): void {
  host.uiEvent({ kind: "chat-reply", text: msg.text, ok: msg.ok });
  if (msg.ok) host.speak?.(msg.text);
}

/** 本地 TTS 出口（P2-3）：state/ttsText 归一 → sys 路由（模块内 tts.enabled 门控；空文本不发） */
export function speakViaSys(sys: { handle(msg: SysDownMsg): boolean }, text: string): void {
  const prepared = prepareTtsText(text);
  if (prepared !== null) sys.handle({ type: "tts-speak", text: prepared });
}
