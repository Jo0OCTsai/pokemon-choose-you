/**
 * 输入计数（FR-A9/AD §4.4，**唯一原生依赖挂点**，NFR-13 只计数红线）：
 * - uiohook-napi dynamic import try/catch——ABI 失配/缺 prebuild = 该面降级不崩 helper（A31）；
 * - 开启条件 = sys-config.inputResponse.enabled **且** macOS 辅助功能授权 granted（非满足
 *   零监听）；非 macOS 永不启动（D32 整面隐藏）；
 * - **只计数**：钩子回调只做计数器自增（零参回调——键值/键名/窗口标题/应用名 0 读取 0 出
 *   模块；机械红线 = eslint no-restricted-* 锁 rawcode/keycode 访问，见 eslint.config.ts）；
 * - cps 滑动窗口（state/inputCps）→ input-activity ≥1s 节流上行；撤销（macAuth onAuthChange）
 *   即停 + 上报由 macAuth 模块承担（seq 0 主动上报）。
 * headless = 记录器（platform/granted 可注入 + feed 模拟事件）。
 */
import { CpsGauge, shouldEmitActivity } from "../state/inputCps.ts";
import type { SysContext } from "./context.ts";

export interface InputCountConfig {
  enabled: boolean;
  focusHopCoupleMax?: number;
}

export interface InputCountModule {
  configure(cfg: InputCountConfig): void;
  /** macAuth 授权变更接线（撤销即停；恢复且 enabled → 重启） */
  onAuthChange(granted: boolean): void;
  readonly running: boolean;
  dispose(): void;
}

/** headless 记录器（platform/granted 注入——CI linux 上也能测 darwin 分支） */
export class HeadlessInputCount implements InputCountModule {
  readonly records: { cfgs: InputCountConfig[]; emitted: number[]; authChanges: boolean[] } = {
    cfgs: [],
    emitted: [],
    authChanges: [],
  };
  private readonly gauge: CpsGauge;
  private state: { enabled: boolean; granted: boolean; running: boolean } = {
    enabled: false,
    granted: false,
    running: false,
  };

  private readonly ctx: SysContext;
  private readonly opts: { platform?: NodeJS.Platform; granted?: boolean; tickMs?: number };

  constructor(ctx: SysContext, opts: { platform?: NodeJS.Platform; granted?: boolean; tickMs?: number } = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.gauge = new CpsGauge(ctx.now);
    this.state.granted = opts.granted ?? false;
  }

  configure(cfg: InputCountConfig): void {
    this.records.cfgs.push(cfg);
    this.state.enabled = cfg.enabled;
    this.reassess();
  }

  onAuthChange(granted: boolean): void {
    this.records.authChanges.push(granted);
    this.state.granted = granted;
    this.reassess();
  }

  get running(): boolean {
    return this.state.running;
  }

  /** 平台门（D32：非 darwin 永不启动——headless 同口径，注入 platform 可覆盖） */
  private platformOk(): boolean {
    return (this.opts.platform ?? process.platform) === "darwin";
  }

  private reassess(): void {
    const shouldRun = this.state.enabled && this.state.granted && this.platformOk();
    if (shouldRun === this.state.running) return;
    this.state.running = shouldRun;
    if (!shouldRun) this.gauge.reset();
    this.ctx.diag("input-count", shouldRun ? "start" : "stop");
  }

  /** 模拟一个键/鼠标事件（只计数——无载荷） */
  feed(): void {
    if (!this.state.running) return;
    this.gauge.feed();
  }

  /** 模拟 1s tick：cps 上行（≥1s 节流由调用方时钟推进） */
  tick(): void {
    if (!this.state.running) return;
    const now = this.ctx.now();
    if (!shouldEmitActivity(this.lastSent, now)) return;
    this.lastSent = now;
    const cps = this.gauge.sample();
    this.records.emitted.push(cps);
    this.ctx.emit({ type: "input-activity", cps });
  }

  private lastSent = Number.NEGATIVE_INFINITY;

  dispose(): void {
    this.state.running = false;
  }
}

/** uiohook-napi 最小结构面（env.d.ts 模块声明单源；handler 零参——类型面即红线） */
interface UiohookLike {
  on(event: string, handler: () => void): unknown;
  off(event: string, handler: () => void): unknown;
  start(): unknown;
  stop(): unknown;
}

