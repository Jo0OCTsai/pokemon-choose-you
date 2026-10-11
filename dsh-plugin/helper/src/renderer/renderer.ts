/**
 * 桌宠渲染进程入口（vanilla TS + CSS，不引框架——dsh-pet 先例形态）。
 *
 * 组件树（UIUX §3.2）拆在 sibling 模块：sprite.ts（SpriteStage）· dialog.ts（DialogBox）·
 * pill.ts（PomoPill）· quickdex.ts（QuickDexScreen）· menu.ts（ContextMenu）· capture.ts
 * （CaptureShow）；本文件只做：ui-event 装配（handler 分发）、精灵交互（单击/双击/长按/拖动
 * >4px）、穿透翻转、每秒快照与每日问候。
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
import { showDialog } from "./dialog.ts";
import { fill, greetingFor, lines } from "./lines.ts";
import { initMenu, showCtx } from "./menu.ts";
import { mirror, touchInteract, type PetStateLite, type Snapshot, type TaskLite } from "./mirror.ts";
import { refreshPill } from "./pill.ts";
import { refreshQuick, toggleQuick } from "./quickdex.ts";
import { refs } from "./refs.ts";
import { applyPetState, setSprite, updateRing } from "./sprite.ts";

const bridge = window.petBridge;

initMenu({ onSwitchTarget: () => toggleQuick(true) });
wireSpriteInteractions();
wireHitToggle();

// ============================== ui-event 装配（kind → 小 handler） ==============================

function onUiEvent(ev: Record<string, unknown>): void {
  const kind = ev.kind as string;
  if (kind === "task") handleTask(ev);
  else if (kind === "lang") handleLang(ev);
  else if (kind === "sprites") handleSprites(ev);
  else if (kind === "pet-state") handlePetState(ev);
  else if (kind === "bubble") handleBubble(ev);
}

function handleTask(ev: Record<string, unknown>): void {
  const task = ev.task as TaskLite;
  mirror.lastTask = task;
  mirror.todayTasks = (ev.todayTasks as QuickTask[]) ?? [];
  refreshQuick();
  refreshPill(task, null);
  setSprite(task ? task.categoryPokemon : ""); // 无进行中：回主宝可梦
  maybeGreet();
}

function handleLang(ev: Record<string, unknown>): void {
  mirror.lang = ev.lang as Lang;
  refreshQuick();
}

function handleSprites(ev: Record<string, unknown>): void {
  applyReducedMotion(Boolean(ev.reducedMotion));
}

function handlePetState(ev: Record<string, unknown>): void {
  const prevTransient = mirror.petState.transient;
  mirror.petState = ev.state as PetStateLite;
  applyPetState();
  if (mirror.petState.transient === "celebrating" && prevTransient !== "celebrating") playCapture();
  if (mirror.petState.base === "paused" && mirror.lastTask) showPausedLine();
}

/** 暂停台词（{p}在原地休息）在 base 切换瞬间说一次 */
function showPausedLine(): void {
  const task = mirror.lastTask!;
  bridge
    .spriteName(task.categoryPokemon, mirror.lang)
    .then((name: string) => showDialog(fill(lines(mirror.lang).pausedLine, { p: name })))
    .catch(() => undefined);
}

function handleBubble(ev: Record<string, unknown>): void {
  showDialog(ev.text as string, {
    tone: ev.tone as "info" | "event" | "warn",
    blink: Boolean(ev.blink),
  });
}

bridge.onUiEvent((ev: unknown) => onUiEvent(ev as Record<string, unknown>));

// ============================== 精灵交互（单击/双击/长按/拖动 >4px） ==============================

const DRAG_THRESHOLD_PX = 4;
const PETTING_MS = 600;

interface PointerSession {
  x: number;
  y: number;
  dragging: boolean;
  pressTimer: ReturnType<typeof setTimeout> | null;
}
let pointerSession: PointerSession | null = null;

