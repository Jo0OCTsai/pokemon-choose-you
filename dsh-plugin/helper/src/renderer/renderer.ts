/**
 * 桌宠渲染进程入口（vanilla TS + CSS，不引框架——dsh-pet 先例形态）。
 *
 * 组件树（UIUX §3.2）拆在 sibling 模块：sprite.ts（SpriteStage）· dialog.ts（DialogBox）
 * · pill.ts（PomoPill）· quickdex.ts（QuickDexScreen）· menu.ts（ContextMenu）· capture.ts
 * （CaptureShow——plain/streak/milestone 变体）· chatbox.ts（ChatBox）· mate.ts（MateSprite）·
 * inputResponse.ts（InputResponse）；本文件做：ui-event 装配、每秒快照调度。
 * 拆件（棘轮 max-lines，等量迁移）：精灵交互 = spriteInteract.ts、时刻台词与时段问候
 * 调度 = petSchedule.ts、精灵名取用 = pokemonName.ts。
 *
 * 穿透翻转：html/body 根 pointer-events:none，命中区（.hit）auto——document mousemove（穿透
 * forward 仍可达）按 e.target.closest('.hit') 翻转 setIgnoreMouseEvents。
 * reduced-motion 双通道：CSS prefers-reduced-motion + sprites 配置位（ui-event/snapshot 下发）。
 */
import "@fontsource/press-start-2p";
import "@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css";
import "./pet.css";
import type { Lang, QuickTask } from "../bridge/protocol.ts";
// 组件模块（import 即完成各自的 DOM 接线）
import { playCapture } from "./capture.ts";
import { handleChatReply, initChatBox, openChat, refreshChatStatic } from "./chatbox.ts";
import { showDialog } from "./dialog.ts";
import { fill, lines } from "./lines.ts";
import { initMenu } from "./menu.ts";
import { mirror, type PetStateLite, type Snapshot, type TaskLite } from "./mirror.ts";
import { tickMate } from "./mate.ts";
import { feedActivity, initInputResponse } from "./inputResponse.ts";
import { loadMetOn, startPetSchedules } from "./petSchedule.ts";
import { refreshPill } from "./pill.ts";
import { withPokemonName } from "./pokemonName.ts";
import { refreshQuick, toggleQuick } from "./quickdex.ts";
import { applyPetState, setSprite, updateRing } from "./sprite.ts";
import { wireSpriteInteractions } from "./spriteInteract.ts";

const bridge = window.petBridge;

initMenu({ onSwitchTarget: () => toggleQuick(true), onOpenChat: () => openChat() });
initChatBox();
initInputResponse();
wireSpriteInteractions();
wireHitToggle();
loadMetOn();

// ============================== ui-event 装配（kind → 小 handler 分派表） ==============================

/** ui-event 分派表（kind → handler；未登记 kind 静默忽略） */
const UI_EVENT_HANDLERS: Record<string, (ev: Record<string, unknown>) => void> = {
  task: handleTask,
  lang: handleLang,
  sprites: handleSprites,
  "pet-state": handlePetState,
  "pomo-config": handlePomoConfig,
  bubble: handleBubble,
  "catch-scene": (ev) => playCapture(ev.scene as "plain" | "streak" | "milestone"),
  "chat-reply": (ev) => handleChatReply(String(ev.text ?? ""), Boolean(ev.ok)),
  "input-activity": (ev) => feedActivity(Number(ev.cps ?? 0)),
  perch: (ev) => handlePerch(Boolean(ev.perched)),
};

function onUiEvent(ev: Record<string, unknown>): void {
  const handler = UI_EVENT_HANDLERS[ev.kind as string];
  if (handler !== undefined) handler(ev);
}

function handleTask(ev: Record<string, unknown>): void {
  const task = ev.task as TaskLite;
  mirror.lastTask = task;
  mirror.todayTasks = (ev.todayTasks as QuickTask[]) ?? [];
  refreshQuick();
  refreshPill(task, null);
  setSprite(task ? task.categoryPokemon : ""); // 无进行中：回主宝可梦
}

