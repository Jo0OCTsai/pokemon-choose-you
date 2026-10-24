/**
 * 精灵交互（从 renderer.ts 拆出——棘轮 max-lines，等量迁移；消费面 renderer.ts
 * 的 wireSpriteInteractions）：单击/双击/长按/拖动 >4px + 右键菜单弹出。
 * 长按 600ms 撸宠（纯弹跳 + 台词）；拖动阈值内视为单击搭话。
 */
import { showDialog } from "./dialog.ts";
import { lines } from "./lines.ts";
import { showCtx } from "./menu.ts";
import { mirror, touchInteract } from "./mirror.ts";
import { refs } from "./refs.ts";
import { applyPetState } from "./sprite.ts";

const bridge = window.petBridge;

const DRAG_THRESHOLD_PX = 4;
const PETTING_MS = 600;

interface PointerSession {
  x: number;
  y: number;
  dragging: boolean;
  pressTimer: ReturnType<typeof setTimeout> | null;
}
let pointerSession: PointerSession | null = null;

/** 台词优先级（P1 D2 桌面同构）：当前精灵自定义 quotes > 深夜档（22–6）安睡池 > 默认池 */
function randomLine(pool: "petQuotes" | "chatQuotes"): string {
  const custom = mirror.quotes[mirror.spriteKey];
  if (custom !== undefined && custom.length > 0) {
    return custom[Math.floor(Math.random() * custom.length)] ?? "";
  }
  const set = lines(mirror.lang);
  const h = new Date().getHours();
  const arr = h >= 22 || h < 6 ? set.quotesNight : set[pool];
  return arr[Math.floor(Math.random() * arr.length)] ?? "";
}

/** 长按 600ms 撸宠：纯弹跳 + 台词，不打开任何面板 */
function startPetting(): void {
  void bridge.interact("pet-start");
  const quote = randomLine("petQuotes");
  showDialog(quote);
  setTimeout(() => void bridge.interact("pet-end"), 900);
}

export function wireSpriteInteractions(): void {
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
    mirror.perched = false; // 拎起即离开栖息姿态（FR-B1；落定后主进程复评回正）
    applyPetState();
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
    // 松手：状态机回落 + 窗口位置上报（宿主侧持久化 + 坐栖判定，AD §4.3 cmd.pos）
    void bridge.interact("drag-end");
    void bridge.reportPos();
    return;
  }
  // 单击搭话：跳一下 + 台词池（不打开面板）
  const quote = randomLine("chatQuotes");
  if (quote) showDialog(quote);
}
