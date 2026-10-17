/**
 * Electron 胶水（AD §3.3）：BrowserWindow 300×330 透明置顶局部小窗（**禁止全屏透明画布**）。
 *
 * - 窗体位：transparent / alwaysOnTop('screen-saver') / skipTaskbar / focusable:false /
 *   不可最大最小不可缩放；
 * - 穿透翻转：默认 setIgnoreMouseEvents(true, {forward:true})；渲染层命中区 mousemove 命中 →
 *   IPC → ignoreMouseEvents(false)，离开 → (true, forward)（IPC 面见 ipc.ts）；
 * - 置顶看门狗：每 5s 重申 alwaysOnTop（防被全屏应用/别的置顶窗压下去）；
 * - keyToId 注入：构建期拷贝的全量 catalog（dist/renderer/pokemon-catalog.json，
 *   源 = 主应用 src/pokemon/catalog.json）注入 resolver，非内置宝可梦可拼 CDN 候选。
 */
import { app, BrowserWindow, screen } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { wireIpc } from "./ipc.ts";
import type { HelperRuntime, UiEvent } from "./runtime/index.ts";
import { WINDOW_H, WINDOW_W } from "./windowConsts.ts";

export interface ElectronAppOptions {
  initialPos?: { x: number; y: number };
  subscribeUi: (cb: (ev: UiEvent) => void) => () => void;
}

/** 置顶看门狗间隔（AD §3.3：每 5s 重申） */
const ALWAYS_ON_TOP_REASSERT_MS = 5_000;

// accessory 激活策略（app.dock.hide，仅 macOS 有 dock 面）：桌宠是纯悬浮窗，
// 不该在 Dock 占一个图标位（Electron 默认按 Electron.app bundle 出图标）
app.dock?.hide();

export function startElectronApp(runtime: HelperRuntime, opts: ElectronAppOptions): void {
  injectCatalog(runtime, path.join(__dirname, "renderer", "pokemon-catalog.json"));
  app.whenReady().then(() => {
    const win = createWindow(opts.initialPos);
    const unsubscribe = forwardUiEvents(win, opts.subscribeUi);
    const topWatchdog = setInterval(() => {
      if (!win.isDestroyed()) win.setAlwaysOnTop(true, "screen-saver");
    }, ALWAYS_ON_TOP_REASSERT_MS);
    wireIpc(win, runtime);
    watchRendererHealth(win, runtime);
    win.on("closed", () => {
      clearInterval(topWatchdog);
      unsubscribe();
    });
    app.on("window-all-closed", () => app.quit());
  });
}

/** catalog 注入（同步、建窗前）：任意非内置宝可梦可拼 CDN 候选 */
function injectCatalog(runtime: HelperRuntime, catalogPath: string): void {
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
      entries?: [number, string, string, string, string][];
    };
    const entries = raw.entries ?? [];
    const idByKey = new Map<string, number>(entries.map(([id, key]) => [key, id]));
    const nameByKey = new Map(entries.map(([, key, hans, hant, en]) => [key, { hans, hant, en }]));
    runtime.resolver.setKeyToId((key) => idByKey.get(key));
    runtime.resolver.setNameLookup((key) => nameByKey.get(key));
  } catch {
    runtime.bridge.diag.push("catalog-miss", catalogPath);
  }
}

/** UiEvent → 渲染层转发（quit → app.quit，宿主死亡/退出口径见 main.ts） */
function forwardUiEvents(win: BrowserWindow, subscribe: ElectronAppOptions["subscribeUi"]): () => void {
  return subscribe((ev: UiEvent) => {
    if (ev.kind === "quit") {
      app.quit();
      return;
    }
    if (!win.isDestroyed()) win.webContents.send("ui-event", ev);
  });
}

/** 渲染进程崩溃：记录诊断并重载一次（插件侧监督兜底崩溃重启） */
function watchRendererHealth(win: BrowserWindow, runtime: HelperRuntime): void {
  win.webContents.on("render-process-gone", (_e, details) => {
    runtime.bridge.diag.push("renderer-gone", details.reason);
    if (!win.isDestroyed()) win.reload();
  });
}

function createWindow(initialPos?: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    transparent: true,
    // 显式全透明（#00000000）：BrowserWindow 默认 backgroundColor 是不透明白，
    // 新版 macOS 上会压过 transparent:true 直接渲染成白色实底窗
    backgroundColor: "#00000000",
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  // 跨 Space 悬浮：窗口默认归属创建时所在的 Space（多全屏/多桌面切换即消失——真机反馈）。
  // canJoinAllSpaces 跟随用户当前 Space + fullscreenAuxiliary 允许悬浮在全屏 app 之上
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 默认点击穿透（forward 让渲染层仍能收到 mousemove 做命中翻转）
  win.setIgnoreMouseEvents(true, { forward: true });
  placeWindow(win, initialPos);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

function placeWindow(win: BrowserWindow, initialPos?: { x: number; y: number }): void {
  if (initialPos) {
    win.setPosition(initialPos.x, initialPos.y, false);
    return;
  }
  // 缺省落位：主屏工作区右下角内缩（避开系统角标/双桌宠首启错开由宿主下 pos）
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(area.x + area.width - WINDOW_W - 24, area.y + area.height - WINDOW_H - 24, false);
}
