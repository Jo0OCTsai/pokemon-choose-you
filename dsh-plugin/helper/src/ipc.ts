/**
 * 渲染层 IPC 面（preload 白名单转发；枚举校验后进 runtime）——从 electron-app.ts 拆出，
 * 每组 handler 一个小函数（复杂度/行数档位对齐域核心口径）。
 */
import { BrowserWindow, ipcMain } from "electron";
import { CMD_OPS, type CmdOp, type Lang } from "./bridge/protocol.ts";
import { msLeft, ringProgress } from "./state/pomodoro.ts";
import type { HelperRuntime } from "./runtime/index.ts";
import { QUICK_W, WINDOW_H, WINDOW_W } from "./windowConsts.ts";

/** 拖动增量节流（渲染层 pointermove 频率高，setPosition 按帧合并） */
const DRAG_THROTTLE_MS = 16;
/** 渲染层可回流的交互事件白名单（petState 事件子集） */
const INTERACT_KINDS = new Set(["pet-start", "pet-end", "drag-start", "drag-end", "celebrate-end", "interact"]);

export function wireIpc(win: BrowserWindow, runtime: HelperRuntime): void {
  wireWindowIpc(win, runtime);
  wireCommandIpc(runtime);
  wireDataIpc(runtime);
}

/** 窗体行为类：穿透翻转 / 拖动 / 快捷屏宽翻转 / 位置上报 */
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

  // 拖动结束：窗口位置上报（AD §4.3 cmd.pos——宿主侧持久化；op 未单列 move，归交互事件）
  ipcMain.handle("pet:reportPos", () => {
    if (win.isDestroyed()) return false;
    const [x, y] = win.getPosition();
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
function wireDataIpc(runtime: HelperRuntime): void {
  // 每秒快照（渲染层色环/药丸倒计时/状态对齐）
  ipcMain.handle("pet:snapshot", () => {
    const phase = runtime.pomoPhase;
    const now = Date.now();
    return {
      petState: runtime.petState,
      lang: runtime.lang,
      activeTask: runtime.activeTask,
      todayTasks: runtime.todayTasks,
      pomo: phase ? { kind: phase.kind, msLeft: msLeft(phase, now), progress: ringProgress(phase, now) } : null,
      reducedMotion: runtime.reducedMotion,
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
}
