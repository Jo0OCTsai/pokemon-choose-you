/**
 * helper 入口（AD §3.3 进程模型 + full-parity §3.4 sys sidecar）。
 *
 * 结构纪律：**Electron 胶水与桥/状态机纯逻辑分离**——
 * - `HELPER_HEADLESS=1`（CI / 无显示环境 / 契约测试）：只跑 runtime（纯 Node，零 Electron
 *   import，Node 24 原生执行 .ts），sys/ 模块族 = no-op 记录器（`HELPER_HEADLESS_AX=1`
 *   可编程 AX 授权初值——集成测试面）；
 * - 默认（开发机/插件宿主 spawn）：动态 import electron-app.ts 起 BrowserWindow 窗体——
 *   sys 真模块在 app ready 后装配（DeferredSys 先行排队，杜绝 hello→模块窗口丢消息）。
 *
 * 命令行参数：
 * - `--host-pid=<pid>`：宿主进程号轮询双保险（宿主退则 helper 10s 内自杀）；
 * - `--pos=<x>,<y>`：宿主记忆位置恢复（建窗初始位置；位置变化经 cmd.pos 上报回存宿主侧）。
 */
import { createHelperRuntime, type UiEvent } from "./runtime/index.ts";
import { DeferredSys, electronDeferredCaps } from "./sys/index.ts";

const argv = parseArgs(process.argv.slice(2));
const headless = process.env.HELPER_HEADLESS === "1";

// UiEvent 分发面：runtime 在此创建，Electron 胶水后到——经订阅回调接上（无循环 import）
const uiListeners = new Set<(ev: UiEvent) => void>();
function subscribeUi(cb: (ev: UiEvent) => void): () => void {
  uiListeners.add(cb);
  return () => uiListeners.delete(cb);
}

// electron 形态：DeferredSys 占位（真模块 whenReady 后 attach）；headless 缺省 = 记录器全家
const deferred = headless ? null : new DeferredSys(() => undefined, electronDeferredCaps(), "zh-Hans");

const runtime = createHelperRuntime({
  input: process.stdin,
  output: process.stdout,
  hostPid: argv.hostPid,
  ...(deferred ? { sys: deferred } : {}),
  ...(headless ? { axGranted: process.env.HELPER_HEADLESS_AX === "1" } : {}),
  onUiEvent: (ev) => {
    for (const cb of uiListeners) cb(ev);
    // quit（stdin end / 心跳超时 / --host-pid 探测死）：Electron 胶水的监听者走 app.quit；
    // headless 无监听者，quitHelper 兜底退出（exited 去重防双杀）
    if (ev.kind === "quit") quitHelper();
  },
});

// DeferredSys 的诊断出口在 runtime 建成后补接（与桥诊断同渠道）
deferred?.setDiag((tag, detail) => runtime.bridge.diag.push(tag, detail));

let exited = false;
/** 宿主存亡 → 退出（SLA 10s 内；150ms 给 stdout 一个 flush 窗口） */
function quitHelper(): void {
  if (exited) return;
  exited = true;
  runtime.dispose();
  const t = setTimeout(() => process.exit(0), 150);
  t.unref?.();
}

runtime.bridge.onHostDead(() => quitHelper());

// 崩溃前把环形缓冲诊断冲给宿主（管道还活着的场合）
process.on("uncaughtException", (err) => {
  runtime.bridge.diag.push("uncaught", String(err?.stack ?? err));
  runtime.bridge.send({ type: "crash-diag", entries: runtime.bridge.diag.snapshot() });
  quitHelper();
});

if (headless) {
  // headless：无窗体，桥即全部（stdin 的 data 监听已自动 resume 流）
} else {
  import("./electron-app.ts")
    .then((m) => m.startElectronApp(runtime, { initialPos: argv.pos, subscribeUi, attachSys: deferred! }))
    .catch((err: unknown) => {
      runtime.bridge.diag.push("electron-fail", String(err));
      runtime.bridge.send({ type: "crash-diag", entries: runtime.bridge.diag.snapshot() });
      quitHelper();
    });
}

function parseArgs(args: string[]): { hostPid?: number; pos?: { x: number; y: number } } {
  const out: { hostPid?: number; pos?: { x: number; y: number } } = {};
  for (const arg of args) {
    const pid = /^--host-pid=(\d+)$/.exec(arg);
    if (pid) {
      out.hostPid = Number(pid[1]);
      continue;
    }
    const pos = /^--pos=(-?\d+),(-?\d+)$/.exec(arg);
    if (pos) out.pos = { x: Number(pos[1]), y: Number(pos[2]) };
  }
  return out;
}
