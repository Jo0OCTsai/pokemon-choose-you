/**
 * Electron 胶水（AD §3.3 + full-parity §3.4）：BrowserWindow 300×330 透明置顶局部小窗
 * （**禁止全屏透明画布**）+ sys/ 真模块装配（app ready 后挂 DeferredSys）。
 *
 * - 窗体位：transparent / alwaysOnTop('screen-saver') / skipTaskbar / focusable:false /
 *   不可最大最小不可缩放；
 * - 穿透翻转：默认 setIgnoreMouseEvents(true, {forward:true})；渲染层命中区 mousemove 命中 →
 *   IPC → ignoreMouseEvents(false)，离开 → (true, forward)（IPC 面见 ipc.ts）；
 * - 置顶看门狗：每 5s 重申 alwaysOnTop（防被全屏应用/别的置顶窗压下去）；
 * - keyToId 注入：构建期拷贝的全量 catalog（dist/renderer/pokemon-catalog.json，
 *   源 = 主应用 src/pokemon/catalog.json）注入 resolver，非内置宝可梦可拼 CDN 候选；
 * - 坐栖（FR-B1）：建窗落位与拖拽落定后按 state/perch.ts 判定 → runtime.reportPerch。
 */
import { app, BrowserWindow, screen } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkPerch, wireIpc } from "./ipc.ts";
import type { HelperRuntime, UiEvent } from "./runtime/index.ts";
import { createElectronSys, type DeferredSys } from "./sys/index.ts";
import { WINDOW_H, WINDOW_W } from "./windowConsts.ts";

export interface ElectronAppOptions {
  initialPos?: { x: number; y: number };
  subscribeUi: (cb: (ev: UiEvent) => void) => () => void;
  /** DeferredSys（main.ts 创建）——whenReady 后挂真模块并重放排队消息 */
  attachSys?: DeferredSys;
}

/** 置顶看门狗间隔（AD §3.3：每 5s 重申） */
const ALWAYS_ON_TOP_REASSERT_MS = 5_000;

// accessory 激活策略（app.dock.hide，仅 macOS 有 dock 面）：桌宠是纯悬浮窗，
// 不该在 Dock 占一个图标位（Electron 默认按 Electron.app bundle 出图标）
app.dock?.hide();

export function startElectronApp(runtime: HelperRuntime, opts: ElectronAppOptions): void {
  injectCatalog(runtime, path.join(__dirname, "renderer", "pokemon-catalog.json"));
  app.whenReady().then(() => {
    const win = createWindow(opts.initialPos, runtime.petConfig.scale);
    void attachSysModules(runtime, win, opts);
    const unsubscribe = forwardUiEvents(win, opts.subscribeUi);
    // 置顶看门狗读配置（pet_always_on_top 关 = 不重申，可被其他窗口压下——P1 D5）
    const topWatchdog = setInterval(() => {
      if (!win.isDestroyed() && runtime.petConfig.alwaysOnTop) win.setAlwaysOnTop(true, "screen-saver");
    }, ALWAYS_ON_TOP_REASSERT_MS);
    // 窗口配置即时应用（pet-config 事件面）：置顶开关 + 缩放等比（左上角锚定）
    let lastScale = runtime.petConfig.scale;
    const unsubCfg = opts.subscribeUi((ev) => {
      if (ev.kind !== "pet-config" || win.isDestroyed()) return;
      const cfg = runtime.petConfig;
      win.setAlwaysOnTop(cfg.alwaysOnTop, "screen-saver");
      if (cfg.scale !== lastScale) {
        const [w, h] = win.getSize();
        const ratio = cfg.scale / lastScale;
        win.setSize(Math.round(w * ratio), Math.round(h * ratio), false);
        lastScale = cfg.scale;
      }
    });
    wireIpc(win, runtime);
    watchRendererHealth(win, runtime);
    checkPerch(win, runtime); // 启动时窗口记忆位置可能就在底缘
    win.on("closed", () => {
      clearInterval(topWatchdog);
      unsubscribe();
      unsubCfg();
    });
    app.on("window-all-closed", () => app.quit());
  });
}

/** sys/ 真模块装配（Tray 等主进程 API 已 ready；失败记诊断不影响窗体） */
async function attachSysModules(runtime: HelperRuntime, win: BrowserWindow, opts: ElectronAppOptions): Promise<void> {
  try {
    const router = await createElectronSys(runtime.sysContext, {
      lang: runtime.lang,
      getWindow: () => (win.isDestroyed() ? null : win),
    });
    opts.attachSys?.attach(router);
  } catch (err) {
    runtime.bridge.diag.push("sys-fail", String(err));
  }
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

/** UiEvent → 渲染层转发（quit → app.quit；reset-pos → 主进程直接复位窗口，P1 D6） */
function forwardUiEvents(win: BrowserWindow, subscribe: ElectronAppOptions["subscribeUi"]): () => void {
  return subscribe((ev: UiEvent) => {
    if (ev.kind === "quit") {
      app.quit();
      return;
    }
    if (ev.kind === "reset-pos") {
      if (!win.isDestroyed()) {
        const p = defaultPos();
        win.setPosition(p.x, p.y, false);
      }
      return;
    }
    if (!win.isDestroyed()) win.webContents.send("ui-event", ev);
  });
}

/** 默认落位：主屏工作区右下角内缩 24px（建窗缺省位与 reset-pos 共用单源） */
export function defaultPos(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - WINDOW_W - 24, y: area.y + area.height - WINDOW_H - 24 };
}

/** 记忆位可见性校验（P1 D6）：任一显示器 bounds 外扩一窗内仍算可见，否则回落默认位 */
export function posVisible(pos: { x: number; y: number }): boolean {
  return screen
    .getAllDisplays()
    .some(
      (d) =>
        pos.x >= d.bounds.x - WINDOW_W &&
        pos.x <= d.bounds.x + d.bounds.width &&
        pos.y >= d.bounds.y - WINDOW_H &&
        pos.y <= d.bounds.y + d.bounds.height,
    );
}

/** 渲染进程崩溃：记录诊断并重载一次（插件侧监督兜底崩溃重启） */
function watchRendererHealth(win: BrowserWindow, runtime: HelperRuntime): void {
  win.webContents.on("render-process-gone", (_e, details) => {
    runtime.bridge.diag.push("renderer-gone", details.reason);
    if (!win.isDestroyed()) win.reload();
  });
}

function createWindow(initialPos?: { x: number; y: number }, scale = 1): BrowserWindow {
  const win = new BrowserWindow({
    width: Math.round(WINDOW_W * scale),
    height: Math.round(WINDOW_H * scale),
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
  // canJoinAllSpaces 跟随用户当前 Space；visibleOnFullScreen 关闭 = 不悬浮在全屏 app 之上
  // （全屏避让社区惯例：真全屏（游戏独占/全屏视频）让路——置顶看门狗也压不过系统全屏层）
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 默认点击穿透（forward 让渲染层仍能收到 mousemove 做命中翻转）
  win.setIgnoreMouseEvents(true, { forward: true });
  placeWindow(win, initialPos);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

function placeWindow(win: BrowserWindow, initialPos?: { x: number; y: number }): void {
  // 恢复位须可见（显示器拔除后坐标越界 → 回落默认位，P1 D6）；缺省 = 主屏右下内缩
  if (initialPos && posVisible(initialPos)) {
    win.setPosition(initialPos.x, initialPos.y, false);
    return;
  }
  const p = defaultPos();
  win.setPosition(p.x, p.y, false);
}