/** 番茄配置（含功能开关）：开关变化即时重评胶囊显隐 */
function handlePomoConfig(ev: Record<string, unknown>): void {
  const config = ev.config as { enabled?: boolean } | undefined;
  const enabled = Boolean(config?.enabled);
  if (enabled !== mirror.pomoEnabled) {
    mirror.pomoEnabled = enabled;
    refreshPill(mirror.lastTask, null);
  }
}

function handleLang(ev: Record<string, unknown>): void {
  mirror.lang = ev.lang as Lang;
  refreshQuick();
  refreshChatStatic();
}

function handleSprites(ev: Record<string, unknown>): void {
  applyReducedMotion(Boolean(ev.reducedMotion));
}

function handlePetState(ev: Record<string, unknown>): void {
  const prev = mirror.petState;
  mirror.petState = ev.state as PetStateLite;
  applyPetState();
  if (prev.asleep && !mirror.petState.asleep) showWakeLine(); // 揉眼醒来（FR-B5）
  if (mirror.petState.base === "paused" && mirror.lastTask) showPausedLine();
}

function showWakeLine(): void {
  void withPokemonName((name) => showDialog(fill(lines(mirror.lang).wakeUp, { p: name }), { tone: "event" }));
}

/** 暂停台词（{p}在原地休息）在 base 切换瞬间说一次 */
function showPausedLine(): void {
  void withPokemonName((name) => showDialog(fill(lines(mirror.lang).pausedLine, { p: name })));
}

function handleBubble(ev: Record<string, unknown>): void {
  showDialog(ev.text as string, {
    tone: ev.tone as "info" | "event" | "warn",
    blink: Boolean(ev.blink),
  });
}

/** 坐栖翻转（FR-B1）：首次落座说台词（拎起即离在 drag-start 乐观清除 + 主进程复评兜底） */
function handlePerch(perched: boolean): void {
  const was = mirror.perched;
  mirror.perched = perched;
  applyPetState();
  if (perched && !was) {
    void withPokemonName((name) =>
      setTimeout(() => showDialog(fill(lines(mirror.lang).perchedLine, { p: name }), { tone: "event" }), 600),
    );
  }
}

bridge.onUiEvent((ev: unknown) => onUiEvent(ev as Record<string, unknown>));

// ============================== 穿透翻转（AD §3.3） ==============================

function wireHitToggle(): void {
  let hitActive = false;
  document.addEventListener("mousemove", (e) => {
    const el = e.target as Element | null;
    const hit = !!(el && typeof el.closest === "function" && el.closest(".hit"));
    if (hit !== hitActive) {
      hitActive = hit;
      void bridge.setHit(hit);
    }
  });
}

// ============================== 每秒快照（色环/药丸/坐栖/陪跑/输入响应配置） ==============================

async function tickSnapshot(): Promise<void> {
  try {
    const snap = (await bridge.snapshot()) as Snapshot;
    mirror.lang = snap.lang ?? mirror.lang;
    applyReducedMotion(snap.reducedMotion ?? mirror.reducedMotion);
    const perchedChanged = snap.perched !== mirror.perched;
    mirror.perched = snap.perched;
    mirror.petState = snap.petState;
    mirror.inputResponse = snap.inputResponse ?? mirror.inputResponse;
    applyPetState();
    if (perchedChanged && mirror.perched) handlePerch(true);
    updateRing(snap.pomo?.progress ?? null);
    refreshPill(snap.activeTask, snap.pomo ? { kind: snap.pomo.kind, msLeft: snap.pomo.msLeft } : null);
    tickMate(snap);
  } catch {
    /* 快照通道瞬断：下秒重试 */
  }
}

function applyReducedMotion(on: boolean): void {
  mirror.reducedMotion = on;
  document.documentElement.classList.toggle("reduced-motion", on);
}

// ---- 启动 ----
void tickSnapshot();
setInterval(() => void tickSnapshot(), 1_000);
startPetSchedules();