/** uiohook-napi 探测装载（非 darwin 不装载——D32；装载失败降级 null + 诊断，A31） */
async function loadUiohook(ctx: SysContext): Promise<UiohookLike | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    // import 即装载原生绑定——ABI 失配/缺 prebuild 在此抛出（A31 降级面）
    const mod = (await import("uiohook-napi")) as { uiohook?: UiohookLike };
    return mod.uiohook ?? null;
  } catch (err) {
    ctx.diag("input-count", `uiohook load failed: ${String(err)}`);
    return null;
  }
}

/** electron 计数引擎（hook 起停 + cps 滑动窗口 1s 节流上行；enabled ∧ granted ∧ available 驱动） */
class ElectronInputCountEngine {
  private readonly ctx: SysContext;
  private readonly hook: UiohookLike | null;
  private readonly available: boolean;
  private readonly gauge: CpsGauge;
  private readonly state = { enabled: false, granted: false, running: false };
  private lastSent = Number.NEGATIVE_INFINITY;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  // 只计数回调：零参——不读取事件对象的任何字段（NFR-13 红线；eslint no-restricted-* 锁面）
  private readonly onKey = (): void => {
    this.gauge.feed();
  };
  private readonly onMouse = (): void => {
    this.gauge.feed();
  };

  // 显式字段赋值（Node 24 strip-only 不支持参数属性语法）
  constructor(ctx: SysContext, hook: UiohookLike | null, available: boolean) {
    this.ctx = ctx;
    this.hook = hook;
    this.available = available;
    this.gauge = new CpsGauge(ctx.now);
  }

  get running(): boolean {
    return this.state.running;
  }

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.reassess();
  }

  setGranted(granted: boolean): void {
    this.state.granted = granted;
    this.reassess();
  }

  private reassess(): void {
    if (this.state.enabled && this.state.granted && this.available) {
      this.startCounting();
    } else {
      this.stopCounting();
    }
  }

  private stopCounting(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (!this.state.running) return;
    this.state.running = false;
    this.gauge.reset();
    if (this.hook) {
      try {
        this.hook.off("key", this.onKey);
        this.hook.off("mousedown", this.onMouse);
        this.hook.stop();
      } catch (err) {
        this.ctx.diag("input-count", `stop failed: ${String(err)}`);
      }
    }
  }

  private startCounting(): void {
    if (this.state.running || !this.hook) return;
    this.state.running = true;
    try {
      this.hook.on("key", this.onKey); // key = 键按下（uiohook-napi 事件名）
      this.hook.on("mousedown", this.onMouse);
      this.hook.start();
      this.tickTimer = setInterval(() => {
        const now = this.ctx.now();
        if (!shouldEmitActivity(this.lastSent, now)) return;
        this.lastSent = now;
        this.ctx.emit({ type: "input-activity", cps: this.gauge.sample() });
      }, 1_000);
      this.tickTimer.unref?.();
    } catch (err) {
      this.ctx.diag("input-count", `start failed: ${String(err)}`);
      this.stopCounting();
    }
  }

  dispose(): void {
    this.state.enabled = false;
    this.stopCounting();
  }
}

/** Electron 实现（动态 import uiohook；probe 失败 = available:false，能力位不加） */
export async function createElectronInputCount(
  ctx: SysContext,
  deps: { currentGrant: () => Promise<boolean>; onAuthChange: (cb: (granted: boolean) => void) => void },
): Promise<InputCountModule & { readonly available: boolean }> {
  const hook = await loadUiohook(ctx);
  const available = process.platform === "darwin" && hook !== null; // D32：非 macOS 永不启动
  const engine = new ElectronInputCountEngine(ctx, hook, available);
  deps.onAuthChange((granted) => engine.setGranted(granted));
  // 构造期取一次初值（macAuth 侧缓存的真实状态；失败按未授权——零监听）
  try {
    engine.setGranted(await deps.currentGrant());
  } catch {
    engine.setGranted(false);
  }

  return {
    get running(): boolean {
      return engine.running;
    },
    get available(): boolean {
      return available;
    },
    configure(cfg: InputCountConfig): void {
      engine.setEnabled(cfg.enabled);
    },
    onAuthChange(granted: boolean): void {
      engine.setGranted(granted);
    },
    dispose(): void {
      engine.dispose();
    },
  };
}