/** 长按 600ms 撸宠：纯弹跳 + 台词，不打开任何面板 */
function startPetting(): void {
  void bridge.interact("pet-start");
  const quote = randomLine("petQuotes");
  showDialog(quote);
  setTimeout(() => void bridge.interact("pet-end"), 900);
}

function randomLine(pool: "petQuotes" | "chatQuotes"): string {
  const arr = lines(mirror.lang)[pool];
  return arr[Math.floor(Math.random() * arr.length)] ?? "";
}

function wireSpriteInteractions(): void {
  refs.sprite.addEventListener("pointerdown", (e) => {
    touchInteract();
    void bridge.interact("interact");
    pointerSession = { x: e.clientX, y: e.clientY, dragging: false, pressTimer: null };
    pointerSession.pressTimer = setTimeout(() => {
      if (pointerSession && !pointerSession.dragging) startPetting();
    }, PETTING_MS);
  });

  window.addEventListener("pointermove", (e) => {
    if (!pointerSession) return;
    trackDrag(e);
  });

  window.addEventListener("pointerup", () => finishPointer());

  refs.sprite.addEventListener("dblclick", () => void bridge.cmd("open-page"));
  refs.stage.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCtx(e.clientX, e.clientY);
  });
}

function trackDrag(e: PointerEvent): void {
  const s = pointerSession!;
  const dx = e.clientX - s.x;
  const dy = e.clientY - s.y;
  if (!s.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
    s.dragging = true;
    if (s.pressTimer) clearTimeout(s.pressTimer);
    void bridge.interact("drag-start");
  }
  if (s.dragging) {
    void bridge.dragBy(e.movementX, e.movementY);
    s.x = e.clientX;
    s.y = e.clientY;
  }
}

function finishPointer(): void {
  if (!pointerSession) return;
  const wasDragging = pointerSession.dragging;
  if (pointerSession.pressTimer) clearTimeout(pointerSession.pressTimer);
  pointerSession = null;
  if (wasDragging) {
    // 松手：状态机回落 + 窗口位置上报（宿主侧持久化，AD §4.3 cmd.pos）
    void bridge.interact("drag-end");
    void bridge.reportPos();
    return;
  }
  // 单击搭话：跳一下 + 台词池（不打开面板）
  const quote = randomLine("chatQuotes");
  if (quote) showDialog(quote);
}

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

// ============================== 每秒快照（色环/药丸倒计时/状态对齐） ==============================

async function tickSnapshot(): Promise<void> {
  try {
    const snap = (await bridge.snapshot()) as Snapshot;
    mirror.lang = snap.lang ?? mirror.lang;
    applyReducedMotion(snap.reducedMotion ?? mirror.reducedMotion);
    mirror.petState = snap.petState;
    applyPetState();
    updateRing(snap.pomo?.progress ?? null);
    refreshPill(snap.activeTask, snap.pomo ? { kind: snap.pomo.kind, msLeft: snap.pomo.msLeft } : null);
  } catch {
    /* 快照通道瞬断：下秒重试 */
  }
}

function applyReducedMotion(on: boolean): void {
  mirror.reducedMotion = on;
  document.documentElement.classList.toggle("reduced-motion", on);
}

// ============================== 每日问候（窗口首现一次） ==============================

function maybeGreet(): void {
  if (mirror.greetedToday) return;
  if (alreadyGreetedToday()) return;
  mirror.greetedToday = true;
  setTimeout(() => showDialog(greetingFor(lines(mirror.lang), new Date().getHours())), 800);
}

function alreadyGreetedToday(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem("pcy-greet-day") === today) return true;
    localStorage.setItem("pcy-greet-day", today);
    return false;
  } catch {
    return false; // file:// 存储受限：本次会话问候一次
  }
}

// ---- 启动 ----
void tickSnapshot();
setInterval(() => void tickSnapshot(), 1_000);
