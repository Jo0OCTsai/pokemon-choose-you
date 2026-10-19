/**
 * 渲染层 IPC 面（preload 白名单转发；枚举校验后进 runtime）——从 electron-app.ts 拆出，
 * 每组 handler 一个小函数（复杂度/行数档位对齐域核心口径）。
 */
import { BrowserWindow, ipcMain, screen } from "electron";
import { CMD_OPS, type CmdOp, type Lang } from "./bridge/protocol.ts";
import { TRIAL_MIN, msLeft, ringProgress } from "./state/pomodoro.ts";
import { shouldPerch } from "./state/perch.ts";
import type { HelperRuntime } from "./runtime/index.ts";
import { CHAT_H, QUICK_W, WINDOW_H, WINDOW_W } from "./windowConsts.ts";

/** 拖动增量节流（渲染层 pointermove 频率高，setPosition 按帧合并） */
const DRAG_THROTTLE_MS = 16;
/** 渲染层可回流的交互事件白名单（petState 事件子集） */
const INTERACT_KINDS = new Set(["pet-start", "pet-end", "drag-start", "drag-end", "celebrate-end", "interact"]);

/** 坐栖判定（FR-B1）：窗口底边 vs 当前显示器工作区底边（同 DIP 逻辑像素，无需缩放） */
export function checkPerch(win: BrowserWindow, runtime: HelperRuntime): void {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  runtime.reportPerch(shouldPerch(bounds.y + bounds.height, work.y + work.height));
}

export function wireIpc(win: BrowserWindow, runtime: HelperRuntime): void {
  wireWindowIpc(win, runtime);
  wireCommandIpc(runtime);
  wireDataIpc(win, runtime);
}

/** 窗体行为类：穿透翻转 / 拖动 / 快捷屏宽翻转 / ChatBox 高度翻转 / 位置上报（含坐栖判定） */
function wireWindowIpc(win: BrowserWindow, runtime: HelperRuntime): void {
  ipcMain.handle("pet:hit", (_e, active: boolean) => {
    if (!win.isDestroyed()) win.setIgnoreMouseEvents(!active, { forward: true });
  });

  let lastDragAt = 0;
  ipcMain.handle("pet:dragBy", (_e, dx: number, dy: number) => {
    const now = Date.now();
    if (now - lastDragAt < DRAG_THROTTLE_MS) return;
    lastDragAt = now;
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setPosition(x + Math.round(dx), y + Math.round(dy), false);
  });

  // 拖动结束：窗口位置上报（AD §4.3 cmd.pos——宿主侧持久化）+ 坐栖判定（FR-B1：落定即判）
  ipcMain.handle("pet:reportPos", () => {
    if (win.isDestroyed()) return false;
    const [x, y] = win.getPosition();
    checkPerch(win, runtime);
    return runtime.sendCmd("pet-interact", { pos: { x, y } });
  });

  // 快捷图鉴屏 300 ↔ 590 宽翻转（UIUX §3.2：LCD 今日列表 590 宽；左缘不动向右展开）
  ipcMain.handle("pet:quickSize", (_e, open: boolean) => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const width = open ? QUICK_W : WINDOW_W;
    if (win.getBounds().width !== width) {
      win.setSize(width, WINDOW_H, false);
      win.setPosition(x, y, false);
    }
  });

  // ChatBox 原位展开调高 330 ↔ 480（透明窗多余高度不可见；宽度不动——快捷屏宽度优先不叠加）。
  // 窗体默认 focusable:false（点击穿透纪律）——ChatBox 需要键盘输入，展开时临时可聚焦。
  ipcMain.handle("pet:chatSize", (_e, open: boolean) => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const height = open ? CHAT_H : WINDOW_H;
    if (win.getBounds().height !== height) {
      win.setSize(win.getBounds().width, height, false);
      win.setPosition(x, y, false);
    }
    win.setFocusable(open);
    if (open) win.focus();
  });
}

/** 上行命令类：cmd / 本端完成 / 交互回流 / 番茄本地控制 */
function wireCommandIpc(runtime: HelperRuntime): void {
  ipcMain.handle("pet:cmd", (_e, op: string, fields?: Record<string, unknown>) => {
    if (!(CMD_OPS as readonly string[]).includes(op)) return false;
    return runtime.sendCmd(
      op as CmdOp,
      fields as { taskId?: number | string; text?: string; pos?: { x: number; y: number } },
    );
  });

  ipcMain.handle("pet:complete", () => runtime.completeTask());

  ipcMain.handle("pet:interact", (_e, kind: string) => {
    if (!INTERACT_KINDS.has(kind)) return;
    runtime.interact({
      kind: kind as "pet-start" | "pet-end" | "drag-start" | "drag-end" | "celebrate-end" | "interact",
    });
  });

  ipcMain.handle("pet:pomo", (_e, action: string, durationMin?: number) => {
    if (action === "focus") runtime.pomo.beginFocus(durationMin);
    else if (action === "trial") runtime.pomo.beginTrial();
    else if (action === "break") runtime.pomo.beginBreak();
  });
}

/** 数据查询类：每秒快照 / 素材候选链 / 宝可梦名 */
function wireDataIpc(win: BrowserWindow, runtime: HelperRuntime): void {
  // 每秒快照（渲染层色环/药丸倒计时/状态对齐/坐栖与输入响应配置面）
  ipcMain.handle("pet:snapshot", () => {
    const phase = runtime.pomoPhase;
    const now = Date.now();
    const durationMs =
      phase === null
        ? 0
        : phase.kind === "focus"
          ? phase.durationMin * 60_000
          : phase.kind === "trial"
            ? TRIAL_MIN * 60_000
            : 0;
    return {
      petState: runtime.petState,
      lang: runtime.lang,
      activeTask: runtime.activeTask,
      todayTasks: runtime.todayTasks,
      pomo: phase
        ? { kind: phase.kind, msLeft: msLeft(phase, now), durationMs, progress: ringProgress(phase, now) }
        : null,
      reducedMotion: runtime.reducedMotion,
      perched: runtime.perched,
      petVisible: runtime.petVisible,
      inputResponse: runtime.inputResponse,
      petConfig: runtime.petConfig,
    };
  });

  // 素材候选链解析（含 A20 双缺回退与单次缺失事件）
  ipcMain.handle("pet:sprite", (_e, key: string) => {
    const k = String(key ?? "");
    return {
      res: runtime.resolver.resolve(k),
      missing: runtime.resolver.takeMissingEvent(k),
      standInName: runtime.resolver.pokemonName(runtime.resolver.standIn.key, runtime.lang),
    };
  });

  ipcMain.handle("pet:spriteName", (_e, key: string, lang: string) =>
    runtime.resolver.pokemonName(String(key ?? ""), lang as Lang),
  );

  // 渲染层请求即时坐栖复评（拖拽中途工作区变化等；FR-B1）
  ipcMain.handle("pet:checkPerch", () => {
    checkPerch(win, runtime);
    return runtime.perched;
  });
}
